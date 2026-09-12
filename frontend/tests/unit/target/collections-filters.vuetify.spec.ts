import { defineComponent, nextTick, reactive, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import { afterEach, expect, it, vi } from 'vitest'
import DynamicCols from '@/target/components/dynamic-fields/DynamicCols.vue'
import DynamicForm from '@/target/components/dynamic-fields/DynamicForm.vue'
import DateRangeInput from '@/target/components/dynamic-fields/DateRangeInput.vue'
import DetailBlock from '@/target/components/dynamic-fields/DetailBlock.vue'
import { cloneDraft } from '@/target/components/dynamic-fields/clone-draft.ts'
import type { DetailDefinition } from '@/target/components/dynamic-fields/form-fields.ts'
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
vi.stubGlobal('visualViewport', {
  width: 1280,
  height: 800,
  offsetLeft: 0,
  offsetTop: 0,
  addEventListener() {},
  removeEventListener() {},
})
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn())
  document.body.innerHTML = ''
})
it('switches the same fields and actions between mobile cards and desktop columns', async () => {
  const wrapper = mount(DynamicCols, {
    props: {
      fields: [
        { key: 'name', type: 'text', caption: '名称' },
        { key: '$actions', type: 'actions', caption: '操作' },
      ],
      items: [{ id: 'one', name: '长文本'.repeat(30) }],
    },
    slots: { actions: '<button>查看</button>' },
    global: { plugins: [createVuetify()] },
  })
  cleanup.push(() => wrapper.unmount())
  for (const width of [375, 599, 600, 1280]) {
    window.innerWidth = width
    window.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(wrapper.findAll('.list-card')).toHaveLength(width < 600 ? 1 : 0)
    expect(wrapper.findAll('table')).toHaveLength(width < 600 ? 0 : 1)
    expect(
      wrapper.findAll('button').filter((button) => button.text() === '查看'),
    ).toHaveLength(1)
    expect(wrapper.text()).toContain('长文本'.repeat(30))
  }
  await wrapper.setProps({ items: [], loading: true })
  expect(wrapper.attributes('aria-busy')).toBe('true')
})
it('collapses later filters without dropping false, zero or ranges from explicit queries', async () => {
  const wrapper = mount(DynamicForm, {
    props: {
      fields: [
        { key: 'period', type: 'date', range: true, caption: '期间' },
        { key: 'keyword', type: 'text', caption: '关键词' },
        { key: 'enabled', type: 'boolean', caption: '启用' },
        { key: 'count', type: 'integer', caption: '数量' },
      ],
      modelValue: {
        period: { from: '2026-09-01', to: null },
        keyword: '',
        enabled: false,
        count: 0,
      },
    },
    global: { plugins: [createVuetify()] },
  })
  cleanup.push(() => wrapper.unmount())
  expect(wrapper.get('.extra-filters').attributes('style')).toContain(
    'display: none',
  )
  expect(wrapper.get('[data-testid="more-filters"]').text()).toContain('2')
  await wrapper.get('[data-testid="more-filters"]').trigger('click')
  expect(
    wrapper.get('[data-testid="more-filters"]').attributes('aria-expanded'),
  ).toBe('true')
  expect(wrapper.get('.extra-filters').attributes('style')).not.toContain(
    'display: none',
  )
  await wrapper.get('[data-testid="more-filters"]').trigger('click')
  expect(wrapper.emitted('search')).toBeUndefined()
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('search')).toEqual([
    [
      {
        period: { from: '2026-09-01', to: null },
        keyword: '',
        enabled: false,
        count: 0,
      },
    ],
  ])
  await wrapper.setProps({
    fields: [{ key: 'keyword', type: 'text', caption: '关键词' }],
  })
  expect(wrapper.find('[data-testid="more-filters"]').exists()).toBe(false)
})
it('presents a single range field, preserves open ends and clears both endpoints', async () => {
  const wrapper = mount(DateRangeInput, {
    props: { caption: '期间', modelValue: { from: null, to: '2026-09-13' } },
    global: { plugins: [createVuetify()] },
  })
  cleanup.push(() => wrapper.unmount())
  expect(wrapper.findAll('input')).toHaveLength(1)
  expect(wrapper.get('input').element.value).toBe('不限 至 2026-09-13')
  await wrapper.get('.v-field__clearable .v-icon').trigger('click')
  expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
    { from: null, to: null },
  ])
})
it('isolates nested dialogs, cancels descendant changes and confirms them only into the parent draft', async () => {
  type Row = { name: string; children: { amount: string }[] }
  const definition: DetailDefinition<Row> = {
    caption: '父项',
    fields: [
      { key: 'name', caption: '名称', type: 'text' },
      {
        key: 'children',
        caption: '子项',
        type: 'rows',
        fields: [{ key: 'amount', caption: '金额', type: 'decimal', scale: 2 }],
        empty: { amount: '0.00' },
      },
    ],
    empty: { name: '', children: [] },
  }
  const value = ref<Row[]>([{ name: '原始', children: [{ amount: '1.00' }] }])
  const host = defineComponent({
    components: { DetailBlock },
    setup: () => ({ definition, value }),
    template:
      '<DetailBlock :definition="definition" v-model="value" mode="edit" />',
  })
  const wrapper = mount(host, {
    attachTo: document.body,
    global: { plugins: [createVuetify()] },
  })
  cleanup.push(() => wrapper.unmount())
  const click = async (root: ParentNode, label: string) => {
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) =>
        button.getAttribute('aria-label') === label ||
        button.textContent?.trim() === label,
    )!
    expect(button).toBeDefined()
    button.click()
    await flushPromises()
  }
  const dialogs = () => [
    ...document.querySelectorAll<HTMLElement>('.v-dialog.v-overlay--active'),
  ]
  const changeChild = async () => {
    await click(wrapper.element, '编辑')
    await click(dialogs().at(-1)!.querySelector('[aria-label="子项"]')!, '编辑')
    const input = dialogs().at(-1)!.querySelector<HTMLInputElement>('input')!
    input.value = '9007199254740993.12'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await click(dialogs().at(-1)!, '确定')
  }
  await changeChild()
  expect(value.value[0]!.children[0]!.amount).toBe('1.00')
  await click(dialogs().at(-1)!, '取消')
  expect(value.value[0]!.children[0]!.amount).toBe('1.00')
  await changeChild()
  await click(dialogs().at(-1)!, '确定')
  expect(value.value[0]!.children[0]!.amount).toBe('9007199254740993.12')
  await click(wrapper.element, '查看')
  expect(dialogs().at(-1)!.querySelector('input')).toBeNull()
  expect(
    dialogs().at(-1)!.querySelector('[data-testid="row-action-edit"]'),
  ).toBeNull()
  await click(dialogs().at(-1)!.querySelector('[aria-label="子项"]')!, '查看')
  expect(dialogs().at(-1)!.textContent).toContain('9007199254740993.12')
})
it('clones nested proxies without sharing their arrays or losing decimal strings', () => {
  const nested = reactive({ children: [{ amount: '9007199254740993.001' }] })
  const copy = cloneDraft({ ...nested })
  copy.children[0]!.amount = '0'
  expect(nested.children[0]!.amount).toBe('9007199254740993.001')
})
