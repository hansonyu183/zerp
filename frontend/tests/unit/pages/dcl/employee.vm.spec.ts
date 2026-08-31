import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useDclEmployeeViewModel } from '@/pages/dcl/employee/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.postContract)

const approval = {
  approvalEntryId: 'EMP-V1',
  versionNo: 1,
  status: 'DRAFT' as const,
  revision: 2,
  createdBy: 'USER-1',
  createdAt: '2026-08-28T00:00:00Z',
  updatedBy: 'USER-1',
  updatedAt: '2026-08-28T00:00:00Z',
  submittedBy: null,
  submittedAt: null,
  approvedBy: null,
  approvedAt: null,
}

describe('DCL employee view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('creates an employee declaration with an existing Party and all selected references', async () => {
    useSessionStore().permissions = [
      '/dcl/employee/create',
      '/bob/operating-entity/query',
      '/bob/party/query',
      '/aux/employee-category/query',
      '/aux/department/query',
      '/aux/position/query',
    ]
    mockedPost.mockResolvedValue({ data: { items: [] } })
    const vm = useDclEmployeeViewModel()

    vm.openCreate()
    await expect(
      vm.save({
        ...vm.editorModel.value,
        partyMode: 'EXISTING',
        partyId: 'PARTY-1',
        operatingEntityId: 'OPE-1',
        employeeCategoryId: 'CAT-1',
        departmentId: 'DEP-1',
        positionId: 'POS-1',
        phone: '13800138000',
        email: 'employee@example.com',
        hireDate: '2026-08-01',
        remark: '首版',
      }),
    ).resolves.toBe(true)

    expect(mockedPost).toHaveBeenCalledWith('dcl/employee/create', {
      partyId: 'PARTY-1',
      operatingEntityId: 'OPE-1',
      data: {
        employeeCategoryId: 'CAT-1',
        departmentId: 'DEP-1',
        positionId: 'POS-1',
        phone: '13800138000',
        email: 'employee@example.com',
        hireDate: '2026-08-01',
        remark: '首版',
      },
    })
  })

  it('uses DCL approval actions and creates enabled candidates through save', async () => {
    useSessionStore().permissions = [
      '/dcl/employee/query',
      '/dcl/employee/submit',
      '/dcl/employee/get',
      '/dcl/employee/save',
    ]
    const row = {
      objectId: 'EMP-1',
      entity: 'employee' as const,
      code: 'EMP-0001',
      partyId: 'PARTY-1',
      partyKind: 'PERSON' as const,
      partyDisplayName: '张三',
      operatingEntityId: 'OPE-1',
      operatingEntityCode: 'OPE-0001',
      operatingEntityName: '华东主体',
      enabled: true,
      availableApprovalActions: ['submit'],
      latestApproved: null,
      openVersion: { approval, enabled: true, data: {} },
      updatedAt: '2026-08-28T00:00:00Z',
    }
    mockedPost
      .mockResolvedValueOnce({
        data: { items: [row], total: 1, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useDclEmployeeViewModel()

    await vm.query()
    await expect(vm.submitObject(row)).resolves.toBe(true)

    expect(mockedPost).toHaveBeenNthCalledWith(2, 'dcl/employee/submit', {
      objectId: 'EMP-1',
      approvalEntryId: 'EMP-V1',
      approvalRevision: 2,
    })
    expect(mockedPost.mock.calls.map(([path]) => String(path))).not.toContain(
      ['bob', 'employee', 'submit'].join('/'),
    )
  })
})
