<script setup lang="ts" generic="T extends VoucherListRow">
import { computed } from 'vue'
import type {
  VoucherLifecycleAction,
  VoucherLifecycleLabels,
  VoucherListRow,
  VoucherReference,
  VoucherSort,
  VoucherStatus,
} from './types'
import { formatVoucherStatus, voucherStatusOptions } from './status'
import type { ListRowAction } from '@/components/common/list-row-actions'
import VoucherReferenceAutocomplete from '@/components/common/ReferenceAutocomplete.vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import MobileSortControl from '@/components/common/MobileSortControl.vue'
import SortableTableHeader from '@/components/common/SortableTableHeader.vue'
import FulfillmentSummary from '@/components/common/FulfillmentSummary.vue'

defineOptions({ name: 'VoucherList' })

const props = withDefaults(
  defineProps<{
    rows: readonly T[]
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
    canView?: (row: T) => boolean
    canEdit?: (row: T) => boolean
    canLifecycleAction?: (row: T, action: VoucherLifecycleAction) => boolean
    lifecycleLabels: VoucherLifecycleLabels
    actionLoading?: string | null
    emptyText?: string
    partyEnabled?: boolean
    partyLabel?: string
    party: VoucherReference | null
    partyOptions?: readonly VoucherReference[]
    partyLoading?: boolean
    partyError?: string | null
    fulfillmentSummaryKind?: 'sales' | 'purchase'
    filterable?: boolean
    sortable?: boolean
    showEntity?: boolean
    searchLabel?: string
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
    filterable: true,
    sortable: true,
    showEntity: false,
    searchLabel: '单号或往来方关键字',
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
  view: [row: T]
  edit: [row: T]
  lifecycle: [row: T, action: VoucherLifecycleAction]
}>()

const hasNext = computed(() => props.page * props.pageSize < props.total)
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

function rowActions(row: T): ListRowAction[] {
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

function selectAction(action: string, row: T): void {
  if (action === 'edit') emit('edit', row)
  else if (action === 'view') emit('view', row)
  else if (isLifecycleAction(action)) emit('lifecycle', row, action)
}

function summaryLabels(): string[] {
  return props.fulfillmentSummaryKind === 'sales'
    ? ['订购', '出库', '净签收']
    : ['订购', '净入库']
}

function summaryValues(row: T): string[] {
  if (props.fulfillmentSummaryKind === 'sales' && row.salesSummary) {
    return [
      row.salesSummary.orderedQuantity,
      row.salesSummary.outboundQuantity,
      row.salesSummary.netSignedQuantity,
    ]
  }
  if (props.fulfillmentSummaryKind === 'purchase' && row.purchaseSummary) {
    return [
      row.purchaseSummary.orderedQuantity,
      row.purchaseSummary.netInboundQuantity,
    ]
  }
  return ['—', '—', '—', '—']
}

function summaryNote(row: T): string | undefined {
  const summary = row.salesSummary ?? row.purchaseSummary
  return summary?.excludedPackaging ? '不含包装物' : undefined
}
</script>

<template>
  <section class="voucher-list">
    <EntityListControls
      :creatable="creatable"
      :filterable="filterable"
      :keyword="keyword"
      :loading="loading"
      :queryable="queryable"
      :search-label="searchLabel"
      @apply-filters="emit('query')"
      @create="emit('create')"
      @query="emit('query')"
      @reset-filters="emit('reset')"
      @update:keyword="emit('update:keyword', $event)"
    >
      <template v-if="filterable" #filters>
        <slot name="filters">
          <v-select
            chips
            clearable
            hide-details
            item-title="title"
            item-value="value"
            :items="voucherStatusOptions"
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
        </slot>
      </template>
    </EntityListControls>

    <MobileSortControl
      v-if="sortable"
      :field="sort.field"
      :options="mobileSortOptions"
      :order="sort.order"
      @change="applyMobileSort"
    />

    <v-card rounded="lg" variant="flat">
      <v-progress-linear v-if="loading" indeterminate />
      <v-skeleton-loader
        v-if="loading && rows.length === 0"
        aria-label="正在加载数据"
        type="table-heading, table-row@5"
      />
      <div class="voucher-list__table-wrap responsive-table-wrap">
        <v-table class="voucher-list__table responsive-table">
          <thead>
            <tr>
              <th v-if="showEntity" class="voucher-list__column--compact">
                类型
              </th>
              <SortableTableHeader
                v-if="sortable"
                class="voucher-list__column--compact"
                label="单号"
                :active="sort.field === 'documentNo'"
                :direction="sort.order"
                @sort="changeSort('documentNo')"
              />
              <th v-else class="voucher-list__column--compact">单号</th>
              <SortableTableHeader
                v-if="sortable"
                class="voucher-list__column--compact"
                label="日期"
                :active="sort.field === 'businessDate'"
                :direction="sort.order"
                @sort="changeSort('businessDate')"
              />
              <th v-else class="voucher-list__column--compact">日期</th>
              <th class="voucher-list__column--fluid">往来方</th>
              <SortableTableHeader
                v-if="sortable"
                class="voucher-list__column--compact"
                label="状态"
                :active="sort.field === 'status'"
                :direction="sort.order"
                @sort="changeSort('status')"
              />
              <th v-else class="voucher-list__column--compact">状态</th>
              <SortableTableHeader
                v-if="sortable"
                class="voucher-list__column--compact"
                align="end"
                label="金额"
                :active="sort.field === 'amount'"
                :direction="sort.order"
                @sort="changeSort('amount')"
              />
              <th v-else class="text-end voucher-list__column--compact">
                金额
              </th>
              <th
                v-if="fulfillmentSummaryKind"
                class="voucher-list__column--fluid"
              >
                履约摘要
              </th>
              <th class="text-end voucher-list__column--compact">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.documentId">
              <td
                v-if="showEntity"
                class="voucher-list__column--compact"
                data-label="类型"
              >
                <slot name="cell-entity" :row="row">{{ row.entity }}</slot>
              </td>
              <td class="voucher-list__column--compact" data-label="单号">
                {{ row.documentNo }}
              </td>
              <td class="voucher-list__column--compact" data-label="日期">
                {{ row.businessDate }}
              </td>
              <td class="voucher-list__column--fluid" data-label="往来方">
                {{ row.partyName || '—' }}
              </td>
              <td class="voucher-list__column--compact" data-label="状态">
                <slot name="cell-status" :row="row">
                  <v-chip size="small" variant="tonal">{{
                    formatVoucherStatus(row.status)
                  }}</v-chip>
                </slot>
              </td>
              <td
                class="text-end voucher-list__column--compact"
                data-label="金额"
              >
                <slot name="cell-amount" :row="row">{{ row.amount }}</slot>
              </td>
              <td
                v-if="fulfillmentSummaryKind"
                class="voucher-list__column--fluid"
                data-label="履约摘要"
              >
                <FulfillmentSummary
                  :labels="summaryLabels()"
                  :note="summaryNote(row)"
                  unit="KG"
                  :values="summaryValues(row)"
                />
              </td>
              <td
                class="text-end text-no-wrap responsive-table__actions"
                data-label="操作"
              >
                <slot name="actions" :row="row">
                  <ListRowActions
                    :label="`操作 ${row.documentNo}`"
                    :loading="Boolean(actionLoading)"
                    :primary="rowActions(row)"
                    @select="selectAction($event, row)"
                  />
                </slot>
              </td>
            </tr>
            <tr
              v-if="!loading && rows.length === 0"
              class="responsive-table__empty-row"
            >
              <td
                :colspan="
                  6 + (showEntity ? 1 : 0) + (fulfillmentSummaryKind ? 1 : 0)
                "
                class="text-center py-12"
              >
                {{ emptyText }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
      <v-card-actions class="justify-end">
        <span class="text-caption mr-2">
          {{ loading ? '正在加载数据…' : `共 ${total} 条，第 ${page} 页` }}
        </span>
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

.voucher-list__column--compact {
  width: 1%;
  white-space: nowrap;
}

.voucher-list__column--fluid {
  min-width: 180px;
  width: 100%;
}
</style>
