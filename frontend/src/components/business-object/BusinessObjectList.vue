<script setup lang="ts" generic="T extends object">
import { computed } from 'vue'
import type {
  BusinessObjectColumn,
  BusinessObjectRowState,
  BusinessObjectSort,
} from './types'
import EntityListControls from '@/components/common/EntityListControls.vue'
import SortableTableHeader from '@/components/common/SortableTableHeader.vue'

defineOptions({ name: 'BusinessObjectList' })

interface Props<TValue extends object> {
  rows: readonly TValue[]
  columns: readonly BusinessObjectColumn<TValue>[]
  rowKey: (row: Readonly<TValue>) => string | number
  keyword: string
  page: number
  pageSize: number
  total: number
  loading?: boolean
  searchLabel?: string
  emptyText?: string
  creatable?: boolean
  editable?: BusinessObjectRowState<TValue>
  deletable?: BusinessObjectRowState<TValue>
  sort?: BusinessObjectSort
}

const props = withDefaults(defineProps<Props<T>>(), {
  loading: false,
  searchLabel: '关键字',
  emptyText: '暂无数据',
  creatable: false,
  editable: false,
  deletable: false,
})

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:page': [value: number]
  'update:sort': [value: BusinessObjectSort]
  query: []
  create: []
  resetFilters: []
  applyFilters: []
  edit: [row: T]
  delete: [row: T]
}>()

const hasNextPage = computed(() => props.page * props.pageSize < props.total)
const hasActionColumn = computed(() =>
  props.rows.some(
    (row) =>
      resolveRowState(props.editable, row) ||
      resolveRowState(props.deletable, row),
  ),
)
const columnCount = computed(
  () => props.columns.length + (hasActionColumn.value ? 1 : 0),
)

function resolveRowState(
  state: BusinessObjectRowState<T>,
  row: Readonly<T>,
): boolean {
  return typeof state === 'function' ? state(row) : state
}

function formatValue(
  column: BusinessObjectColumn<T>,
  row: Readonly<T>,
): string {
  const value = column.value(row)
  if (value === null || value === undefined || value === '') return '—'
  return column.format ? column.format(value, row) : String(value)
}

function changePage(page: number): void {
  if (props.loading || page < 1 || page === props.page) return
  emit('update:page', page)
}

function isSortable(key: string): key is BusinessObjectSort['field'] {
  return ['code', 'name', 'status', 'version', 'updatedAt'].includes(key)
}

function changeSort(field: BusinessObjectSort['field']): void {
  emit('update:sort', {
    field,
    order:
      props.sort?.field === field && props.sort.order === 'asc'
        ? 'desc'
        : 'asc',
  })
}
</script>

<template>
  <section class="business-object-list">
    <EntityListControls
      :creatable="creatable"
      :filterable="Boolean($slots.filters)"
      :keyword="keyword"
      :loading="loading"
      :search-label="searchLabel"
      @apply-filters="emit('applyFilters')"
      @create="emit('create')"
      @query="emit('query')"
      @reset-filters="emit('resetFilters')"
      @update:keyword="emit('update:keyword', $event)"
    >
      <template v-if="$slots.filters" #filters>
        <slot name="filters" />
      </template>
      <template v-if="$slots['filter-actions']" #filter-actions>
        <slot name="filter-actions" />
      </template>
      <template v-if="$slots.toolbar" #toolbar>
        <slot name="toolbar" />
      </template>
    </EntityListControls>

    <v-table class="business-object-list__table">
      <thead>
        <tr>
          <template v-for="column in columns" :key="column.key">
            <SortableTableHeader
              v-if="sort && isSortable(column.key)"
              :active="sort.field === column.key"
              :align="column.align"
              :direction="sort.order"
              :label="column.label"
              :width="column.width"
              @sort="changeSort(column.key)"
            />
            <th
              v-else
              :class="`text-${column.align ?? 'start'}`"
              :style="{ width: column.width }"
            >
              {{ column.label }}
            </th>
          </template>
          <th
            v-if="hasActionColumn"
            class="business-object-list__actions-heading text-end"
          >
            操作
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="rowKey(row)">
          <td
            v-for="column in columns"
            :key="column.key"
            :class="`text-${column.align ?? 'start'}`"
          >
            <slot
              :name="`cell-${column.key}`"
              :column="column"
              :index="index"
              :row="row"
              :value="column.value(row)"
            >
              {{ formatValue(column, row) }}
            </slot>
          </td>
          <td v-if="hasActionColumn" class="business-object-list__actions">
            <slot
              name="actions"
              :deletable="resolveRowState(deletable, row)"
              :editable="resolveRowState(editable, row)"
              :row="row"
            >
              <v-btn
                v-if="resolveRowState(editable, row)"
                :aria-label="`编辑 ${rowKey(row)}`"
                color="primary"
                density="comfortable"
                :disabled="loading"
                icon="mdi-pencil-outline"
                variant="text"
                @click="emit('edit', row)"
              />
              <v-btn
                v-if="resolveRowState(deletable, row)"
                :aria-label="`删除 ${rowKey(row)}`"
                color="error"
                density="comfortable"
                :disabled="loading"
                icon="mdi-delete-outline"
                variant="text"
                @click="emit('delete', row)"
              />
            </slot>
          </td>
        </tr>
        <tr v-if="!loading && rows.length === 0">
          <td class="business-object-list__empty" :colspan="columnCount">
            {{ emptyText }}
          </td>
        </tr>
      </tbody>
    </v-table>

    <div class="business-object-list__footer">
      <span>共 {{ total }} 条</span>
      <v-btn
        aria-label="上一页"
        icon="mdi-chevron-left"
        :disabled="page <= 1 || loading"
        variant="text"
        @click="changePage(page - 1)"
      />
      <span>第 {{ page }} 页</span>
      <v-btn
        aria-label="下一页"
        icon="mdi-chevron-right"
        :disabled="!hasNextPage || loading"
        variant="text"
        @click="changePage(page + 1)"
      />
    </div>
  </section>
</template>

<style scoped>
.business-object-list__table {
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}

.business-object-list__table th {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  font-weight: 700;
}

.business-object-list__actions-heading {
  width: 112px;
}

.business-object-list__actions {
  text-align: right;
  white-space: nowrap;
}

.business-object-list__empty {
  height: 112px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}

.business-object-list__footer {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
  padding: 16px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
</style>
