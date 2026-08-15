import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import ListRowActions from '@/components/common/ListRowActions.vue'

const VBtnStub = defineComponent({
  name: 'VBtn',
  inheritAttrs: false,
  props: { disabled: Boolean },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled,
          onClick: () => emit('click'),
        },
        slots.default?.(),
      )
  },
})

const VMenuStub = defineComponent({
  name: 'VMenu',
  setup(_, { slots }) {
    return () =>
      h('div', [
        slots.activator?.({ props: {} }),
        h('div', { class: 'menu' }, slots.default?.()),
      ])
  },
})

const VListItemStub = defineComponent({
  name: 'VListItem',
  inheritAttrs: false,
  props: { title: String, disabled: Boolean },
  emits: ['click'],
  setup(props, { attrs, emit }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled,
          onClick: () => emit('click'),
        },
        props.title,
      )
  },
})

describe('ListRowActions', () => {
  it('0 个动作时不渲染按钮', () => {
    const wrapper = mount(ListRowActions, {
      props: { actions: [] },
      global: {
        components: {
          VBtn: VBtnStub,
          VIcon: defineComponent({ render: () => h('span') }),
        },
      },
    })

    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('1 个动作时直接显示且不渲染更多', () => {
    const wrapper = mount(ListRowActions, {
      props: {
        actions: [
          {
            key: 'edit',
            label: '编辑',
            icon: 'mdi-pencil-outline',
            color: 'primary',
          },
        ],
      },
      global: {
        components: {
          VBtn: VBtnStub,
          VIcon: defineComponent({ render: () => h('span') }),
        },
      },
    })

    expect(wrapper.find('[aria-label="编辑"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="更多操作"]').exists()).toBe(false)
  })

  it('3 个动作时按业务顺序全部直接显示', () => {
    const wrapper = mount(ListRowActions, {
      props: {
        actions: [
          { key: 'view', label: '查看', icon: 'mdi-eye-outline' },
          { key: 'edit', label: '编辑', icon: 'mdi-pencil-outline' },
          { key: 'delete', label: '删除', icon: 'mdi-delete-outline' },
        ],
      },
      global: {
        components: {
          VBtn: VBtnStub,
          VIcon: defineComponent({ render: () => h('span') }),
        },
      },
    })

    expect(
      wrapper
        .findAll('.list-row-actions__primary button')
        .map((button) => button.attributes('aria-label')),
    ).toEqual(['查看', '编辑', '删除'])
    expect(wrapper.find('[aria-label="更多操作"]').exists()).toBe(false)
  })

  it('4 个动作时前三项直显且其余按顺序进入更多', async () => {
    const wrapper = mount(ListRowActions, {
      props: {
        actions: [
          { key: 'view', label: '查看', icon: 'mdi-eye-outline' },
          { key: 'edit', label: '编辑', icon: 'mdi-pencil-outline' },
          { key: 'approve', label: '批准', icon: 'mdi-check' },
          {
            key: 'delete',
            label: '删除',
            icon: 'mdi-delete-outline',
            color: 'error',
          },
        ],
      },
      global: {
        components: {
          VBtn: VBtnStub,
          VIcon: defineComponent({ render: () => h('span') }),
          VList: defineComponent({
            setup(_, { slots }) {
              return () => h('div', slots.default?.())
            },
          }),
          VListItem: VListItemStub,
          VMenu: VMenuStub,
        },
      },
    })

    expect(
      wrapper
        .findAll('.list-row-actions__primary button')
        .map((button) => button.attributes('aria-label')),
    ).toEqual(['查看', '编辑', '批准'])
    expect(wrapper.get('[aria-label="更多操作"]').exists()).toBe(true)
    expect(wrapper.get('.menu').text()).toBe('删除')

    await wrapper.get('button[aria-label="编辑"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '删除')
      ?.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['edit'], ['delete']])
  })

  it('手机卡片复用同一动作列表和分流规则', () => {
    const wrapper = mount(ListRowActions, {
      attrs: { class: 'phone-card__actions' },
      props: {
        actions: [
          { key: 'view', label: '查看流程', icon: 'mdi-eye-outline' },
          { key: 'root', label: '打开根单据', icon: 'mdi-file-outline' },
          { key: 'audit', label: '审核历史', icon: 'mdi-history' },
          { key: 'delete', label: '删除', icon: 'mdi-delete-outline' },
        ],
      },
      global: {
        components: {
          VBtn: VBtnStub,
          VIcon: defineComponent({ render: () => h('span') }),
          VList: defineComponent({
            setup(_, { slots }) {
              return () => h('div', slots.default?.())
            },
          }),
          VListItem: VListItemStub,
          VMenu: VMenuStub,
        },
      },
    })

    expect(wrapper.classes()).toContain('phone-card__actions')
    expect(
      wrapper
        .findAll('.list-row-actions__primary button')
        .map((button) => button.attributes('aria-label')),
    ).toEqual(['查看流程', '打开根单据', '审核历史'])
    expect(wrapper.get('.menu').text()).toBe('删除')
  })

  it('disables every action while loading', () => {
    const wrapper = mount(ListRowActions, {
      props: {
        loading: true,
        actions: [
          { key: 'view', label: '查看', icon: 'mdi-eye-outline' },
          { key: 'edit', label: '编辑', icon: 'mdi-pencil-outline' },
          { key: 'approve', label: '批准', icon: 'mdi-check' },
          { key: 'audit', label: '审核历史', icon: 'mdi-history' },
        ],
      },
      global: {
        components: {
          VBtn: VBtnStub,
          VIcon: defineComponent({ render: () => h('span') }),
          VList: defineComponent({
            setup(_, { slots }) {
              return () => h('div', slots.default?.())
            },
          }),
          VListItem: VListItemStub,
          VMenu: VMenuStub,
        },
      },
    })

    expect(
      wrapper
        .findAll('button')
        .every((button) => button.attributes('disabled') !== undefined),
    ).toBe(true)
  })

  it('explains why an available row action is disabled', () => {
    const wrapper = mount(ListRowActions, {
      props: {
        actions: [
          {
            key: 'approve',
            label: '审核通过',
            icon: 'mdi-check',
            disabled: true,
            disabledReason: '提交人不能审核自己提交的版本。',
          },
        ],
      },
      global: {
        components: {
          VBtn: VBtnStub,
          VIcon: defineComponent({ render: () => h('span') }),
        },
      },
    })

    expect(
      wrapper.get('span.list-row-actions__primary').attributes('title'),
    ).toBe('提交人不能审核自己提交的版本。')
    expect(wrapper.get('button').attributes('aria-label')).toBe(
      '审核通过：提交人不能审核自己提交的版本。',
    )
  })
})
