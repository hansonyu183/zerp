import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import SortableTableHeader from '@/components/common/SortableTableHeader.vue'

const VIconStub = defineComponent({
  name: 'VIcon',
  props: {
    icon: String,
    size: [String, Number],
  },
  setup(props) {
    return () =>
      h('i', {
        'data-icon': props.icon,
        'data-size': String(props.size),
      })
  },
})

function mountHeader(
  props: Partial<{
    label: string
    active: boolean
    direction: 'asc' | 'desc'
    align: 'start' | 'center' | 'end'
    width: string
  }> = {},
) {
  return mount(SortableTableHeader, {
    props: {
      label: '日期',
      ...props,
    },
    global: {
      components: {
        VIcon: VIconStub,
      },
    },
  })
}

describe('SortableTableHeader', () => {
  it('使用整列表头和右侧小图标触发鼠标及键盘排序', async () => {
    const wrapper = mountHeader()

    expect(wrapper.element.tagName).toBe('TH')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.attributes('tabindex')).toBe('0')
    expect(wrapper.attributes('aria-sort')).toBe('none')
    expect(wrapper.get('[data-icon]').attributes('data-icon')).toBe(
      'mdi-swap-vertical',
    )
    expect(wrapper.get('[data-icon]').attributes('data-size')).toBe('16')

    await wrapper.trigger('click')
    await wrapper.trigger('keydown.enter')
    await wrapper.trigger('keydown.space')

    expect(wrapper.emitted('sort')).toHaveLength(3)
  })

  it('按当前排序方向切换图标和无障碍状态', async () => {
    const wrapper = mountHeader({
      active: true,
      direction: 'asc',
      align: 'end',
      width: '120px',
    })

    expect(wrapper.classes()).toContain('text-end')
    expect(wrapper.attributes('style')).toContain('width: 120px')
    expect(wrapper.attributes('aria-sort')).toBe('ascending')
    expect(wrapper.get('[data-icon]').attributes('data-icon')).toBe(
      'mdi-arrow-up',
    )

    await wrapper.setProps({ direction: 'desc' })

    expect(wrapper.attributes('aria-sort')).toBe('descending')
    expect(wrapper.get('[data-icon]').attributes('data-icon')).toBe(
      'mdi-arrow-down',
    )
  })
})
