import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useTypedBusinessArchiveViewModel } from '@/pages/bob/shared/typed-business-archive'
import { useSessionStore } from '@/stores/session'
vi.mock('@/api/client', () => ({ apiClient: { postContract: vi.fn() } }))
const post = vi.mocked(apiClient.postContract)
describe('BOB typed business archive view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it.each(['employee', 'supplier', 'other-unit', 'sales-partner'] as const)(
    'reads %s from its dedicated current query',
    async (entity) => {
      useSessionStore().permissions = [`/bob/${entity}/get`]
      post.mockResolvedValue({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      } as never)
      const vm = useTypedBusinessArchiveViewModel(entity)

      await vm.query()

      expect(post).toHaveBeenCalledWith(
        `bob/${entity}/query`,
        expect.any(Object),
      )
    },
  )

  it.each(['supplier', 'other-unit', 'sales-partner'] as const)(
    'sends %s operating entity filters through its dedicated current query',
    async (entity) => {
      post.mockResolvedValue({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      } as never)
      const vm = useTypedBusinessArchiveViewModel(entity)
      vm.operatingEntityId.value = '01J00000000000000000000010'

      await vm.search()

      expect(post).toHaveBeenCalledWith(`bob/${entity}/query`, {
        page: 1,
        pageSize: 20,
        filters: { operatingEntityId: '01J00000000000000000000010' },
        sort: [{ field: 'code', order: 'asc' }],
      })
    },
  )

  it('keeps Employee free of the multi-entity operating entity filter', async () => {
    post.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
    } as never)
    const vm = useTypedBusinessArchiveViewModel('employee')

    await vm.search()

    expect(post).toHaveBeenCalledWith('bob/employee/query', {
      page: 1,
      pageSize: 20,
      filters: {},
      sort: [{ field: 'code', order: 'asc' }],
    })
  })

  it('loads current operating entity options for archive filters', async () => {
    post.mockResolvedValue({
      data: {
        items: [
          {
            objectId: '01J00000000000000000000010',
            code: 'OPE-0001',
            data: { name: '华南主体' },
          },
        ],
      },
    } as never)
    const vm = useTypedBusinessArchiveViewModel('supplier')

    await vm.searchOperatingEntities('华南')

    expect(post).toHaveBeenCalledWith('bob/operating-entity/query', {
      page: 1,
      pageSize: 20,
      filters: { enabled: true, keyword: '华南' },
      sort: [{ field: 'code', order: 'asc' }],
    })
    expect(vm.operatingEntityOptions.value).toEqual([
      { value: '01J00000000000000000000010', title: 'OPE-0001 · 华南主体' },
    ])
  })
})
