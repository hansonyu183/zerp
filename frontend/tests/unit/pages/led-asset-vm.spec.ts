import { effectScope } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useAssetLedgerViewModel } from '@/pages/led/asset/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn() } }))
const mockedPost = vi.mocked(apiClient.post)

function createViewModel() {
  const scope = effectScope()
  const vm = scope.run(useAssetLedgerViewModel)!
  return { scope, vm }
}

describe('fixed asset ledger view model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useSessionStore().permissions = ['/led/asset/query', '/led/asset/get']
    mockedPost.mockReset()
  })

  it('queries ledger pages and loads asset details through the view model', async () => {
    const asset = {
      assetId: 'asset-1',
      assetNo: 'FA-000001',
      assetName: '灌装机',
      category: { code: 'CAT-1', name: '机器设备' },
      department: { code: 'DEP-1', name: '生产部' },
      acquisitionDate: '2026-06-01',
      depreciationStartMonth: '2026-07',
      originalValue: '1200.00',
      residualValue: '60.00',
      usefulLifeMonths: 12,
      accumulatedDepreciation: '95.00',
      netValue: '1105.00',
      status: 'ACTIVE',
    }
    mockedPost
      .mockResolvedValueOnce({
        data: { items: [asset], total: 21, page: 1, pageSize: 20 },
      } as never)
      .mockResolvedValueOnce({
        data: { asset, history: [] },
      } as never)
    const { scope, vm } = createViewModel()
    vm.keyword.value = '灌装'

    await vm.load()
    expect(mockedPost).toHaveBeenNthCalledWith(
      1,
      'led/asset/query',
      {
        page: 1,
        pageSize: 20,
        filters: { keyword: '灌装', status: [] },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(vm.rows.value).toEqual([asset])
    expect(vm.pageCount.value).toBe(2)

    await vm.open(asset)
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'led/asset/get', {
      assetId: 'asset-1',
    })
    expect(vm.detailOpen.value).toBe(true)
    scope.stop()
  })

  it('does not request actions without their exact permissions', async () => {
    useSessionStore().permissions = []
    const { scope, vm } = createViewModel()

    await vm.load()
    await vm.open({ assetId: 'asset-1' } as never)

    expect(mockedPost).not.toHaveBeenCalled()
    scope.stop()
  })
})
