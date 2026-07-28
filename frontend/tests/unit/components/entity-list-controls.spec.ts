import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import EntityListControls from '@/components/common/EntityListControls.vue'

const VBtnStub = defineComponent({
  name: 'VBtn',
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    loading: Boolean,
  },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled || props.loading,
          onClick: () => emit('click'),
        },
        slots.default?.(),
      )
  },
})

const VTextFieldStub = defineComponent({
  name: 'VTextField',
  props: {
    label: String,
    modelValue: String,
  },
  emits: ['update:modelValue', 'keyup'],
  setup(props, { emit }) {
    return () =>
      h('input', {
        'aria-label': props.label,
        value: props.modelValue,
        onInput: (event: Event) =>
          emit('update:modelValue', (event.target as HTMLInputElement).value),
        onKeyup: (event: KeyboardEvent) => emit('keyup', event),
      })
  },
})

const SlotStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  },
})

function mountControls(loading = false) {
  return mount(EntityListControls, {
    props: {
      keyword: '',
      searchLabel: '客户关键字',
      creatable: true,
      filterable: true,
      loading,
    },
    slots: {
      filters: '<label>状态筛选</label>',
    },
    global: {
      components: {
        VBtn: VBtnStub,
        VExpansionPanel: SlotStub,
        VExpansionPanels: SlotStub,
        VExpansionPanelText: SlotStub,
        VExpansionPanelTitle: SlotStub,
        VTextField: VTextFieldStub,
      },
    },
  })
}

describe('EntityListControls', () => {
  it('统一渲染筛选、查询和新增并发出对应事件', async () => {
    const wrapper = mountControls()

    expect(wrapper.text()).toContain('筛选条件')
    expect(wrapper.text()).toContain('状态筛选')

    await wrapper.get('input[aria-label="客户关键字"]').setValue('华东')
    await wrapper.get('input[aria-label="客户关键字"]').trigger('keyup.enter')
    for (const label of ['查询', '新增', '重置', '应用筛选']) {
      await wrapper
        .findAll('button')
        .find((button) => button.text() === label)
        ?.trigger('click')
    }

    expect(wrapper.emitted('update:keyword')).toEqual([['华东']])
    expect(wrapper.emitted('query')).toHaveLength(2)
    expect(wrapper.emitted('create')).toHaveLength(1)
    expect(wrapper.emitted('resetFilters')).toHaveLength(1)
    expect(wrapper.emitted('applyFilters')).toHaveLength(1)
  })

  it('加载时锁定新增和筛选操作', () => {
    const wrapper = mountControls(true)
    const buttons = wrapper.findAll('button')

    for (const label of ['新增', '重置', '应用筛选']) {
      expect(
        buttons
          .find((button) => button.text() === label)
          ?.attributes('disabled'),
      ).toBeDefined()
    }
  })
})
