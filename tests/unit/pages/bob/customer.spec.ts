import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import Customer from '@/pages/bob/customer/Customer.vue'

const BobEntityPageStub = defineComponent({
  name: 'BobEntityPage',
  props: {
    model: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    return () => h('div', {
      class: 'bob-entity-page-stub',
      'data-entity': props.model.config.entity,
    })
  },
})

describe('Customer', () => {
  it('通过同目录 ViewModel 入口装配共享 BOB 页面', () => {
    const wrapper = mount(Customer, {
      global: {
        plugins: [createPinia()],
        stubs: {
          BobEntityPage: BobEntityPageStub,
        },
      },
    })

    expect(wrapper.get('.bob-entity-page-stub').attributes('data-entity'))
      .toBe('customer')
  })
})
