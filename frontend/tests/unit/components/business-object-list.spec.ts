import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, type Component } from 'vue'
import { describe, expect, it } from 'vitest'
import BusinessObjectList from '@/components/business-object/BusinessObjectList.vue'
import type { BusinessObjectColumn } from '@/components/business-object'
import type { BusinessObjectSort } from '@/components/business-object'

interface ExampleRow {
  id: string
  name: string
  status: string
}

const rows: ExampleRow[] = [
  { id: 'C-1', name: '华东客户', status: 'DRAFT' },
  { id: 'C-2', name: '华南客户', status: 'EFFECTIVE' },
]

const columns: readonly BusinessObjectColumn<ExampleRow>[] = [
  { key: 'name', label: '客户名称', value: (row) => row.name },
  {
    key: 'status',
    label: '状态',
    value: (row) => row.status,
    format: (value) => (value === 'DRAFT' ? '草稿' : '有效'),
  },
]

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

const ListRowActionsStub = defineComponent({
  name: 'ListRowActions',
  props: {
    primary: { type: Array, default: () => [] },
    more: { type: Array, default: () => [] },
  },
  emits: ['select'],
  setup(props, { emit }) {
    return () =>
      h(
        'div',
        [...props.primary, ...props.more].map((action) => {
          const item = action as { key: string; label: string }
          return h(
            'button',
            {
              'aria-label': item.label,
              onClick: () => emit('select', item.key),
            },
            item.label,
          )
        }),
      )
  },
})

function mountList(
  props: Partial<{
    rows: readonly ExampleRow[]
    columns: readonly BusinessObjectColumn<ExampleRow>[]
    keyword: string
    page: number
    pageSize: number
    total: number
    loading: boolean
    creatable: boolean
    editable: boolean | ((row: Readonly<ExampleRow>) => boolean)
    deletable: boolean | ((row: Readonly<ExampleRow>) => boolean)
    sort: BusinessObjectSort
  }> = {},
  slots: Record<string, unknown> = {},
): VueWrapper {
  return mount(BusinessObjectList as Component, {
    props: {
      rows,
      columns,
      rowKey: (row: ExampleRow) => row.id,
      keyword: '',
      page: 1,
      pageSize: 20,
      total: 2,
      ...props,
    },
    slots,
    global: {
      components: {
        VBtn: VBtnStub,
        VTable: VTableStub,
        VTextField: VTextFieldStub,
      },
      stubs: {
        ListRowActions: ListRowActionsStub,
      },
    },
  })
}

describe('BusinessObjectList', () => {
  it('按列配置渲染值并支持自定义单元格', () => {
    const wrapper = mountList(
      {},
      {
        'cell-name': ({ value }: { value: unknown }) =>
          h('strong', { class: 'custom-name' }, `#${String(value)}`),
      },
    )

    expect(wrapper.text()).toContain('客户名称')
    expect(wrapper.text()).toContain('草稿')
    expect(wrapper.text()).toContain('有效')
    expect(wrapper.findAll('.custom-name').map((item) => item.text())).toEqual([
      '#华东客户',
      '#华南客户',
    ])
    expect(wrapper.get('table').classes()).toContain('responsive-table')
    expect(
      wrapper.find('td[data-label="客户名称"]').exists(),
    ).toBe(true)
  })

  it('发出查询、关键字、新增和条件行操作事件', async () => {
    const wrapper = mountList({
      creatable: true,
      editable: (row) => row.status !== 'EFFECTIVE',
      deletable: (row) => row.status === 'DRAFT',
    })

    await wrapper.get('input[aria-label="关键字"]').setValue('华东')
    await wrapper.get('input[aria-label="关键字"]').trigger('keyup.enter')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '新增')
      ?.trigger('click')
    await wrapper.get('button[aria-label="编辑 C-1"]').trigger('click')
    await wrapper.get('button[aria-label="删除 C-1"]').trigger('click')

    expect(wrapper.emitted('update:keyword')).toEqual([['华东']])
    expect(wrapper.emitted('query')).toHaveLength(1)
    expect(wrapper.emitted('create')).toHaveLength(1)
    expect(wrapper.emitted('edit')?.[0]).toEqual([rows[0]])
    expect(wrapper.emitted('delete')?.[0]).toEqual([rows[0]])
    expect(wrapper.find('button[aria-label="编辑 C-2"]').exists()).toBe(false)
  })

  it('分页使用总数判断下一页并在加载时锁定', async () => {
    const wrapper = mountList({ page: 2, pageSize: 2, total: 5 })

    await wrapper.get('button[aria-label="上一页"]').trigger('click')
    await wrapper.get('button[aria-label="下一页"]').trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[1], [3]])

    await wrapper.setProps({ loading: true })
    expect(
      wrapper.get('button[aria-label="上一页"]').attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper.get('button[aria-label="下一页"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('在表头发出单列排序且首次为升序', async () => {
    const wrapper = mountList({
      sort: { field: 'updatedAt', order: 'desc' },
    })
    const nameHeader = wrapper
      .findAll('th')
      .find((heading) => heading.text() === '客户名称')

    await nameHeader?.trigger('click')
    expect(wrapper.emitted('update:sort')).toEqual([
      [{ field: 'name', order: 'asc' }],
    ])
    expect(
      wrapper
        .getComponent({ name: 'MobileSortControl' })
        .props('options')
        .map((option: { value: string }) => option.value),
    ).toEqual(['name', 'status'])
  })

  it('为空列表显示空状态并保持正确列数', () => {
    const wrapper = mountList({
      rows: [],
      editable: true,
      deletable: true,
      total: 0,
    })

    expect(wrapper.text()).toContain('暂无数据')
    expect(
      wrapper.get('.business-object-list__empty').attributes('colspan'),
    ).toBe('2')
  })
})
