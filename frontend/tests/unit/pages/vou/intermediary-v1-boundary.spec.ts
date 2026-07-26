import { shallowMount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import IntermediarySaleOrder from '@/pages/vou/intermediary-sale-order/IntermediarySaleOrder.vue'

const mocks = vi.hoisted(() => ({
  useLegacyViewModel: vi.fn(() => ({ marker: 'V1' })),
}))

vi.mock('@/pages/vou/intermediary-sale-order/vm', () => ({
  useIntermediarySaleOrderViewModel: mocks.useLegacyViewModel,
}))

const VoucherEntityPageStub = defineComponent({
  name: 'VoucherEntityPage',
  props: { model: { type: Object, required: true } },
  setup(props) {
    return () => h('div', { class: 'legacy-v1' }, String(props.model.marker))
  },
})

describe('历史 V1 居间销售单边界', () => {
  it('只装配通用 VOU 页面，不加载 WFL 或 V2 切换器', () => {
    const wrapper = shallowMount(IntermediarySaleOrder, {
      global: {
        stubs: { VoucherEntityPage: VoucherEntityPageStub },
      },
    })

    expect(mocks.useLegacyViewModel).toHaveBeenCalledOnce()
    expect(wrapper.findComponent({ name: 'VoucherEntityPage' }).exists()).toBe(true)
    expect(wrapper.text()).not.toContain('V2')
    expect(wrapper.text()).not.toContain('业务流程')
  })
})
