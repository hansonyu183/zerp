import { mount, type VueWrapper } from '@vue/test-utils'
import {
  defineComponent,
  h,
  inject,
  provide,
  ref,
  type Component,
  type InjectionKey,
  type Ref,
} from 'vue'
import { describe, expect, it } from 'vitest'
import VoucherList from '@/components/voucher/VoucherList.vue'

interface ExpansionState {
  open: Ref<boolean>
  toggle: () => void
}

const expansionStateKey: InjectionKey<ExpansionState> = Symbol('expansion-state')

const VExpansionPanelsStub = defineComponent({
  name: 'VExpansionPanels',
  setup(_, { slots }) {
    return () => h('section', { class: 'expansion-panels' }, slots.default?.())
  },
})

const VExpansionPanelStub = defineComponent({
  name: 'VExpansionPanel',
  setup(_, { slots }) {
    const open = ref(false)
    provide(expansionStateKey, {
      open,
      toggle: () => {
        open.value = !open.value
      },
    })
    return () => h('div', { class: 'expansion-panel' }, slots.default?.())
  },
})

const VExpansionPanelTitleStub = defineComponent({
  name: 'VExpansionPanelTitle',
  setup(_, { slots }) {
    const state = inject(expansionStateKey)
    return () =>
      h(
        'button',
        {
          'aria-expanded': String(state?.open.value ?? false),
          'data-test': 'filter-toggle',
          onClick: state?.toggle,
        },
        slots.default?.(),
      )
  },
})

const VExpansionPanelTextStub = defineComponent({
  name: 'VExpansionPanelText',
  setup(_, { slots }) {
    const state = inject(expansionStateKey)
    return () =>
      state?.open.value
        ? h('div', { 'data-test': 'filter-content' }, slots.default?.())
        : null
  },
})

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

const VTableStub = defineComponent({
  name: 'VTable',
  setup(_, { slots }) {
    return () => h('table', slots.default?.())
  },
})

const passthroughStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    setup(_, { slots }) {
      return () => h(tag, slots.default?.())
    },
  })

function mountList(
  props: Partial<{
    keyword: string
    loading: boolean
    queryable: boolean
    creatable: boolean
  }> = {},
): VueWrapper {
  return mount(VoucherList as Component, {
    props: {
      rows: [],
      total: 0,
      page: 1,
      pageSize: 20,
      keyword: '',
      statuses: [],
      dateFrom: '',
      dateTo: '',
      sort: { field: 'updatedAt', order: 'desc' },
      party: null,
      ...props,
    },
    global: {
      components: {
        VBtn: VBtnStub,
        VBtnToggle: passthroughStub('VBtnToggle'),
        VCard: passthroughStub('VCard', 'section'),
        VCardActions: passthroughStub('VCardActions'),
        VCardTitle: passthroughStub('VCardTitle'),
        VChip: passthroughStub('VChip', 'span'),
        VExpansionPanel: VExpansionPanelStub,
        VExpansionPanels: VExpansionPanelsStub,
        VExpansionPanelText: VExpansionPanelTextStub,
        VExpansionPanelTitle: VExpansionPanelTitleStub,
        VProgressLinear: passthroughStub('VProgressLinear'),
        VSelect: passthroughStub('VSelect'),
        VSpacer: passthroughStub('VSpacer'),
        VTable: VTableStub,
        VTextField: VTextFieldStub,
      },
    },
  })
}

describe('VoucherList', () => {
  it('使用适合窄屏的短列名', () => {
    const wrapper = mountList()

    expect(wrapper.findAll('th').map((heading) => heading.text())).toEqual([
      '单号',
      '日期',
      '往来方',
      '状态',
      '币种',
      '金额',
      '更新',
      '操作',
    ])
  })

  it('默认收起筛选条件并允许反复展开和收起', async () => {
    const wrapper = mountList()
    const toggle = wrapper.get('[data-test="filter-toggle"]')

    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(false)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(true)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(false)
  })

  it('折叠切换保留筛选值并继续发出查询和重置事件', async () => {
    const wrapper = mountList({ keyword: '华东客户' })
    const toggle = wrapper.get('[data-test="filter-toggle"]')

    await toggle.trigger('click')
    expect(
      wrapper.get('input[aria-label="单号或往来方关键字"]').attributes('value'),
    ).toBe('华东客户')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查询')
      ?.trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重置')
      ?.trigger('click')

    await toggle.trigger('click')
    await toggle.trigger('click')
    expect(
      wrapper.get('input[aria-label="单号或往来方关键字"]').attributes('value'),
    ).toBe('华东客户')
    expect(wrapper.emitted('query')).toHaveLength(1)
    expect(wrapper.emitted('reset')).toHaveLength(1)
  })

  it('新建入口独立于筛选面板并遵循权限和加载状态', async () => {
    const wrapper = mountList({ creatable: true })
    const createButton = wrapper
      .findAll('button')
      .find((button) => button.text() === '新建单据')

    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(false)
    expect(createButton?.exists()).toBe(true)
    await createButton?.trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)

    await wrapper.setProps({ loading: true })
    expect(createButton?.attributes('disabled')).toBeDefined()

    await wrapper.setProps({ creatable: false, loading: false })
    expect(
      wrapper.findAll('button').some((button) => button.text() === '新建单据'),
    ).toBe(false)
  })
})
