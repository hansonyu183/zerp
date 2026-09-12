import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
vi.mock('vuetify', () => ({ useDisplay: () => ({ xs: false }) }))

import DynamicCols from '@/target/components/dynamic-fields/DynamicCols.vue'
import DynamicForm from '@/target/components/dynamic-fields/DynamicForm.vue'
import FieldCol from '@/target/components/dynamic-fields/FieldCol.vue'
import RowActions from '@/target/components/dynamic-fields/RowActions.vue'

const VForm = defineComponent({
  emits: ['submit'],
  setup(_, { emit, slots }) {
    return () =>
      h(
        'form',
        {
          'data-testid': 'form',
          onSubmit: (event: Event) => {
            event.preventDefault()
            emit('submit', event)
          },
        },
        slots.default?.(),
      )
  },
})

const VTextField = defineComponent({
  props: ['modelValue', 'label', 'disabled'],
  emits: ['update:modelValue'],
  template:
    '<label>{{ label }}<input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" /></label>',
})

const VSelect = defineComponent({
  props: ['modelValue', 'label', 'items', 'disabled'],
  template:
    '<label :data-value="String(modelValue)" :data-disabled="String(disabled)" :data-option-disabled="String(items?.[1]?.props?.disabled)">{{ label }}</label>',
})

const VAlert = defineComponent({
  template: '<p data-testid="field-error"><slot /></p>',
})

const VBtn = defineComponent({
  props: ['disabled', 'loading'],
  emits: ['click'],
  template:
    '<button :disabled="disabled" :data-loading="String(loading)" @click="$emit(\'click\')"><slot /></button>',
})

const VDataTable = defineComponent({
  props: ['headers', 'items'],
  setup(props, { slots }) {
    return () =>
      h(
        'div',
        { 'data-testid': 'data-table' },
        (props.items as Record<string, unknown>[]).flatMap((item) =>
          (props.headers as { key: string }[]).map((header) =>
            slots[`item.${header.key}`]?.({ item }),
          ),
        ),
      )
  },
})

describe('finite field renderers', () => {
  it('renders exact values and legal empty values through FieldCol', async () => {
    const wrapper = mount(FieldCol, {
      props: {
        field: { key: 'amount', type: 'decimal', caption: '金额', scale: 2 },
        value: '9007199254740993.1',
      },
    })
    expect(wrapper.text()).toBe('9007199254740993.10')

    await wrapper.setProps({
      field: {
        key: 'enabled',
        type: 'boolean',
        caption: '状态',
        trueCaption: '启用',
        falseCaption: '停用',
      },
      value: false,
    })
    expect(wrapper.text()).toBe('停用')

    await wrapper.setProps({
      field: { key: 'count', type: 'integer', caption: '数量' },
      value: 0,
    })
    expect(wrapper.text()).toBe('0')
    await wrapper.setProps({ value: null })
    expect(wrapper.text()).toBe('—')
  })

  it('normalizes the full DynamicForm snapshot and ignores composing Enter', async () => {
    const wrapper = mount(DynamicForm, {
      props: {
        fields: [
          { key: 'keyword', type: 'text', caption: '关键词' },
          { key: 'enabled', type: 'boolean', caption: '状态' },
          {
            key: 'roleId',
            type: 'reference',
            caption: '角色',
            source: 'app/role',
          },
        ],
        modelValue: { keyword: null, enabled: false, roleId: 'role-1' },
      },
      global: {
        components: { VAlert, VBtn, VForm, VTextField, VSelect },
        stubs: { ReferencePicker: true },
      },
    })

    const composing = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    wrapper.get('[data-testid="form"]').element.dispatchEvent(composing)
    expect(composing.defaultPrevented).toBe(true)
    expect(wrapper.emitted('search')).toBeUndefined()

    await wrapper.get('[data-testid="form"]').trigger('submit')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({
      keyword: '',
      enabled: false,
      roleId: 'role-1',
    })
    expect(wrapper.emitted('search')).toHaveLength(1)
  })

  it('keeps invalid input visible and blocks disabled form submission', async () => {
    const wrapper = mount(DynamicForm, {
      props: {
        fields: [{ key: 'quantity', type: 'integer', caption: '数量' }],
        modelValue: { quantity: Number.MAX_SAFE_INTEGER + 1 },
      },
      global: {
        components: { VAlert, VBtn, VForm, VTextField, VSelect },
        stubs: { ReferencePicker: true },
      },
    })

    await wrapper.get('[data-testid="form"]').trigger('submit')
    expect(wrapper.get('[data-testid="field-error"]').text()).toContain(
      '安全整数',
    )
    expect(wrapper.emitted('search')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await wrapper.setProps({ modelValue: { quantity: 0 } })
    await wrapper.get('[data-testid="form"]').trigger('submit')
    expect(wrapper.find('[data-testid="field-error"]').exists()).toBe(false)
    expect(wrapper.emitted('search')).toHaveLength(1)

    await wrapper.setProps({ disabled: true })
    await wrapper.get('[data-testid="form"]').trigger('submit')
    expect(wrapper.emitted('search')).toHaveLength(1)
  })

  it('renders every column through DynamicCols and delegates one actions slot', () => {
    const wrapper = mount(DynamicCols, {
      props: {
        fields: [
          { key: 'name', type: 'text', caption: '名称', required: true },
          {
            key: 'status',
            type: 'enum',
            caption: '状态',
            options: [{ value: 'OPEN', caption: '开启' }],
          },
          { key: '$actions', type: 'actions', caption: '操作' },
        ],
        items: [{ id: 'one', name: '<b>安全文本</b>', status: 'OPEN' }],
      },
      slots: { actions: ({ item }) => h('span', `打开 ${item.id}`) },
      global: { components: { VDataTable } },
    })

    expect(wrapper.text()).toContain('<b>安全文本</b>')
    expect(wrapper.html()).not.toContain('<b>安全文本</b>')
    expect(wrapper.text()).toContain('开启')
    expect(wrapper.text()).toContain('打开 one')
  })

  it('keeps RowActions data-only and emits the selected key', async () => {
    const wrapper = mount(RowActions, {
      props: {
        actions: [
          { key: 'edit', caption: '编辑' },
          { key: 'disable', caption: '停用', disabled: true, loading: true },
        ],
      },
      global: { components: { VBtn } },
    })

    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['edit']])
    expect(wrapper.findAll('button')[1]!.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button')[1]!.attributes('data-loading')).toBe(
      'true',
    )
    expect(() =>
      mount(RowActions, {
        props: {
          actions: [
            { key: 'unsafe', caption: '不安全', onClick: () => undefined },
          ] as never,
        },
        global: { components: { VBtn } },
      }),
    ).toThrow('不允许配置 onClick')
  })
})
