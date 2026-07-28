<script setup lang="ts">
import { computed } from 'vue'
import { formatLocalDateTime } from '@/utils/date'
import type {
  VoucherListItem,
  VoucherReference,
  VoucherSort,
  VoucherStatus,
} from './types'
import VoucherReferenceAutocomplete from './VoucherReferenceAutocomplete.vue'
import SortableTableHeader from '@/components/common/SortableTableHeader.vue'

defineOptions({ name: 'VoucherList' })

const props = withDefaults(defineProps<{
  rows: readonly VoucherListItem[]
  total: number
  page: number
  pageSize: number
  keyword: string
  statuses: readonly VoucherStatus[]
  dateFrom: string
  dateTo: string
  sort: VoucherSort
  loading?: boolean
  queryable?: boolean
  creatable?: boolean
  canView?: (row: VoucherListItem) => boolean
  canEdit?: (row: VoucherListItem) => boolean
  emptyText?: string
  partyEnabled?: boolean
  partyLabel?: string
  party: VoucherReference | null
  partyOptions?: readonly VoucherReference[]
  partyLoading?: boolean
  partyError?: string | null
}>(), {
  loading: false,
  queryable: true,
  creatable: false,
  canView: () => true,
  canEdit: () => false,
  emptyText: '暂无单据',
  partyEnabled: false,
  partyLabel: '往来方',
  partyOptions: () => [],
  partyLoading: false,
  partyError: null,
})

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:statuses': [value: VoucherStatus[]]
  'update:dateFrom': [value: string]
  'update:dateTo': [value: string]
  'update:party': [value: VoucherReference | null]
  'update:sort': [value: VoucherSort]
  'update:page': [value: number]
  'party-search': [keyword: string]
  query: []
  reset: []
  create: []
  view: [row: VoucherListItem]
  edit: [row: VoucherListItem]
}>()

const hasNext = computed(() => props.page * props.pageSize < props.total)
const statusOptions = [
  { title: '草稿', value: 'DRAFT' },
  { title: '已核对', value: 'CHECKED' },
  { title: '已批准', value: 'APPROVED' },
  { title: '已完成', value: 'FINALIZED' },
  { title: '已下单', value: 'ORDERED' },
  { title: '已确认', value: 'CONFIRMED' },
  { title: '已执行', value: 'EXECUTED' },
]
function statusText(status: VoucherStatus): string {
  return {
    DRAFT: '草稿',
    CHECKED: '已核对',
    APPROVED: '已批准',
    FINALIZED: '已完成',
    ORDERED: '已下单',
    CONFIRMED: '已确认',
    EXECUTED: '已执行',
  }[status]
}

function changeSort(field: VoucherSort['field']): void {
  emit('update:sort', {
    field,
    order: props.sort.field === field && props.sort.order === 'asc'
      ? 'desc'
      : 'asc',
  })
}

function changeStatuses(value: unknown): void {
  emit(
    'update:statuses',
    Array.isArray(value) ? value as VoucherStatus[] : [],
  )
}
</script>

