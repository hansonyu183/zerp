import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import * as api from '@/target/api.ts'
import {
  emptyCustomer,
  cloneCustomer,
  useCustomerManagementViewModel,
} from '@/target/pages/bob/customer/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  queryTargetCustomers: vi.fn(),
  queryTargetCustomerVersions: vi.fn(),
  getTargetCustomer: vi.fn(),
  setTargetCustomerEnabled: vi.fn(),
  submitNewTargetCustomer: vi.fn(),
  submitChangeTargetCustomer: vi.fn(),
  queryTargetAuxReferences: vi.fn(),
  queryTargetEmployees: vi.fn(),
  queryTargetOperatingEntities: vi.fn(),
  queryTargetSalesPartners: vi.fn(),
}))
function authorize(...paths: string[]) {
  const session = useTargetSession()
  session.csrfToken = 'csrf'
  session.user = { id: 'user', code: 'user', name: '用户' }
  session.apiPaths = paths
}
function snapshot() {
  const data = emptyCustomer()
  Object.assign(data, {
    identityKind: 'OTHER',
    legalName: '客户',
    displayName: '客户',
    legalIdentifier: 'OTHER-ID',
  })
  Object.assign(data.subunits[0]!, {
    name: '总部',
    customerType: { id: 'type', code: 'DIRECT', name: '直销' },
    primarySalesAttribution: {
      type: 'INTERNAL_EMPLOYEE',
      objectId: 'employee',
      code: 'EMP-0001',
      name: '业务员',
    },
  })
  return data
}
const row = () => ({
  objectId: 'customer-1',
  entity: 'customer' as const,
  code: 'CUS-0001',
  name: '客户',
  py: 'kehu',
  enabled: true,
  revision: '9007199254740993',
  sourceApprovalEntryId: 'entry-1',
  sourceVersionNo: 1,
  updatedAt: '2026-09-07T00:00:00.000Z',
  data: snapshot(),
})

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  vi.mocked(api.queryTargetCustomers).mockResolvedValue({
    items: [row()],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.queryTargetAuxReferences).mockResolvedValue([])
  vi.mocked(api.queryTargetEmployees).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  })
  vi.mocked(api.queryTargetOperatingEntities).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  })
  vi.mocked(api.queryTargetSalesPartners).mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  })
})

