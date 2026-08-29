import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import Customer from '@/pages/bob/customer/Customer.vue'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn() },
}))

describe('Customer', () => {
  it('mounts the current effective read-only data rather than a customer editor', () => {
    const wrapper = mount(Customer, {
      global: { plugins: [createPinia()] },
    })

    expect(wrapper.find('.bob-customer-current').exists()).toBe(true)
    expect(wrapper.find('.customer-workspace').exists()).toBe(false)
    expect(wrapper.find('.bob-entity-page').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('新增客户')
  })
})
