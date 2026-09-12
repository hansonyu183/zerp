<script
  setup
  lang="ts"
  generic="Row extends { id: string }, Filters extends { keyword: string }"
>
import ManagementPageFrame from '../ManagementPageFrame.vue'
import DynamicForm from '../dynamic-fields/DynamicForm.vue'
import DynamicCols from '../dynamic-fields/DynamicCols.vue'
import ListPagination, {
  type ListPagination as Pagination,
} from './ListPagination.vue'
import type { ColumnField, FilterField } from '../dynamic-fields/types.ts'
defineProps<{
  title: string
  columns: readonly ColumnField[]
  filters: readonly FilterField[]
  items: readonly Row[]
  filterInput: Filters
  searchable: boolean
  loading: boolean
  pagination: Pagination
}>()
const emit = defineEmits<{
  'update:filterInput': [value: Filters]
  search: []
  page: [value: number]
}>()
defineSlots<{
  actions(): unknown
  alerts(): unknown
  rowActions(props: { item: Row }): unknown
}>()
</script>
<template>
  <ManagementPageFrame :title="title" data-testid="list-page-shell">
    <template #actions><slot name="actions" /></template>
    <template #alerts
      ><slot name="alerts" /><v-alert
        v-if="!searchable"
        type="info"
        class="mb-4"
        >当前账号没有查询权限，仅显示已授权操作。</v-alert
      ></template
    >
    <template #filters>
      <DynamicForm
        :fields="filters"
        :model-value="filterInput"
        :disabled="!searchable"
        @update:model-value="emit('update:filterInput', $event)"
        @search="emit('search')"
      />
    </template>
    <DynamicCols :fields="columns" :items="items" :loading="loading"
      ><template #actions="{ item }"
        ><slot name="rowActions" :item="item" /></template
    ></DynamicCols>
    <template #footer
      ><ListPagination
        :pagination="pagination"
        :disabled="loading || !searchable"
        @page="emit('page', $event)"
    /></template>
  </ManagementPageFrame>
</template>