<template>
  <section class="voucher-list">
    <v-expansion-panels class="mb-4" variant="accordion">
      <v-expansion-panel>
        <v-expansion-panel-title>筛选条件</v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="voucher-list__filter-grid">
            <v-text-field
              clearable
              hide-details
              label="单号或往来方关键字"
              :model-value="keyword"
              prepend-inner-icon="mdi-magnify"
              variant="outlined"
              @keyup.enter="emit('query')"
              @update:model-value="emit('update:keyword', $event ?? '')"
            />
            <v-select
              chips
              clearable
              hide-details
              item-title="title"
              item-value="value"
              :items="statusOptions"
              label="状态"
              :model-value="statuses"
              multiple
              variant="outlined"
              @update:model-value="changeStatuses"
            />
            <v-text-field
              hide-details
              label="业务日期起"
              :model-value="dateFrom"
              type="date"
              variant="outlined"
              @update:model-value="emit('update:dateFrom', $event ?? '')"
            />
            <v-text-field
              hide-details
              label="业务日期止"
              :model-value="dateTo"
              type="date"
              variant="outlined"
              @update:model-value="emit('update:dateTo', $event ?? '')"
            />
            <VoucherReferenceAutocomplete
              v-if="partyEnabled"
              :error-message="partyError"
              :label="partyLabel"
              :loading="partyLoading"
              :model-value="party"
              :options="partyOptions"
              @search="emit('party-search', $event)"
              @update:model-value="emit('update:party', $event)"
            />
          </div>
          <div class="voucher-list__filter-actions">
            <v-btn :disabled="!queryable" variant="text" @click="emit('reset')">重置</v-btn>
            <v-btn
              color="primary"
              :disabled="!queryable"
              :loading="loading"
              prepend-icon="mdi-magnify"
              @click="emit('query')"
            >
              查询
            </v-btn>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-card rounded="lg" variant="flat">
      <v-progress-linear v-if="loading" indeterminate />
      <v-card-title class="voucher-list__toolbar">
        <span>单据列表</span>
        <v-spacer />
        <v-btn
          v-if="creatable"
          color="primary"
          :disabled="loading"
          prepend-icon="mdi-plus"
          variant="tonal"
          @click="emit('create')"
        >
          新建单据
        </v-btn>
      </v-card-title>
      <div class="voucher-list__table-wrap">
        <v-table class="voucher-list__table">
          <thead>
            <tr>
              <SortableTableHeader
                label="单号"
                :active="sort.field === 'documentNo'"
                :direction="sort.order"
                @sort="changeSort('documentNo')"
              />
              <SortableTableHeader
                label="日期"
                :active="sort.field === 'businessDate'"
                :direction="sort.order"
                @sort="changeSort('businessDate')"
              />
              <th>往来方</th>
              <SortableTableHeader
                label="状态"
                :active="sort.field === 'status'"
                :direction="sort.order"
                @sort="changeSort('status')"
              />
              <th>币种</th>
              <SortableTableHeader
                align="end"
                label="金额"
                :active="sort.field === 'amount'"
                :direction="sort.order"
                @sort="changeSort('amount')"
              />
              <SortableTableHeader
                label="更新"
                :active="sort.field === 'updatedAt'"
                :direction="sort.order"
                @sort="changeSort('updatedAt')"
              />
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.documentId">
              <td>{{ row.documentNo }}</td>
              <td>{{ row.businessDate }}</td>
              <td>{{ row.partyName || '—' }}</td>
              <td>
                <v-chip size="small" variant="tonal">{{ statusText(row.status) }}</v-chip>
              </td>
              <td>{{ row.currency }}</td>
              <td class="text-end">{{ row.amount }}</td>
              <td>{{ formatLocalDateTime(row.updatedAt) }}</td>
              <td class="text-end text-no-wrap">
                <v-btn
                  v-if="canView(row)"
                  :aria-label="`查看 ${row.documentNo}`"
                  icon="mdi-eye-outline"
                  variant="text"
                  @click="emit('view', row)"
                />
                <v-btn
                  v-if="canEdit(row)"
                  :aria-label="`编辑 ${row.documentNo}`"
                  color="primary"
                  icon="mdi-pencil-outline"
                  variant="text"
                  @click="emit('edit', row)"
                />
              </td>
            </tr>
            <tr v-if="!loading && rows.length === 0">
              <td colspan="8" class="text-center py-12">{{ emptyText }}</td>
            </tr>
          </tbody>
        </v-table>
      </div>
      <v-card-actions class="justify-end">
        <span class="text-caption mr-2">共 {{ total }} 条，第 {{ page }} 页</span>
        <v-btn
          aria-label="上一页"
          :disabled="page <= 1 || loading"
          icon="mdi-chevron-left"
          variant="text"
          @click="emit('update:page', page - 1)"
        />
        <v-btn
          aria-label="下一页"
          :disabled="!hasNext || loading"
          icon="mdi-chevron-right"
          variant="text"
          @click="emit('update:page', page + 1)"
        />
      </v-card-actions>
    </v-card>
  </section>
</template>

<style scoped>
.voucher-list__filter-grid {
  display: grid;
  grid-template-columns: minmax(260px, 2fr) repeat(3, minmax(160px, 1fr));
  gap: 12px;
  align-items: center;
}
.voucher-list__filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.voucher-list__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.voucher-list__table-wrap { overflow-x: auto; }
.voucher-list__table { min-width: 980px; }
@media (max-width: 960px) {
  .voucher-list__filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .voucher-list__filter-grid { grid-template-columns: 1fr; }
  .voucher-list__filter-actions { flex-wrap: wrap; }
}
</style>
