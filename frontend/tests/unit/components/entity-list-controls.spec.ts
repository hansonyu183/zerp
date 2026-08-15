import { mount } from '@vue/test-utils'
import {
  computed,
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  type ComputedRef,
  type InjectionKey,
} from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

interface ExpansionState {
  open: ComputedRef<boolean>
  toggle: () => void
}

const expansionStateKey: InjectionKey<ExpansionState> = Symbol('expansion')

const VExpansionPanelsStub = defineComponent({
  name: 'VExpansionPanels',
  props: { modelValue: String },
  emits: ['update:modelValue'],
  setup(props, { emit, slots }) {
    const open = computed(() => props.modelValue === 'filters')
    provide(expansionStateKey, {
      open,
      toggle: () =>
        emit('update:modelValue', open.value ? undefined : 'filters'),
    })
    return () => h('section', slots.default?.())
  },
})

const VExpansionPanelStub = defineComponent({
  name: 'VExpansionPanel',
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
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

function installMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

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
        VExpansionPanel: VExpansionPanelStub,
        VExpansionPanels: VExpansionPanelsStub,
        VExpansionPanelText: VExpansionPanelTextStub,
        VExpansionPanelTitle: VExpansionPanelTitleStub,
        VTextField: VTextFieldStub,
      },
    },
  })
}

describe('EntityListControls', () => {
  beforeEach(() => installMatchMedia(false))

  it('桌面初次进入默认展开筛选条件', () => {
    const wrapper = mountControls()

    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 700px)')
    expect(
      wrapper.get('[data-test="filter-toggle"]').attributes('aria-expanded'),
    ).toBe('true')
    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(true)
  })

  it('手机初次进入默认收起筛选条件', () => {
    installMatchMedia(true)
    const wrapper = mountControls()

    expect(
      wrapper.get('[data-test="filter-toggle"]').attributes('aria-expanded'),
    ).toBe('false')
    expect(wrapper.find('[data-test="filter-content"]').exists()).toBe(false)
  })

  it('用户切换后不因响应式变化覆盖展开状态', async () => {
    installMatchMedia(true)
    const wrapper = mountControls()
    const toggle = wrapper.get('[data-test="filter-toggle"]')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')

    installMatchMedia(false)
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(toggle.attributes('aria-expanded')).toBe('true')

    await toggle.trigger('click')
    installMatchMedia(true)
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(toggle.attributes('aria-expanded')).toBe('false')
  })

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

    for (const label of ['查询', '新增', '重置', '应用筛选']) {
      expect(
        buttons
          .find((button) => button.text() === label)
          ?.attributes('disabled'),
      ).toBeDefined()
    }
  })

  it('支持没有关键字输入的纯筛选列表', () => {
    const wrapper = mount(EntityListControls, {
      props: {
        searchable: false,
      },
      global: {
        components: {
          VBtn: VBtnStub,
          VTextField: VTextFieldStub,
        },
      },
    })

    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.text()).toContain('查询')
  })
})
