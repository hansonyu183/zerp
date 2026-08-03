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

    expect(mockedPost).not.toHaveBeenCalledWith(
      'led/asset/query',
      expect.anything(),
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

  it('loads active disposal candidates with contract-compliant pagination', async () => {
    mockedPost.mockImplementation(async (path, body) => {
      if (path !== 'led/asset/query') return { data: { items: [] } } as never
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
        depreciationMonth: '',
      },
    })
    await flushPromises()

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'led/asset/query', {
      page: 1,
      pageSize: 200,
      filters: { status: ['ACTIVE'] },
    })
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'led/asset/query', {
      page: 2,
      pageSize: 200,
      filters: { status: ['ACTIVE'] },
    })
    expect(wrapper.find('.responsive-table-wrap').exists()).toBe(true)
  })
})
