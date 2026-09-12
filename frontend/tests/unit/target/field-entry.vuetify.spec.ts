import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h, nextTick } from 'vue'
import { VApp } from 'vuetify/components'
import { createVuetify } from 'vuetify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ResourceHost from '@/target/navigation/ResourceHost.vue'
import { useTargetSession } from '@/target/session/vm.ts'
import DynamicForm from '@/target/components/dynamic-fields/DynamicForm.vue'
import FieldInput from '@/target/components/dynamic-fields/FieldInput.vue'
import EditForm from '@/target/components/dynamic-fields/EditForm.vue'
import FormBlock from '@/target/components/dynamic-fields/FormBlock.vue'

const api = vi.hoisted(() => ({
  queryUnits: vi.fn(),
  createUnit: vi.fn(),
  queryRoles: vi.fn(),
}))
vi.mock('@/target/api.ts', async (original) => ({
  ...(await original<typeof import('@/target/api.ts')>()),
  queryTargetMeasurementUnits: api.queryUnits,
  createTargetMeasurementUnit: api.createUnit,
  queryTargetRoleOptions: api.queryRoles,
}))
const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})
function button(
  root: DOMWrapper<Element> | ReturnType<typeof mount>,
  text: string,
) {
  const found = root
    .findAll('button')
    .find((item) => item.text().trim() === text)
  if (!found) throw new Error(`缺少按钮：${text}`)
  return found
}
function byLabel(
  root: DOMWrapper<Element> | ReturnType<typeof mount>,
  text: string,
) {
  const label = root
    .findAll('label')
    .find((item) => item.text().trim() === text && item.attributes('for'))
  if (!label) throw new Error(`缺少字段：${text}`)
  return root.get(`[id="${label.attributes('for')}"]`)
}

vi.stubGlobal(
  'visualViewport',
  Object.assign(new EventTarget(), {
    width: 1024,
    height: 768,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
  }),
)
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

