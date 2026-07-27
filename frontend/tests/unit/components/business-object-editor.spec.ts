import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import {
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  type Component,
  type InjectionKey,
} from 'vue'
import { describe, expect, it } from 'vitest'
import BusinessObjectEditor from '@/components/business-object/BusinessObjectEditor.vue'
import type { BusinessObjectField } from '@/components/business-object'

interface ExampleObject {
  id: string
  name: string
  notes: string
  creditLimit: number | null
  category: string
  establishedOn: string
  active: boolean
  optional: string | null
}

const model: ExampleObject = {
  id: 'C-1',
  name: '华东客户',
  notes: '重点客户',
  creditLimit: 10000,
  category: 'enterprise',
  establishedOn: '2026-07-01',
  active: true,
  optional: null,
}

const fields: readonly BusinessObjectField<ExampleObject>[] = [
  {
    key: 'id',
    label: '客户标识',
    type: 'readonly',
    format: (value) => `#${String(value)}`,
  },
  { key: 'name', label: '客户名称', type: 'text', required: true },
  { key: 'notes', label: '备注', type: 'textarea', span: 2 },
  {
    key: 'creditLimit',
    label: '信用额度',
    type: 'number',
    disabled: true,
    min: 0,
    step: 100,
  },
  {
    key: 'category',
    label: '客户类型',
    type: 'select',
    options: [
      { title: '企业客户', value: 'enterprise' },
      { title: '个人客户', value: 'personal', disabled: true },
    ],
  },
  { key: 'establishedOn', label: '成立日期', type: 'date' },
  {
    key: 'active',
    label: '启用',
    type: 'switch',
    trueLabel: '已启用',
    falseLabel: '已停用',
  },
  { key: 'optional', label: '可选信息', type: 'text' },
]

interface TestControl {
  validate: () => Promise<string[]>
  resetValidation: () => void
}

interface TestFormContext {
  register: (control: TestControl) => void
  unregister: (control: TestControl) => void
}

const testFormKey: InjectionKey<TestFormContext> = Symbol('test-form')

function containerStub(name: string, tag = 'div') {
  return defineComponent({
    name,
    setup(_, { slots }) {
      return () => h(tag, slots.default?.())
    },
  })
}

const VBtnStub = defineComponent({
  name: 'VBtn',
  props: {
    disabled: Boolean,
    loading: Boolean,
  },
  emits: ['click'],
  setup(props, { emit, slots }) {
    return () =>
      h(
        'button',
        {
          disabled: props.disabled || props.loading,
          onClick: () => emit('click'),
        },
        slots.default?.(),
      )
  },
})

const VFormStub = defineComponent({
  name: 'VForm',
  setup(_, { expose, slots }) {
    const controls = new Set<TestControl>()
    const register = (control: TestControl) => controls.add(control)
    const unregister = (control: TestControl) => controls.delete(control)
    const resetValidation = () => controls.forEach((control) => control.resetValidation())
    const validate = async () => {
      const errors = await Promise.all(
        [...controls].map((control) => control.validate()),
      )
      return { valid: errors.every((messages) => messages.length === 0) }
    }

    provide(testFormKey, { register, unregister })
    expose({ resetValidation, validate })
    return () => h('form', slots.default?.())
  },
})

function inputStub(name: string, className: string) {
  return defineComponent({
    name,
    props: {
      disabled: Boolean,
      label: String,
      modelValue: null,
      type: String,
      rules: {
        type: Array,
        default: () => [],
      },
    },
    emits: ['update:modelValue', 'update:search'],
    setup(props) {
      const form = inject(testFormKey, null)
      const errors = ref<string[]>([])
      const control: TestControl = {
        async validate() {
          const messages: string[] = []
          for (const rule of props.rules as Array<
            (value: unknown) => true | string | Promise<true | string>
          >) {
            const result = await rule(props.modelValue)
            if (result !== true) messages.push(result)
          }
          errors.value = messages
          return messages
        },
        resetValidation() {
          errors.value = []
        },
      }

      onMounted(() => form?.register(control))
      onBeforeUnmount(() => form?.unregister(control))

      return () =>
        h('div', { class: className }, [
          h('span', props.label),
          ...errors.value.map((message) =>
            h('span', { class: 'test-error' }, message),
          ),
        ])
    },
  })
}

const testComponents = {
  VAlert: containerStub('VAlert'),
  VAutocomplete: inputStub('VAutocomplete', 'v-autocomplete'),
  VBtn: VBtnStub,
  VCard: containerStub('VCard'),
  VCardText: containerStub('VCardText'),
  VDivider: containerStub('VDivider', 'hr'),
  VForm: VFormStub,
  VNumberInput: inputStub('VNumberInput', 'v-number-input'),
  VSelect: inputStub('VSelect', 'v-select'),
  VSkeletonLoader: containerStub('VSkeletonLoader'),
  VSwitch: inputStub('VSwitch', 'v-switch'),
  VTextarea: inputStub('VTextarea', 'v-textarea'),
  VTextField: inputStub('VTextField', 'v-text-field'),
}

