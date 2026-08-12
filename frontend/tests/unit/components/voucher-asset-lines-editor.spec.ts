import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import VoucherAssetLinesEditor from '@/components/voucher/VoucherAssetLinesEditor.vue'

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

const mockedPost = vi.mocked(apiClient.post)

describe('VoucherAssetLinesEditor', () => {
  beforeEach(() => mockedPost.mockReset())

  it('loads active disposal candidates with contract-compliant pagination', async () => {
    mockedPost.mockImplementation(async (path, body) => {
      if (path !== 'vou/asset-sale/asset-source') return { data: { items: [] } } as never
      const page = (body as { page: number }).page
      return {
        data: {
          items: [
            {
              assetId: `asset-${page}`,
              assetNo: `FA-${page}`,
              assetName: `资产 ${page}`,
              originalValue: '100.00',
              accumulatedDepreciation: '0.00',
              netValue: '100.00',
            },
          ],
          total: 2,
        },
      } as never
    })

    const wrapper = shallowMount(VoucherAssetLinesEditor, {
      props: {
        modelValue: [],
        editable: true,
        kind: 'asset-sale',
      },
    })
    await flushPromises()

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'vou/asset-sale/asset-source', {
      page: 1,
      pageSize: 200,
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'vou/asset-sale/asset-source', {
      page: 2,
      pageSize: 200,
    })
    expect(wrapper.find('.responsive-table-wrap').exists()).toBe(true)
  })
})
