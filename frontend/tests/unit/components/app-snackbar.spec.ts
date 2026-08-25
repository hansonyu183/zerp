import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import AppSnackbar from '@/components/common/AppSnackbar.vue'

const passthrough = (name: string, tag = 'div') =>
  defineComponent({
    name,
    inheritAttrs: false,
    props: { modelValue: Boolean },
    emits: ['update:modelValue', 'click'],
    setup(_, { attrs, emit, slots }) {
      return () =>
        h(tag, { ...attrs, onClick: () => emit('click') }, [
          slots.default?.(),
          slots.actions?.(),
        ])
    },
  })

describe('AppSnackbar', () => {
  it('用浮层显示中文安全提示并过滤请求编号', async () => {
    const wrapper = mount(AppSnackbar, {
      props: { message: '保存失败（请求编号：REQ-1）' },
      global: {
        components: {
          VBtn: passthrough('VBtn', 'button'),
          VIcon: passthrough('VIcon', 'span'),
          VSnackbar: passthrough('VSnackbar'),
        },
      },
    })

    expect(wrapper.text()).toContain('保存失败')
    expect(wrapper.text()).not.toContain('REQ-1')
    await wrapper.get('button[aria-label="关闭提示"]').trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('显示已经清理过的英文可读业务说明', () => {
    const wrapper = mount(AppSnackbar, {
      props: { message: 'A newer business rule must be completed first.' },
      global: {
        components: {
          VBtn: passthrough('VBtn', 'button'),
          VIcon: passthrough('VIcon', 'span'),
          VSnackbar: passthrough('VSnackbar'),
        },
      },
    })

    expect(wrapper.text()).toContain(
      'A newer business rule must be completed first.',
    )
  })
})
