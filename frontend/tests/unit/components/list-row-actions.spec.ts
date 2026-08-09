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
  it('renders primary and overflow actions and emits their keys', async () => {
    const wrapper = mount(ListRowActions, {
      props: {
        primary: [
          {
            key: 'edit',
            label: '编辑',
            icon: 'mdi-pencil-outline',
            color: 'primary',
          },
        ],
        more: [
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

    await wrapper.get('button[aria-label="编辑"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '删除')
      ?.trigger('click')

    expect(wrapper.emitted('select')).toEqual([['edit'], ['delete']])
    expect(wrapper.text()).toContain('编辑')
    expect(wrapper.text()).toContain('删除')
  })

  it('disables every action while loading', () => {
    const wrapper = mount(ListRowActions, {
      props: {
        loading: true,
        primary: [{ key: 'view', label: '查看', icon: 'mdi-eye-outline' }],
        more: [{ key: 'audit', label: '审核历史', icon: 'mdi-history' }],
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
        primary: [
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
