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

  it('loads depreciation references and emits the generated preview lines', async () => {
    mockedPost.mockImplementation(async (path) => {
      if (path === 'vou/asset-depreciation/preview') {
        return {
          data: {
            items: [
              {
                assetId: 'asset-1',
                assetNo: 'FA-000001',
                assetName: '测试设备',
                originalValue: '1200.00',
                accumulatedDepreciation: '0.00',
                depreciationAmount: '95.00',
                netValue: '1200.00',
              },
            ],
          },
        } as never
      }
      return { data: { items: [] } } as never
    })

    const wrapper = shallowMount(VoucherAssetLinesEditor, {
      props: {
        modelValue: [],
        editable: true,
        kind: 'asset-depreciation',
        depreciationMonth: '2026-08',
      },
    })
    await flushPromises()

    expect(mockedPost).toHaveBeenCalledWith(
      'led/asset/query',
      expect.objectContaining({ filters: { status: ['ACTIVE'] } }),
    )

    await wrapper.find('v-btn').trigger('click')
    await flushPromises()

    expect(mockedPost).toHaveBeenCalledWith('vou/asset-depreciation/preview', {
      depreciationMonth: '2026-08',
    })
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual([
      expect.objectContaining({
        assetId: 'asset-1',
        assetNo: 'FA-000001',
        assetName: '测试设备',
        depreciationAmount: '95.00',
      }),
    ])
  })
})
