import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ListPageShell from '@/target/components/list-page/ListPageShell.vue'
import { defineListPage } from '@/target/components/list-page/definition.ts'
import { type EnabledListItem } from '@/target/components/list-page/vm.ts'

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
  VDialog: {
    props: ['modelValue'],
    template: '<section v-if="modelValue" role="dialog"><slot /></section>',
  },
  VCard: { template: '<section><slot /></section>' },
  VCardText: { template: '<div><slot /></div>' },
  VCardActions: { template: '<div><slot /></div>' },
  VSpacer: { template: '<span />' },
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

it('presents data and emits query and pagination intent without owning a runtime', async () => {
  const wrapper = mount(ListPageShell, {
    props: {
      title: definition.title,
      columns: definition.columns,
      filters: definition.filters,
      items: [row],
      filterInput: { keyword: '' },
      searchable: true,
      loading: false,
      pagination: { mode: 'total', page: 1, pageSize: 20, total: 21 },
      referenceOptions: {},
    },
    global: { stubs },
  })
  expect(wrapper.text()).toContain('buyer 采购员')
  await wrapper.get('input').setValue('采购')
  expect(wrapper.emitted('update:filterInput')).toEqual([[{ keyword: '采购' }]])
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('search')).toEqual([[]])
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '下一页')!
    .trigger('click')
  expect(wrapper.emitted('page')).toEqual([[2]])
  wrapper.unmount()
})
