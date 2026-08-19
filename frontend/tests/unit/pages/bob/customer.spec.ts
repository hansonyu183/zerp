import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import Customer from '@/pages/bob/customer/Customer.vue'

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

describe('Customer', () => {
  it('mounts the customer-specific workspace rather than the generic BOB page', () => {
    const wrapper = mount(Customer, {
      global: { plugins: [createPinia()] },
    })

    expect(wrapper.find('.customer-workspace').exists()).toBe(true)
    expect(wrapper.find('.bob-entity-page').exists()).toBe(false)
    expect(wrapper.text()).toContain('新增客户')
  })
})
