import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useEmployeeViewModel } from '@/pages/bob/employee/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const mocked = vi.mocked(apiClient)

describe('BOB employee current view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().permissions = ['/bob/employee/query', '/bob/employee/get']
    mocked.postContract.mockReset()
  })

  it('has only current query/get behavior and no write action path', async () => {
    mocked.postContract
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({
        data: {
          objectId: 'EMP-1',
          entity: 'employee',
          code: 'EMP-0001',
          objectRevision: 1,
          enabled: true,
          sourceApprovalEntryId: 'V1',
          updatedAt: '2026-08-28T00:00:00Z',
          approval: {
            approvalEntryId: 'V1',
            versionNo: 1,
            status: 'APPROVED',
            revision: 1,
            createdBy: 'U1',
            createdAt: '2026-08-28T00:00:00Z',
            updatedBy: 'U1',
            updatedAt: '2026-08-28T00:00:00Z',
            submittedBy: 'U1',
            submittedAt: '2026-08-28T00:00:00Z',
            approvedBy: 'U2',
            approvedAt: '2026-08-28T00:00:00Z',
          },
          data: { name: '张三' },
        },
      })
    const vm = useEmployeeViewModel()
    await vm.query()
    await vm.openView({ objectId: 'EMP-1' })
    expect(
      mocked.postContract.mock.calls.map(([path]) => String(path)),
    ).toEqual(['bob/employee/query', 'bob/employee/get'])
    expect('save' in vm).toBe(false)
    expect('openCreate' in vm).toBe(false)
  })
})
