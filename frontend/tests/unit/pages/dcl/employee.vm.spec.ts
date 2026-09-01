import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclEmployeeViewModel } from '@/pages/dcl/employee/vm'
import { useSessionStore } from '@/stores/session'
vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const post = vi.mocked(apiClient.postContract)
describe('DCL employee view model', () => { beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() }); it('creates a typed employee identity without Party lookup', async () => { useSessionStore().permissions = ['/dcl/employee/create', '/bob/operating-entity/query', '/aux/employee-category/query', '/aux/department/query', '/aux/position/query']; post.mockResolvedValue({ data: { items: [] } } as never); const vm = useDclEmployeeViewModel(); vm.openCreate(); await expect(vm.save({ ...vm.editorModel.value, kind: 'PERSON', legalName: '张三', displayName: '张三', strongIdentifiers: [{ type: 'PERSON_ID', value: '3101' }], currentOperatingEntityId: 'OPE-1' })).resolves.toBe(true); expect(post).toHaveBeenCalledWith('dcl/employee/create', { data: expect.objectContaining({ kind: 'PERSON', legalName: '张三', currentOperatingEntityId: 'OPE-1', strongIdentifiers: [{ type: 'PERSON_ID', value: '3101' }] }) }); expect(post.mock.calls.map(([path]) => path)).not.toContain('bob/party/query') }) })

describe('DCL employee strong identifiers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const view = {
    objectId: 'EMP-1', entity: 'employee', code: 'EMP-001', updatedAt: '2026-09-01T00:00:00Z', availableApprovalActions: [],
    approval: { approvalEntryId: 'APR-EMP-1', revision: 3, status: 'APPROVED', versionNo: 1 },
    data: { kind: 'PERSON', legalName: '张三', strongIdentifiers: [{ type: 'PERSON_ID', value: '3101' }, { type: 'TAX_NUMBER', value: 'TAX-1' }], enabled: true, currentOperatingEntityId: 'OPE-1', currentOperatingEntity: { sourceObjectId: 'OPE-1', code: 'OPE-001', name: '经营主体甲' } },
  } as never
  const row = { objectId: 'EMP-1', code: 'EMP-001', availableApprovalActions: [], latestApproved: { approval: view.approval, data: view.data }, openVersion: null } as never

  function mockRequests() {
    post.mockImplementation(async (path) => ({
      data: path === 'dcl/employee/get' ? view : { items: [], total: 0, page: 1, pageSize: 20 },
    }) as never)
  }

  it('round-trips every strong identifier when editing and saving', async () => {
    useSessionStore().permissions = ['/dcl/employee/get', '/dcl/employee/save', '/bob/operating-entity/query', '/aux/employee-category/query', '/aux/department/query', '/aux/position/query']
    mockRequests()
    const vm = useDclEmployeeViewModel()

    await vm.openEdit(row)

    expect(vm.editorModel.value.strongIdentifiers).toEqual(view.data.strongIdentifiers)
    await expect(vm.save(vm.editorModel.value)).resolves.toBe(true)
    expect(post).toHaveBeenCalledWith('dcl/employee/save', expect.objectContaining({ data: expect.objectContaining({ strongIdentifiers: view.data.strongIdentifiers }) }))
  })

  it('round-trips every strong identifier when disabling', async () => {
    useSessionStore().permissions = ['/dcl/employee/get', '/dcl/employee/save']
    mockRequests()
    const vm = useDclEmployeeViewModel()

    await expect(vm.changeEnabled(row)).resolves.toBe(true)

    expect(post).toHaveBeenCalledWith('dcl/employee/save', expect.objectContaining({ data: expect.objectContaining({ enabled: false, strongIdentifiers: view.data.strongIdentifiers }) }))
  })
})
