import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useSupplierViewModel } from '@/pages/bob/supplier/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn() },
}))

describe('Supplier', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().permissions = ['/bob/supplier/query', '/bob/supplier/get']
    vi.mocked(apiClient.postContract).mockReset()
  })

  it('has only current query/get behavior and no declaration write path', async () => {
    vi.mocked(apiClient.postContract)
      .mockResolvedValueOnce({
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      })
      .mockResolvedValueOnce({ data: null })
    const vm = useSupplierViewModel()
    await vm.query()
    await vm.openView({ objectId: 'SUP-1' })

    expect(
      vi
        .mocked(apiClient.postContract)
        .mock.calls.map(([path]) => String(path)),
    ).toEqual(['bob/supplier/query', 'bob/supplier/get'])
    expect('save' in vm).toBe(false)
    expect('openCreate' in vm).toBe(false)
  })

  it('keeps the current effective data returned by BOB without lifecycle adaptation', async () => {
    const current = {
      objectId: 'SUP-1',
      data: { name: '当前供应商', defaultPurchaserName: '当前采购员' },
    }
    vi.mocked(apiClient.postContract).mockResolvedValueOnce({
      data: { items: [current], total: 1, page: 1, pageSize: 20 },
    })
    const vm = useSupplierViewModel()
    await vm.query()
    expect(vm.rows.value[0]).toEqual(current)
  })
})
