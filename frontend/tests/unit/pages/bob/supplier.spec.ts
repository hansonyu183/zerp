import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import Supplier from '@/pages/bob/supplier/Supplier.vue'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn() },
}))

describe('Supplier', () => {
  it('mounts the supplier-specific workspace rather than the generic BOB page', () => {
    const wrapper = mount(Supplier, { global: { plugins: [createPinia()] } })

    expect(wrapper.find('.supplier-workspace').exists()).toBe(true)
    expect(wrapper.find('.bob-entity-page').exists()).toBe(false)
    expect(wrapper.text()).toContain('新增供应商')
    expect(wrapper.text()).toContain('默认采购员')
    expect(
      wrapper
        .findAll('v-select')
        .some((item) => item.attributes('label') === '生命周期状态'),
    ).toBe(true)
    expect(wrapper.text()).not.toContain('业务员')
  })
})