describe('Customer page public view model', () => {
  it('requires the bounded subunit capability to create but never invents read permissions', () => {
    authorize('/bob/customer/submit-new')
    const denied = useCustomerManagementViewModel()
    denied.openCreate()
    expect(denied.editor.open.value).toBe(false)
    denied.dispose()
    authorize('/bob/customer/submit-new', '/bob/customer/save-subunits')
    const vm = useCustomerManagementViewModel()
    vm.openCreate()
    expect(vm.editor.open.value).toBe(true)
    expect(vm.list.searchable).toBe(false)
    expect(api.queryTargetCustomers).not.toHaveBeenCalled()
    expect(api.queryTargetAuxReferences).not.toHaveBeenCalled()
    expect(api.queryTargetEmployees).not.toHaveBeenCalled()
    vm.dispose()
  })
  it('independently disables the precise stable object revision and refreshes once', async () => {
    authorize('/bob/customer/query', '/bob/customer/disable')
    vi.mocked(api.setTargetCustomerEnabled).mockResolvedValue({
      id: 'customer-1',
      enabled: false,
      revision: '9007199254740994',
    })
    const vm = useCustomerManagementViewModel()
    await vm.list.initialize()
    await vm.list.disable(vm.list.items.value[0]!)
    expect(api.setTargetCustomerEnabled).toHaveBeenCalledWith(
      'csrf',
      { objectId: 'customer-1', expectedRevision: '9007199254740993' },
      false,
    )
    expect(api.queryTargetCustomers).toHaveBeenCalledTimes(2)
    expect(api.submitChangeTargetCustomer).not.toHaveBeenCalled()
    vm.dispose()
  })
  it('clones a proxy into fresh customer and subunit identities without overwriting the source', async () => {
    authorize('/bob/customer/submit-new', '/bob/customer/save-subunits')
    const source = snapshot()
    source.subunits[0] = {
      ...source.subunits[0]!,
      intent: 'EXISTING',
      code: 'SUB-0007',
    }
    const vm = useCustomerManagementViewModel()
    vm.openClone(reactive({ ...row(), id: 'customer-1', data: source }))
    expect(vm.editor.draft.value.subunits[0]).toMatchObject({
      intent: 'NEW',
      code: null,
      name: '总部',
    })
    expect(vm.editor.draft.value.subunits[0]!.id).not.toBe(
      source.subunits[0]!.id,
    )
    vm.editor.draft.value.subunits[0]!.name = '新总部'
    expect(source.subunits[0]!.name).toBe('总部')
    expect(cloneCustomer(source).identityAttachments).toEqual([])
    vi.mocked(api.submitNewTargetCustomer).mockResolvedValue({} as never)
    await vm.submit()
    expect(
      vi.mocked(api.submitNewTargetCustomer).mock.calls[0]?.[1].subjectId,
    ).not.toBe('customer-1')
    vm.dispose()
  })
  it('keeps rejected temporary input and destroys it on close', async () => {
    authorize('/bob/customer/submit-new', '/bob/customer/save-subunits')
    vi.mocked(api.submitNewTargetCustomer).mockRejectedValue(
      new api.TargetApiError(
        'customer_duplicate_legal_identifier',
        'duplicate',
        'request',
      ),
    )
    const vm = useCustomerManagementViewModel()
    vm.openCreate()
    vm.editor.draft.value = snapshot()
    expect(vm.editor.canSubmit.value).toBe(true)
    await vm.submit()
    expect(vm.editor.open.value).toBe(true)
    expect(vm.editor.error.value).toContain('法定识别号')
    expect(vm.editor.draft.value.subunits[0]!.name).toBe('总部')
    expect(api.submitNewTargetCustomer).toHaveBeenCalledWith(
      'csrf',
      expect.objectContaining({
        snapshot: expect.not.objectContaining({ enabled: expect.anything() }),
      }),
    )
    vm.closeEditor()
    vm.openCreate()
    expect(vm.editor.draft.value.displayName).toBe('')
    vm.dispose()
  })
  it('keeps existing subunit content in a root-only change with precise version expectations', async () => {
    authorize('/bob/customer/submit-change', '/bob/customer/versions')
    const original = snapshot()
    original.subunits[0] = {
      ...original.subunits[0]!,
      intent: 'EXISTING',
      code: 'SUB-0001',
    }
    vi.mocked(api.queryTargetCustomerVersions).mockResolvedValue({
      items: [
        {
          submissionId: 'version-1',
          status: 'APPROVED',
          versionNo: 1,
          revision: '9007199254740995',
          snapshot: original,
        },
      ],
    } as never)
    vi.mocked(api.submitChangeTargetCustomer).mockResolvedValue({} as never)
    const vm = useCustomerManagementViewModel()
    await vm.openChange({ ...row(), id: 'customer-1' })
    expect(vm.canEditSubunits()).toBe(false)
    vm.addSubunit()
    expect(vm.editor.draft.value.subunits).toHaveLength(1)
    vm.editor.draft.value.displayName = '新名称'
    await vm.submit()
    expect(api.submitChangeTargetCustomer).toHaveBeenCalledWith(
      'csrf',
      expect.objectContaining({
        subjectId: 'customer-1',
        expectedLatestApprovedSubmissionId: 'version-1',
        expectedLatestApprovedRevision: '9007199254740995',
        snapshot: expect.objectContaining({ subunits: original.subunits }),
      }),
    )
    vm.dispose()
  })
  it('does not apply late reference results after closing the temporary form', async () => {
    authorize(
      '/bob/customer/submit-new',
      '/bob/customer/save-subunits',
      '/aux/employee/query',
    )
    let resolve!: (
      value: Awaited<ReturnType<typeof api.queryTargetEmployees>>,
    ) => void
    vi.mocked(api.queryTargetEmployees).mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const vm = useCustomerManagementViewModel()
    vm.openCreate()
    vm.closeEditor()
    resolve({
      items: [{ id: 'late', code: 'EMP-0001', name: '旧员工', enabled: true }],
      total: 1,
      page: 1,
      pageSize: 100,
    } as never)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(vm.purchaserOptions.value).toEqual([])
    vm.dispose()
  })
})
