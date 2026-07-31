<script setup lang="ts">
import { computed } from 'vue'
import type {
  VoucherLifecycleAction,
  VoucherLifecycleLabels,
  VoucherListItem,
  VoucherReference,
  VoucherSort,
  VoucherStatus,
} from './types'
import type { ListRowAction } from '@/components/common/list-row-actions'
import VoucherReferenceAutocomplete from './VoucherReferenceAutocomplete.vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import MobileSortControl from '@/components/common/MobileSortControl.vue'
import SortableTableHeader from '@/components/common/SortableTableHeader.vue'

defineOptions({ name: 'VoucherList' })

const props = withDefaults(
  defineProps<{
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
    canLifecycleAction?: (
      row: VoucherListItem,
      action: VoucherLifecycleAction,
    ) => boolean
    lifecycleLabels: VoucherLifecycleLabels
    actionLoading?: string | null
    emptyText?: string
    partyEnabled?: boolean
    partyLabel?: string
    party: VoucherReference | null
    partyOptions?: readonly VoucherReference[]
    partyLoading?: boolean
    partyError?: string | null
  }>(),
  {
    loading: false,
    queryable: true,
    creatable: false,
    canView: () => true,
    canEdit: () => false,
    canLifecycleAction: () => false,
    actionLoading: null,
    emptyText: '暂无单据',
    partyEnabled: false,
    partyLabel: '往来方',
    partyOptions: () => [],
    partyLoading: false,
    partyError: null,
  },
)

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
  lifecycle: [row: VoucherListItem, action: VoucherLifecycleAction]
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
    order:
      props.sort.field === field && props.sort.order === 'asc' ? 'desc' : 'asc',
  })
}

function changeStatuses(value: unknown): void {
  emit(
    'update:statuses',
    Array.isArray(value) ? (value as VoucherStatus[]) : [],
  )
}

const mobileSortOptions = [
  { title: '单号', value: 'documentNo' },
  { title: '日期', value: 'businessDate' },
  { title: '状态', value: 'status' },
  { title: '金额', value: 'amount' },
]

function applyMobileSort(value: {
  field: string
  order: 'asc' | 'desc'
}): void {
  emit('update:sort', value as VoucherSort)
}

const lifecycleActionDefinitions: ReadonlyArray<{
  action: VoucherLifecycleAction
  statuses: readonly VoucherStatus[]
  icon: string
  color?: string
}> = [
  {
    action: 'check',
    statuses: ['DRAFT'],
    icon: 'mdi-account-check-outline',
    color: 'primary',
  },
  {
    action: 'uncheck',
    statuses: ['CHECKED'],
    icon: 'mdi-undo-variant',
  },
  {
    action: 'approve',
    statuses: ['CHECKED'],
    icon: 'mdi-check-decagram-outline',
    color: 'success',
  },
  {
    action: 'unapprove',
    statuses: ['APPROVED'],
    icon: 'mdi-undo-variant',
  },
  {
    action: 'finalize',
    statuses: ['APPROVED'],
    icon: 'mdi-play-circle-outline',
    color: 'primary',
  },
  {
    action: 'unfinalize',
    statuses: ['FINALIZED'],
    icon: 'mdi-backup-restore',
    color: 'warning',
  },
]

function lifecycleActionLabel(action: VoucherLifecycleAction): string {
  return props.lifecycleLabels[action]
}

function rowActions(row: VoucherListItem): ListRowAction[] {
  const detailAction: ListRowAction[] = props.canEdit(row)
    ? [
        {
          key: 'edit',
          label: `编辑 ${row.documentNo}`,
          icon: 'mdi-pencil-outline',
          color: 'primary',
        },
      ]
    : props.canView(row)
      ? [
          {
            key: 'view',
            label: `查看 ${row.documentNo}`,
            icon: 'mdi-eye-outline',
          },
        ]
      : []
  const lifecycleActions = lifecycleActionDefinitions
    .filter(
      ({ action, statuses }) =>
        statuses.includes(row.status) && props.canLifecycleAction(row, action),
    )
    .map(({ action, icon, color }) => ({
      key: action,
      label: `${lifecycleActionLabel(action)} ${row.documentNo}`,
      icon,
      color,
    }))
  return [...detailAction, ...lifecycleActions]
}

function isLifecycleAction(action: string): action is VoucherLifecycleAction {
  return lifecycleActionDefinitions.some(
    (definition) => definition.action === action,
  )
}

function selectAction(action: string, row: VoucherListItem): void {
  if (action === 'edit') emit('edit', row)
  else if (action === 'view') emit('view', row)
  else if (isLifecycleAction(action)) emit('lifecycle', row, action)
}
</script>

<template>
  <section class="voucher-list">
    <EntityListControls
      :creatable="creatable"
      filterable
      :keyword="keyword"
      :loading="loading"
      :queryable="queryable"
      search-label="单号或往来方关键字"
      @apply-filters="emit('query')"
      @create="emit('create')"
      @query="emit('query')"
      @reset-filters="emit('reset')"
      @update:keyword="emit('update:keyword', $event)"
    >
      <template #filters>
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
      </template>
    </EntityListControls>

    <MobileSortControl
      :field="sort.field"
      :options="mobileSortOptions"
      :order="sort.order"
      @change="applyMobileSort"
    />

    <v-card rounded="lg" variant="flat">
      <v-progress-linear v-if="loading" indeterminate />
      <div class="voucher-list__table-wrap responsive-table-wrap">
        <v-table class="voucher-list__table responsive-table">
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
              <SortableTableHeader
                align="end"
                label="金额"
                :active="sort.field === 'amount'"
                :direction="sort.order"
                @sort="changeSort('amount')"
              />
              <th class="text-end">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.documentId">
              <td data-label="单号">{{ row.documentNo }}</td>
              <td data-label="日期">{{ row.businessDate }}</td>
              <td data-label="往来方">{{ row.partyName || '—' }}</td>
              <td data-label="状态">
                <v-chip size="small" variant="tonal">{{
                  statusText(row.status)
                }}</v-chip>
              </td>
              <td class="text-end" data-label="金额">{{ row.amount }}</td>
              <td
                class="text-end text-no-wrap responsive-table__actions"
                data-label="操作"
              >
                <ListRowActions
                  :label="`操作 ${row.documentNo}`"
                  :loading="Boolean(actionLoading)"
                  :primary="rowActions(row)"
                  @select="selectAction($event, row)"
                />
              </td>
            </tr>
            <tr
              v-if="!loading && rows.length === 0"
              class="responsive-table__empty-row"
            >
              <td colspan="6" class="text-center py-12">{{ emptyText }}</td>
            </tr>
          </tbody>
        </v-table>
      </div>
      <v-card-actions class="justify-end">
        <span class="text-caption mr-2"
          >共 {{ total }} 条，第 {{ page }} 页</span
        >
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
.voucher-list__table-wrap {
  overflow-x: auto;
}
.voucher-list__table {
  min-width: 980px;
}
</style>
