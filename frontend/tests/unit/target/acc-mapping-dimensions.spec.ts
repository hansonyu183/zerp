import { shallowMount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { defineComponent } from 'vue'
import MappingDimensions from '@/target/pages/acc/mapping/MappingDimensions.vue'
it('retains visible removable dimension inputs when a selected subject no longer requires them', async () => {
  const select = defineComponent({
    props: ['label', 'modelValue'],
    emits: ['update:modelValue'],
    template:
      '<button @click="$emit(\'update:modelValue\', null)">{{ label }}</button>',
  })
  const wrapper = shallowMount(MappingDimensions, {
    props: {
      fields: ['customer'],
      dimensions: ['CUSTOMER_SUBUNIT'],
      modelValue: { CUSTOMER_SUBUNIT: 'customer' },
    },
    global: { stubs: { 'v-select': select } },
  })
  await wrapper.setProps({ dimensions: [] })
  expect(wrapper.text()).toContain('客户子单位')
  await wrapper.get('button').trigger('click')
  expect(wrapper.emitted('update:modelValue')).toEqual([[{}]])
})
