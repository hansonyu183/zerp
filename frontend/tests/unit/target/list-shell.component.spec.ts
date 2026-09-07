import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ListPageShell from '@/target/components/list-page/ListPageShell.vue'
import { defineListPage } from '@/target/components/list-page/definition.ts'
import {
  useListPageViewModel,
  type EnabledListItem,
} from '@/target/components/list-page/vm.ts'

const definition = defineListPage<EnabledListItem>({
  title: '用户管理',
  createLabel: '新增用户',
  columns: [
    { key: 'code', type: 'text', caption: '编码' },
    { key: 'name', type: 'text', caption: '名称' },
    { key: 'enabled', type: 'boolean', caption: '状态' },
    { key: '$actions', type: 'actions', caption: '操作' },
  ],
  filters: [{ key: 'keyword', type: 'text', caption: '关键词' }],
})
const row = {
  id: 'user-1',
  code: 'buyer',
  py: 'caigouyuan',
  name: '采购员',
  enabled: true,
}
const stubs = {
  ManagementPageFrame: {
    props: ['title'],
    template:
      '<section>{{ title }}<slot name="actions"/><slot name="alerts"/><slot name="filters"/><slot/><slot name="footer"/></section>',
  },
  AppSnackbar: { props: ['message'], template: '<div>{{ message }}</div>' },
  VAlert: { template: '<div role="alert"><slot /></div>' },
  VBtn: {
    props: ['disabled'],
    emits: ['click'],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  VPagination: {
    emits: ['update:modelValue'],
    template:
      '<button @click="$emit(\'update:modelValue\', 2)">下一页</button>',
  },
  DynamicCols: {
    props: ['items'],
    template:
      '<div v-for="item in items" :key="item.id">{{ item.code }} {{ item.name }}<slot name="actions" :item="item" /></div>',
  },
  DynamicForm: {
    props: ['modelValue'],
    emits: ['update:modelValue', 'search'],
    template:
      '<form @submit.prevent="$emit(\'search\')"><input :value="modelValue.keyword" @input="$emit(\'update:modelValue\', { keyword: $event.target.value })"/></form>',
  },
}

describe('registered list Shell', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('binds the single VM to search, paging and shared row actions', async () => {
    const search = vi.fn(async () => ({
      items: [row],
      total: 21,
      page: 1,
      pageSize: 20,
    }))
    const edit = vi.fn(async () => {})
    const disable = vi.fn(async () => 'changed' as const)
    const vm = reactive(
      useListPageViewModel({
        onSearch: search,
        onEdit: edit,
        onDisable: disable,
      }),
    )
    await vm.initialize()
    const wrapper = mount(ListPageShell, {
      props: { definition, vm },
      global: { stubs },
    })
    expect(wrapper.text()).toContain('buyer 采购员')
    await wrapper.get('input').setValue('采购')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(search).toHaveBeenLastCalledWith({
      keyword: '采购',
      page: 1,
      pageSize: 20,
    })
    const button = (caption: string) =>
      wrapper.findAll('button').find((item) => item.text() === caption)!
    await button('编辑').trigger('click')
    await flushPromises()
    expect(edit).toHaveBeenCalledWith(row)
    expect(search).toHaveBeenCalledTimes(2)
    await button('停用').trigger('click')
    await flushPromises()
    expect(disable).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('操作成功。')
    await button('下一页').trigger('click')
    await flushPromises()
    expect(search).toHaveBeenLastCalledWith({
      keyword: '采购',
      page: 2,
      pageSize: 20,
    })
    wrapper.unmount()
    vm.dispose()
  })
  it('shows a contract error instead of rendering malformed identity or actions', () => {
    const vm = reactive(
      useListPageViewModel<EnabledListItem>({ onEdit: vi.fn() }),
    )
    vm.items = [{ ...row, py: undefined } as unknown as EnabledListItem]
    const wrapper = mount(ListPageShell, {
      props: { definition, vm },
      global: { stubs },
    })
    expect(wrapper.get('[role="alert"]').text()).toContain('必需字段无效')
    expect(wrapper.text()).not.toContain('buyer')
    expect(
      wrapper.findAll('button').some((button) => button.text() === '编辑'),
    ).toBe(false)
    wrapper.unmount()
  })
})