describe('真实录入字段', () => {
  it('局部明细不创建提交表单，整数未完成输入不会变成 NaN', async () => {
    const block = mount(FormBlock, {
      props: {
        fields: [{ key: 'months', type: 'integer', caption: '月数' }],
        modelValue: { months: 0 },
        disabled: false,
      },
      global: { plugins: [createVuetify()] },
    })
    expect(block.findAll('form')).toHaveLength(0)
    await block.get('input').setValue('-')
    expect(block.emitted('update:modelValue')?.at(-1)).toEqual([
      { months: '-' },
    ])
    block.unmount()
  })
  it('筛选金额保留精度并可显式清空', async () => {
    const field = mount(FieldInput, {
      props: {
        field: { key: 'amount', type: 'decimal', scale: 18, caption: '金额' },
        modelValue: '9007199254740993.000000000000000001',
      },
      global: { plugins: [createVuetify()] },
    })
    expect(field.get('input').element.value).toBe(
      '9007199254740993.000000000000000001',
    )
    expect(field.find('.v-field__clearable').exists()).toBe(true)
    await field.get('input').setValue('0.')
    expect(field.emitted('update:modelValue')?.at(-1)).toEqual(['0.'])
    await field.get('.v-field__clearable .v-icon').trigger('click')
    expect(field.emitted('update:modelValue')?.at(-1)).toEqual([''])
    field.unmount()
  })
  it('编辑保留多行、密码、false、条件可见与只读，并阻止 IME 提交', async () => {
    const form = mount(EditForm, {
      props: {
        fields: [
          { key: 'remark', type: 'textarea', caption: '备注' },
          { key: 'password', type: 'password', caption: '密码' },
          { key: 'enabled', type: 'boolean', caption: '启用' },
          { key: 'name', type: 'text', caption: '只读名称' },
          {
            key: 'carrier',
            type: 'text',
            caption: '外部承运人',
            visibleWhen: { key: 'carrierKind', value: 'EXTERNAL' },
          },
        ],
        modelValue: {
          remark: '第一行\n第二行',
          password: '',
          enabled: false,
          name: '保留名称',
          carrierKind: 'INTERNAL',
          carrier: '历史值',
        },
        disabled: false,
        readonlyFields: ['name'],
      },
      global: { plugins: [createVuetify()] },
    })
    mounted.push(form)
    expect(form.findAll('form')).toHaveLength(1)
    expect(form.get('textarea').element.value).toBe('第一行\n第二行')
    expect(form.get('input[type="password"]').exists()).toBe(true)
    expect(form.get('input[type="checkbox"]').element.checked).toBe(false)
    expect(byLabel(form, '只读名称').attributes('disabled')).toBeDefined()
    expect(form.text()).not.toContain('外部承运人')
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      cancelable: true,
      bubbles: true,
    })
    form.get('textarea').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(form.emitted('submit')).toBeUndefined()
    await form.setProps({
      modelValue: { ...form.props('modelValue'), carrierKind: 'EXTERNAL' },
    })
    expect(byLabel(form, '外部承运人').element.value).toBe('历史值')
    await form.get('form').trigger('submit')
    expect(form.emitted('submit')).toHaveLength(1)
  })

  it('已有不可再分配角色完整回显且可以显式移除，多选不改成协议字符串', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const session = useTargetSession()
    session.csrfToken = 'unit-test-csrf'
    session.apiPaths = ['/app/role/query']
    api.queryRoles.mockResolvedValue({
      items: [
        {
          id: 'new-role',
          code: 'NEW',
          name: '新角色',
          enabled: true,
          assignable: true,
          type: 'NORMAL',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const form = mount(EditForm, {
      attachTo: document.body,
      props: {
        fields: [
          {
            key: 'roles',
            type: 'multi-reference',
            source: 'roles',
            caption: '角色',
          },
        ],
        modelValue: { roles: ['old-role'] },
        disabled: false,
        existing: {
          roles: [{ id: 'old-role', name: '旧角色（已停用）', disabled: true }],
        },
      },
      global: { plugins: [pinia, createVuetify()] },
    })
    mounted.push(form)
    await flushPromises()
    expect(form.text()).toContain('旧角色（已停用）')
    expect(form.emitted('update:modelValue')).toBeUndefined()
    await form.get('.v-field__clearable .v-icon').trigger('click')
    await flushPromises()
    expect(form.emitted('update:modelValue')?.at(-1)).toEqual([{ roles: [] }])
    expect(api.queryRoles).toHaveBeenCalledWith({
      keyword: '',
      page: '1',
      pageSize: '20',
    })
  })

  it.each(['light', 'dark'])(
    '真实登记页面在 %s 主题通过字段保存并呈现语义图标',
    async (theme) => {
      const pinia = createPinia()
      setActivePinia(pinia)
      const session = useTargetSession()
      session.user = { id: 'unit-user', code: 'unit-user', name: '测试用户' }
      session.csrfToken = 'unit-test-csrf'
      session.apiPaths = [
        '/aux/measurement-unit/query',
        '/aux/measurement-unit/create',
      ]
      const record = {
        id: 'unit-1',
        code: 'UNIT1',
        py: 'dun',
        name: '吨',
        symbol: 't',
        quantityScale: 0,
        revision: '1',
        enabled: true,
        availableActions: [],
      }
      api.queryUnits
        .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
        .mockResolvedValue({ items: [record], total: 1, page: 1, pageSize: 20 })
      api.createUnit.mockResolvedValue(record)
      const wrapper = mount(
        {
          render: () =>
            h(VApp, () =>
              h(ResourceHost, { domain: 'aux', entity: 'measurement-unit' }),
            ),
        },
        {
          attachTo: document.body,
          global: {
            plugins: [pinia, createVuetify({ theme: { defaultTheme: theme } })],
          },
        },
      )
      mounted.push(wrapper)
      await flushPromises()
      const root = new DOMWrapper(document.body)
      const create = root.get('[data-testid="list-create"]')
      expect(create.get('.mdi-plus').attributes('aria-hidden')).toBe('true')
      expect(
        root
          .get('[data-testid="list-search"] .mdi-magnify')
          .attributes('aria-hidden'),
      ).toBe('true')
      await create.trigger('click')
      await flushPromises()
      await nextTick()
      const dialog = root.get('[role="dialog"]')
      await byLabel(dialog, '名称').setValue('吨')
      await byLabel(dialog, '符号').setValue('t')
      expect(byLabel(dialog, '数量精度').element.value).toBe('0')
      const save = button(root, '保存')
      expect(
        save.get('.mdi-content-save-outline').attributes('aria-hidden'),
      ).toBe('true')
      await save.trigger('click')
      await flushPromises()
      expect(api.createUnit).toHaveBeenCalledWith(
        'unit-test-csrf',
        { name: '吨', symbol: 't', quantityScale: 0 },
        {},
      )
      expect(api.queryUnits).toHaveBeenCalledTimes(2)
      expect(root.text()).toContain('吨')
    },
  )

  it('查询范围通过公共标量字段保留 0、false 和字符串精度，IME 不提交快照', async () => {
    const form = mount(DynamicForm, {
      props: {
        fields: [
          {
            key: 'amount',
            type: 'decimal',
            scale: 4,
            range: true,
            caption: '金额',
          },
          { key: 'enabled', type: 'boolean', caption: '状态' },
        ],
        modelValue: {
          amount: { from: '0.0000', to: '9007199254740993.0001' },
          enabled: false,
        },
      },
      global: { plugins: [createVuetify()] },
    })
    mounted.push(form)
    expect(byLabel(form, '金额起').element.value).toBe('0.0000')
    expect(byLabel(form, '金额止').element.value).toBe('9007199254740993.0001')
    const composing = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    })
    byLabel(form, '金额起').element.dispatchEvent(composing)
    expect(composing.defaultPrevented).toBe(true)
    expect(form.emitted('search')).toBeUndefined()
    await form.get('form').trigger('submit')
    expect(form.emitted('search')).toEqual([
      [
        {
          amount: { from: '0.0000', to: '9007199254740993.0001' },
          enabled: false,
        },
      ],
    ])
  })
})
