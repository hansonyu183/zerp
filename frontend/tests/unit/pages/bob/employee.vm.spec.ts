import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, type ApiPostData } from '@/api/client'
import { useEmployeeViewModel } from '@/pages/bob/employee/vm'
import { employeeStatusLabel } from '@/pages/bob/employee/status'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mocked = vi.mocked(apiClient)

describe('employment relationship view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().permissions = [
      '/bob/employee/query',
      '/bob/employee/create',
      '/dcl/party/create',
      '/bob/party/get',
      '/bob/party/query',
      '/bob/operating-entity/query',
      '/aux/department/query',
      '/aux/position/query',
    ]
    mocked.postContract.mockReset()
  })

  it('renders known lifecycle statuses in Chinese', () => {
    expect(employeeStatusLabel('DRAFT')).toBe('草稿')
    expect(employeeStatusLabel('PENDING')).toBe('待批准')
    expect(employeeStatusLabel('APPROVED')).toBe('已批准')
    expect(employeeStatusLabel('FUTURE_STATUS')).toBe('未知状态')
  })

  it('creates an employment relationship with an existing Party through the dedicated contract', async () => {
    mocked.postContract.mockResolvedValue({ data: {} })
    const vm = useEmployeeViewModel()
    vm.form.value.partyMode = 'EXISTING'
    vm.form.value.partyId = 'party-1'
    vm.form.value.operatingEntityId = 'operating-1'

    await expect(vm.save()).resolves.toBe(true)
    expect(mocked.postContract).toHaveBeenCalledWith('bob/employee/create', {
      partyId: 'party-1',
      data: expect.objectContaining({ operatingEntityId: 'operating-1' }),
    })
  })

  it('keeps employee query paging at 20 and ignores an obsolete response', async () => {
    let resolveOld!: (value: {
      data: ApiPostData<'bob/employee/query'>
    }) => void
    mocked.postContract
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
    const vm = useEmployeeViewModel()
    const old = vm.query()
    vm.keyword.value = '新员工'
    await vm.query()
    resolveOld({
      data: {
        items: [
          {
            objectId: 'old',
            code: 'EMP-old',
            enabled: true,
            objectRevision: 1,
            latestApproved: null,
            openVersion: {
              approvalEntryId: 'v',
              version: 1,
              revision: 1,
              status: 'DRAFT',
              submittedBy: null,
              name: '旧员工',
            },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    })
    await old
    expect(mocked.postContract).toHaveBeenNthCalledWith(
      2,
      'bob/employee/query',
      expect.objectContaining({ pageSize: 20, filters: { keyword: '新员工' } }),
    )
    expect(vm.rows.value).toEqual([])
  })
})