function mountEditor(
  props: Partial<{
    modelValue: ExampleObject
    fields: readonly BusinessObjectField<ExampleObject>[]
    editing: boolean
    title: string
    editable: boolean
    loading: boolean
    saving: boolean
    resetKey: string | number
    errorMessage: string | null
    emptyText: string
  }> = {},
  slots: Record<string, unknown> = {},
): VueWrapper {
  return mount(BusinessObjectEditor as Component, {
    props: {
      modelValue: structuredClone(model),
      fields,
      editing: false,
      ...props,
    },
    slots,
    global: {
      components: testComponents,
    },
  })
}

function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper
    .findAllComponents({ name: 'VBtn' })
    .find((item) => item.text().trim() === text)

  if (!button) throw new Error(`找不到按钮：${text}`)
  return button
}

describe('BusinessObjectEditor', () => {
  it('按字段配置展示格式化值、空值和双列跨度', async () => {
    const wrapper = mountEditor()

    expect(wrapper.text()).toContain('业务对象')
    expect(wrapper.get('[data-field="category"]').text()).toContain('企业客户')
    expect(wrapper.get('[data-field="active"]').text()).toContain('已启用')
    expect(wrapper.get('[data-field="id"]').text()).toContain('#C-1')
    expect(wrapper.get('[data-field="optional"]').text()).toContain('—')
    expect(wrapper.get('[data-field="notes"]').classes()).toContain(
      'business-object-editor__field--wide',
    )

    await buttonByText(wrapper, '编辑').trigger('click')
    expect(wrapper.emitted('update:editing')).toEqual([[true]])
  })

  it('编辑时渲染全部内置控件并保持原对象不变', async () => {
    const original = structuredClone(model)
    const wrapper = mountEditor({ modelValue: original, editing: true })

    expect(wrapper.findAllComponents({ name: 'VTextField' })).toHaveLength(3)
    expect(wrapper.findAllComponents({ name: 'VTextarea' })).toHaveLength(1)
    expect(wrapper.findAllComponents({ name: 'VNumberInput' })).toHaveLength(1)
    expect(wrapper.findAllComponents({ name: 'VSelect' })).toHaveLength(1)
    expect(wrapper.findAllComponents({ name: 'VSwitch' })).toHaveLength(1)
    expect(wrapper.get('[data-field="id"]').text()).toContain('C-1')
    expect(
      wrapper
        .getComponent('[data-field="creditLimit"] .v-number-input')
        .props('disabled'),
    ).toBe(true)
    expect(
      wrapper
        .getComponent('[data-field="establishedOn"] .v-text-field')
        .props('type'),
    ).toBe('date')

    wrapper
      .getComponent('[data-field="name"] .v-text-field')
      .vm.$emit('update:modelValue', '华南客户')
    await wrapper.vm.$nextTick()

    expect(original.name).toBe('华东客户')

    await buttonByText(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(wrapper.emitted<ExampleObject[]>('save')?.[0]?.[0]).toMatchObject({
      name: '华南客户',
      id: 'C-1',
    })
  })

  it('支持异步关联搜索和按草稿条件显示字段', async () => {
    const advancedFields: readonly BusinessObjectField<ExampleObject>[] = [
      {
        key: 'category',
        label: '客户类型',
        type: 'autocomplete',
        options: [{ title: '企业客户', value: 'enterprise' }],
      },
      {
        key: 'notes',
        label: '备注',
        type: 'textarea',
        required: true,
        visible: (record) => record.active,
      },
    ]
    const wrapper = mountEditor({
      editing: true,
      fields: advancedFields,
    })

    const autocomplete = wrapper.getComponent({ name: 'VAutocomplete' })
    autocomplete.vm.$emit('update:search', '企业')
    await flushPromises()

    expect(wrapper.emitted('reference-search')?.[0]?.slice(0, 2)).toEqual([
      'category',
      '企业',
    ])
    expect(wrapper.get('[data-field="notes"]').isVisible()).toBe(true)

    const hiddenWrapper = mountEditor({
      editing: true,
      fields: advancedFields,
      modelValue: { ...model, active: false, notes: '' },
    })
    expect(hiddenWrapper.find('[data-field="notes"]').exists()).toBe(false)
    await buttonByText(hiddenWrapper, '保存').trigger('click')
    await flushPromises()
    expect(hiddenWrapper.emitted('save')).toHaveLength(1)
  })

  it('默认隐藏高级币种并在非 CNY 或手工展开时显示', async () => {
    const currencyFields: readonly BusinessObjectField<ExampleObject>[] = [{
      key: 'optional',
      label: '币种',
      type: 'text',
      advanced: true,
    }]
    const wrapper = mountEditor({
      editing: true,
      fields: currencyFields,
      modelValue: { ...model, optional: 'CNY' },
    })

    expect(wrapper.find('[data-field="optional"]').exists()).toBe(false)
    await wrapper.get('.business-object-editor__advanced-button').trigger('click')
    expect(wrapper.find('[data-field="optional"]').exists()).toBe(true)

    const foreignCurrency = mountEditor({
      editing: true,
      fields: currencyFields,
      modelValue: { ...model, optional: 'USD' },
    })
    expect(foreignCurrency.find('[data-field="optional"]').exists()).toBe(true)
  })

  it('取消编辑会丢弃草稿并保留编辑期间收到的外部对象', async () => {
    const wrapper = mountEditor({ editing: true })

    wrapper
      .getComponent('[data-field="name"] .v-text-field')
      .vm.$emit('update:modelValue', '本地草稿')
    await wrapper.setProps({
      modelValue: {
        ...model,
        name: '服务端更新',
      },
    })

    expect(
      wrapper.getComponent('[data-field="name"] .v-text-field').props('modelValue'),
    ).toBe('本地草稿')

    await buttonByText(wrapper, '取消').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('update:editing')?.at(-1)).toEqual([false])

    await wrapper.setProps({ editing: false })
    expect(wrapper.get('[data-field="name"]').text()).toContain('服务端更新')
  })

  it('resetKey 变化时使用最新外部对象重建草稿', async () => {
    const wrapper = mountEditor({ editing: true, resetKey: 0 })

    wrapper
      .getComponent('[data-field="name"] .v-text-field')
      .vm.$emit('update:modelValue', '本地草稿')
    await wrapper.setProps({
      modelValue: {
        ...model,
        name: '服务端更新',
      },
    })

    expect(
      wrapper.getComponent('[data-field="name"] .v-text-field').props('modelValue'),
    ).toBe('本地草稿')

    await wrapper.setProps({ resetKey: 1 })
    expect(
      wrapper.getComponent('[data-field="name"] .v-text-field').props('modelValue'),
    ).toBe('服务端更新')
  })

  it('校验必填与异步规则，失败时不发出保存事件', async () => {
    const validationFields: readonly BusinessObjectField<ExampleObject>[] = [
      {
        key: 'name',
        label: '客户名称',
        type: 'text',
        required: true,
      },
      {
        key: 'notes',
        label: '备注',
        type: 'textarea',
        rules: [
          async (value, record) =>
            record.active && !value ? '启用客户必须填写备注。' : true,
        ],
      },
    ]
    const wrapper = mountEditor({
      editing: true,
      fields: validationFields,
      modelValue: {
        ...model,
        name: '',
        notes: '',
      },
    })

    await buttonByText(wrapper, '保存').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.text()).toContain('请输入客户名称。')
    expect(wrapper.text()).toContain('启用客户必须填写备注。')
  })

  it('支持加载、保存锁定、错误提示和动态字段插槽', async () => {
    const loadingWrapper = mountEditor({ loading: true })
    expect(loadingWrapper.findComponent({ name: 'VSkeletonLoader' }).exists()).toBe(true)
    expect(buttonByText(loadingWrapper, '编辑').props('disabled')).toBe(true)

    const wrapper = mountEditor(
      {
        editing: true,
        saving: true,
        errorMessage: '保存失败（请求编号：REQ-1）',
      },
      {
        'input-name': ({
          setValue,
          value,
        }: {
          setValue: (value: unknown) => void
          value: unknown
        }) =>
          h(
            'button',
            {
              class: 'custom-name-input',
              onClick: () => setValue('插槽客户'),
              type: 'button',
            },
            String(value),
          ),
      },
    )

    expect(wrapper.text()).toContain('保存失败（请求编号：REQ-1）')
    expect(buttonByText(wrapper, '保存').props('loading')).toBe(true)
    expect(buttonByText(wrapper, '取消').props('disabled')).toBe(true)
    expect(
      wrapper.getComponent('[data-field="notes"] .v-textarea').props('disabled'),
    ).toBe(true)

    await wrapper.get('.custom-name-input').trigger('click')
    await buttonByText(wrapper, '保存').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('允许覆盖展示字段并精确控制编辑入口', async () => {
    const wrapper = mountEditor(
      { editable: false, emptyText: '未填写' },
      {
        'display-name': ({ value }: { value: unknown }) =>
          h('strong', { class: 'custom-name' }, `#${String(value)}`),
      },
    )

    expect(wrapper.get('.custom-name').text()).toBe('#华东客户')
    expect(wrapper.text()).toContain('未填写')
    expect(
      wrapper
        .findAllComponents({ name: 'VBtn' })
        .some((button) => button.text().trim() === '编辑'),
    ).toBe(false)
  })
})
