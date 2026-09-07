import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

import * as api from '@/target/api.ts'
import { useSupplierManagementViewModel } from '@/target/pages/bob/supplier/vm.ts'
import { useTargetSession } from '@/target/session/vm.ts'

vi.mock('@/target/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/target/api.ts')>()),
  queryTargetSuppliers: vi.fn(),
  queryTargetSupplierVersions: vi.fn(),
  setTargetSupplierEnabled: vi.fn(),
  getTargetSupplier: vi.fn(),
  submitNewTargetSupplier: vi.fn(),
}))

const querySuppliers = vi.mocked(api.queryTargetSuppliers)
const queryVersions = vi.mocked(api.queryTargetSupplierVersions)
const setSupplierEnabled = vi.mocked(api.setTargetSupplierEnabled)
const submitNew = vi.mocked(api.submitNewTargetSupplier)

function authorize(...paths: string[]) {
  const session = useTargetSession()
  session.csrfToken = 'csrf-token'
  session.user = { id: 'admin', code: 'admin', name: '管理员' }
  session.apiPaths = paths
}

describe('supplier BOB page public view-model seam', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    setActivePinia(createPinia())
    querySuppliers.mockResolvedValue({
      items: [
        {
          objectId: 'supplier-1',
          entity: 'supplier',
          code: 'SUP-0001',
          py: 'gongyingshang',
          name: '北方供应商',
          enabled: true,
          revision: '9007199254740993',
          sourceApprovalEntryId: 'approval-1',
          sourceVersionNo: 2,
          updatedAt: '2026-09-07T00:00:00.000Z',
          data: {},
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    queryVersions.mockResolvedValue([] as never)
  })

  it('reads formal data and independently disables the exact object revision', async () => {
    authorize('/bob/supplier/query', '/bob/supplier/disable')
    setSupplierEnabled.mockResolvedValue({
      id: 'supplier-1',
      enabled: false,
      revision: '9007199254740994',
    } as never)
    const vm = useSupplierManagementViewModel()
    vm.list.filterInput.value.keyword = ' 北方 '

    await vm.list.submitSearch()
    await vm.list.disable(vm.list.items.value[0]!)

    expect(querySuppliers).toHaveBeenCalledWith('csrf-token', {
      page: 1,
      pageSize: 20,
      filters: { keyword: '北方' },
    })
    expect(setSupplierEnabled).toHaveBeenCalledWith(
      'csrf-token',
      { objectId: 'supplier-1', expectedRevision: '9007199254740993' },
      false,
    )
  })

  it('keeps a temporary supplier form until its immutable submission is accepted', async () => {
    authorize('/bob/supplier/submit-new')
    submitNew.mockResolvedValue({ submissionId: 'submission-1' } as never)
    const vm = useSupplierManagementViewModel()

    vm.openCreate()
    Object.assign(vm.editor.draft.value, {
      legalName: ' 北方供应商有限公司 ',
      displayName: ' 北方供应商 ',
      legalIdentifier: ' 91350211M000100Y43 ',
      operatingEntities: [
        { objectId: 'entity-1', code: 'OPE-1', name: '北京主体' },
      ],
      defaultOperatingEntityId: 'entity-1',
    })
    expect(vm.editor.canSubmit.value).toBe(true)
    await vm.submit()

    expect(submitNew).toHaveBeenCalledWith(
      'csrf-token',
      expect.objectContaining({
        subjectId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        submissionId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: expect.objectContaining({
          legalName: ' 北方供应商有限公司 ',
          defaultOperatingEntityId: 'entity-1',
        }),
      }),
    )
    expect(vm.editor.open.value).toBe(false)
  })

  it('keeps the formal state and identifies the enabled vehicle that blocks a disable', async () => {
    authorize('/bob/supplier/query', '/bob/supplier/disable')
    setSupplierEnabled.mockRejectedValue(
      new api.TargetApiError('conflict', 'conflict', 'request-1', {
        blockers: [
          {
            kind: 'AUX_CURRENT_REFERENCE',
            entity: 'vehicle',
            objectId: 'vehicle-1',
          },
        ],
      }),
    )
    const vm = useSupplierManagementViewModel()

    await vm.list.submitSearch()
    await vm.list.disable(vm.list.items.value[0]!)

    expect(vm.list.items.value[0]).toMatchObject({
      objectId: 'supplier-1',
      enabled: true,
    })
    expect(vm.list.feedback.value).toContain('启用车辆（vehicle-1）')
  })
})

it('authorizes new submissions independently from formal query access', () => {
  authorize('/bob/supplier/submit-new')
  const vm = useSupplierManagementViewModel()

  expect(vm.canCreate()).toBe(true)
  expect(vm.list.searchable).toBe(false)
})

it('treats an unknown enablement result as unresolved after an authorized exact-current verification', async () => {
  authorize('/bob/supplier/query', '/bob/supplier/disable', '/bob/supplier/get')
  setSupplierEnabled.mockRejectedValue(new TypeError('network unavailable'))
  const getSupplier = vi.mocked(api.getTargetSupplier)
  getSupplier.mockResolvedValue({ objectId: 'supplier-1' } as never)
  const vm = useSupplierManagementViewModel()

  await vm.list.submitSearch()
  await vm.list.disable(vm.list.items.value[0]!)

  expect(getSupplier).toHaveBeenCalledWith('csrf-token', 'supplier-1')
  expect(vm.list.isRowBlocked('supplier-1')).toBe(true)
  expect(vm.list.feedback.value).toContain('请求结果未知')
})

it('clones proxied current data without leaking the reactive object into a new submission', () => {
  authorize('/bob/supplier/submit-new')
  const vm = useSupplierManagementViewModel()
  const row = reactive({
    objectId: 'supplier-1',
    data: {
      identityKind: 'ORGANIZATION',
      legalName: '华北供应商有限公司',
      displayName: '华北供应商',
      legalIdentifier: '91350211M000100Y43',
      contactName: '',
      phone: '',
      address: '',
      operatingEntities: [],
      defaultOperatingEntityId: null,
      remark: '',
      settlementMethod: null,
      defaultPurchaser: null,
    },
  })

  expect(() => vm.openClone(row as never)).not.toThrow()
  expect(vm.editor.draft.value).toMatchObject({
    displayName: '华北供应商',
    operatingEntities: [],
  })
})

it('invalidates the editor synchronously when the authenticated session changes', () => {
  authorize('/bob/supplier/submit-new')
  const vm = useSupplierManagementViewModel()
  const session = useTargetSession()

  vm.openCreate()
  Object.assign(vm.editor.draft.value, { displayName: '即将失效的草稿' })
  session.clear()

  expect(vm.editor.open.value).toBe(false)
  expect(vm.editor.draft.value.displayName).toBe('')
})
