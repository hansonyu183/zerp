import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import CompactTableField from '@/components/common/CompactTableField.vue'

const VTooltipStub = defineComponent({
  name: 'VTooltip',
  props: { text: String, disabled: Boolean },
  setup(props, { slots }) {
    return () =>
      h('div', [
        slots.activator?.({ props: {} }),
        !props.disabled ? h('span', { class: 'tooltip' }, props.text) : null,
      ])
  },
})

const VTextFieldStub = defineComponent({
  name: 'VTextField',
  inheritAttrs: false,
  props: { modelValue: String, error: Boolean },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () =>
      h('input', {
        ...attrs,
        value: props.modelValue,
        onInput: (event: Event) =>
          emit('update:modelValue', (event.target as HTMLInputElement).value),
      })
  },
})

describe('CompactTableField', () => {
  it('以不占用 details 区的状态和悬浮文本展示错误', () => {
    const wrapper = mount(CompactTableField, {
      props: {
        modelValue: '',
        rules: [(value) => Boolean(value) || '数量不能为空。'],
      },
      global: {
        components: {
          VTooltip: VTooltipStub,
          VTextField: VTextFieldStub,
        },
      },
    })

    expect(
      wrapper.get('.compact-table-field').attributes('data-error-text'),
    ).toBe('数量不能为空。')
    expect(wrapper.get('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('.tooltip').text()).toBe('数量不能为空。')
    expect(wrapper.find('.v-input__details').exists()).toBe(false)
  })
})
