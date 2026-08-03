<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import {
  resolveDueDate,
  formatVoucherStatus,
  parseFixed,
  toVouAtomicDocument,
  VoucherAttachmentPanel,
  VoucherAuditHistory,
  VoucherDocumentHeader,
  VoucherExecutionDialog,
  VoucherExpenseLinesEditor,
  VoucherList,
  VoucherProductLinesEditor,
  VoucherPriceLinesEditor,
  VoucherProductionLinesEditor,
  VoucherReferenceAutocomplete,
  VoucherWorkspace,
  type VoucherDraftForm,
  type VoucherLifecycleAction,
  type VoucherListItem,
  type VoucherReference,
  type VoucherSalesChainLineDraft,
} from '@/components/voucher'
import { lifecycleLabels } from './config'
import type { VoucherEntityViewModel } from './vm'
import CompactTableField from '@/components/common/CompactTableField.vue'
import { formatReferenceLabel } from '@/utils/reference-label'
import VoucherWorkspaceActions from './VoucherWorkspaceActions.vue'
import VoucherReasonDialog from './VoucherReasonDialog.vue'

const props = withDefaults(
  defineProps<{
    model: VoucherEntityViewModel
    autoQuery?: boolean
    showList?: boolean
  }>(),
  {
    autoQuery: true,
    showList: true,
  },
)
const vm = reactive(props.model)
const route = useRoute()
const router = useRouter()
const labels = computed(() => lifecycleLabels(vm.config))

const workspaceTitle = computed(
  () => `${vm.documentView ? '查看' : '新增'}${vm.config.title}`,
)
const atomicDocument = computed(() =>
  vm.documentView ? toVouAtomicDocument(vm.documentView) : null,
)
const atomicStatusLabel = computed(() => {
  const status = atomicDocument.value?.status
  return status
    ? formatVoucherStatus(status, {
        CHECKED: labels.value.checked,
        FINALIZED: labels.value.finalized,
      })
    : ''
})
const partyEnabled = computed(() => vm.config.partyMode !== 'none')
const partyLabel = computed(() => {
  if (vm.config.partyMode === 'customer') return '客户'
  if (vm.config.partyMode === 'supplier') return '供应商'
  return '往来方'
})
const businessDateLabel = computed(
  () =>
    (
      ({
        'sale-order': '订单日期',
        'sale-outbound': '出库日期',
        'sale-delivery': '配送日期',
        'sale-signoff': '签收日期',
      }) as Record<string, string>
    )[vm.config.entity] ?? '业务日期',
)
const basicInfoPanel = ref<string | undefined>('basic')
const parentDocumentNo = computed(
  () =>
    vm.documentView?.parentDocumentNo ||
    vm.form.parentDocumentNo ||
    '由系统生成',
)
const secondaryOpen = ref(false)
const secondaryAction = ref<
  | 'delete'
  | 'short-close-request'
  | 'short-close-cancel'
  | 'short-close-unconfirm'
>('delete')
const secondaryTitle = ref('')
const secondaryReason = ref('')
const listLifecycleTarget = ref<VoucherListItem | null>(null)
const listLifecycleAction =
  ref<Extract<VoucherLifecycleAction, 'uncheck' | 'unapprove' | 'unfinalize'>>(
    'uncheck',
  )
const listLifecycleReason = ref('')
const listLifecycleTitle = computed(
  () => labels.value[listLifecycleAction.value],
)

if (props.autoQuery) {
  void vm.query()
}
watch(
  () => [route.query.documentId, route.query.mode] as const,
  ([documentId, mode]) => {
    if (typeof documentId !== 'string') return
    void vm.openDocument({ documentId }, mode === 'edit')
  },
  { immediate: true },
)

watch(
  () => vm.workspaceOpen,
  (open, wasOpen) => {
    if (open || !wasOpen || typeof route.query.documentId !== 'string') return
    const { documentId: _documentId, mode: _mode, ...query } = route.query
    void router.replace({ query })
  },
)

const returnSourceQuery = route.query.sourceDocumentIds
if (
  (vm.config.entity === 'sale-return' ||
    vm.config.entity === 'purchase-return') &&
  typeof returnSourceQuery === 'string' &&
  returnSourceQuery
) {
  const sourceIds = [...new Set(returnSourceQuery.split(',').filter(Boolean))]
  void vm.initializeReturnFromSources(sourceIds)
}

function updateReference(
  key: keyof VoucherDraftForm,
  value: VoucherReference | null,
): void {
  ;(vm.form as unknown as Record<string, unknown>)[key] = value
  vm.markReferenceChanged(key)
}

function search(key: string, keyword: string): void {
  vm.searchReference(key, keyword)
}

function selectSource(value: unknown): void {
  void vm.selectSourceDocument(typeof value === 'string' ? value : null)
}

function changeSort(value: typeof vm.sort): void {
  vm.sort = value
  vm.search()
}

async function saveDocument(): Promise<void> {
  if (await vm.save()) return
  await nextTick()
  document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

function referenceProps(key: string) {
  return {
    options: vm.referenceOptions(key),
    loading: vm.referenceLoading(key),
    errorMessage: vm.referenceError(key),
  }
}

function changeCounterpartyType(value: string): void {
  vm.form.counterpartyType = value === 'supplier' ? 'supplier' : 'customer'
  vm.form.counterparty = null
  vm.markReferenceChanged('counterpartyType')
  vm.searchReference('counterparty', '')
}

function openSecondary(
  action: typeof secondaryAction.value,
  title: string,
): void {
  secondaryAction.value = action
  secondaryTitle.value = title
  secondaryReason.value = ''
  secondaryOpen.value = true
}

async function confirmSecondary(): Promise<void> {
  if (!secondaryReason.value.trim()) return
  secondaryOpen.value = false
  await vm.secondaryAction(secondaryAction.value, secondaryReason.value.trim())
}

function requestListLifecycleAction(
  row: VoucherListItem,
  action: VoucherLifecycleAction,
): void {
  if (
    action === 'uncheck' ||
    action === 'unapprove' ||
    action === 'unfinalize'
  ) {
    listLifecycleTarget.value = row
    listLifecycleAction.value = action
    listLifecycleReason.value = ''
    return
  }
  void vm.lifecycleActionFromList(row, action)
}

async function confirmListLifecycleAction(): Promise<void> {
  const row = listLifecycleTarget.value
  const reason = listLifecycleReason.value.trim()
  if (!row || !reason || Array.from(reason).length > 1000) return
  if (
    await vm.lifecycleActionFromList(row, listLifecycleAction.value, reason)
  ) {
    listLifecycleTarget.value = null
    listLifecycleReason.value = ''
  }
}

function formatQuantityMicros(value: bigint): string {
  const whole = value / 1_000_000n
  const fraction = String(value % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

function updateSignoffLoss(line: VoucherSalesChainLineDraft): void {
  const outbound = parseFixed(line.outboundQuantity, 6, true)
  const signed = parseFixed(line.signedQuantity, 6, true)
  const rejected = parseFixed(line.rejectedQuantity, 6, true)
  line.lossQuantity =
    outbound !== null &&
    signed !== null &&
    rejected !== null &&
    signed + rejected <= outbound
      ? formatQuantityMicros(outbound - signed - rejected)
      : ''
}
</script>

<template>
  <v-container v-if="showList" fluid class="voucher-page pa-4 pa-md-7">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <VoucherList
      :action-loading="vm.actionLoading"
      :can-edit="vm.canEdit"
      :can-lifecycle-action="vm.canLifecycleAction"
      :can-view="vm.canView"
      :creatable="
        vm.canCreate &&
        vm.config.entity !== 'sale-return' &&
        vm.config.entity !== 'purchase-return'
      "
      :date-from="vm.filters.dateFrom"
      :date-to="vm.filters.dateTo"
      :fulfillment-summary-kind="
        vm.config.entity === 'sale-order'
          ? 'sales'
          : vm.config.entity === 'purchase-order'
            ? 'purchase'
            : undefined
      "
      :keyword="vm.filters.keyword"
      :loading="vm.loading"
      :lifecycle-labels="labels"
      :page="vm.page"
      :page-size="vm.pageSize"
      :party="vm.selectedParty"
      :party-enabled="partyEnabled"
      :party-error="vm.referenceError('party')"
      :party-label="partyLabel"
      :party-loading="vm.referenceLoading('party')"
      :party-options="vm.referenceOptions('party')"
      :queryable="vm.canQuery"
      :rows="vm.rows"
      :sort="vm.sort"
      :statuses="vm.filters.status"
      :total="vm.total"
      @create="vm.openCreate"
      @edit="vm.openDocument($event, true)"
      @lifecycle="requestListLifecycleAction"
      @party-search="vm.searchReference('party', $event)"
      @query="vm.search"
      @reset="vm.resetFilters"
      @update:date-from="vm.filters.dateFrom = $event"
      @update:date-to="vm.filters.dateTo = $event"
      @update:keyword="vm.filters.keyword = $event"
      @update:page="vm.changePage"
      @update:party="vm.selectedParty = $event"
      @update:sort="changeSort"
      @update:statuses="vm.filters.status = $event"
      @view="vm.openDocument($event)"
    />
  </v-container>

  <VoucherReasonDialog
    :model-value="Boolean(listLifecycleTarget)"
    :confirm-label="`确认${listLifecycleTitle}`"
    :loading="
      vm.actionLoading ===
      `${listLifecycleAction}:${listLifecycleTarget?.documentId}`
    "
    :reason="listLifecycleReason"
    :title="listLifecycleTitle"
    @confirm="confirmListLifecycleAction"
    @update:model-value="
      (value) => {
        if (!value) listLifecycleTarget = null
      }
    "
    @update:reason="listLifecycleReason = $event"
  />

  <VoucherWorkspace
    v-model="vm.workspaceOpen"
    :busy="vm.busy"
    :can-reload="Boolean(vm.documentView)"
    :dirty="vm.dirty"
    :document="vm.documentView"
    :editing="vm.editing"
    :error-message="vm.workspaceError"
    :title="workspaceTitle"
    @close="vm.closeWorkspace"
    @reload="vm.reloadDocument"
  >
    <template #actions>
      <VoucherWorkspaceActions
        :labels="labels"
        :model="model"
        @save="saveDocument"
        @secondary="openSecondary"
      />
    </template>

    <template #document>
      <v-card rounded="lg" variant="flat">
        <v-card-text>
          <VoucherDocumentHeader
            v-if="atomicDocument"
            :document-no="atomicDocument.documentNo"
            :entity-label="vm.config.title"
            :revision="atomicDocument.revision"
            :status="atomicDocument.status"
            :status-label="atomicStatusLabel"
          />
          <v-divider v-if="atomicDocument" class="my-5" />
          <v-expansion-panels
            v-model="basicInfoPanel"
            class="voucher-form__basic-panel"
            variant="accordion"
          >
            <v-expansion-panel value="basic">
              <v-expansion-panel-title>基本信息</v-expansion-panel-title>
              <v-expansion-panel-text>
                <div class="voucher-form__grid">
                  <v-text-field
                    v-model="vm.form.businessDate"
                    :disabled="!vm.editing"
                    :label="businessDateLabel"
                    type="date"
                    variant="outlined"
                  />
                  <v-autocomplete
                    v-if="
                      vm.config.productionMode === 'order' && !vm.documentView
                    "
                    clearable
                    :disabled="!vm.editing"
                    :error-messages="vm.sourceError ? [vm.sourceError] : []"
                    item-title="documentNo"
                    item-value="documentId"
                    :items="vm.sourceOptions"
                    label="来源销售订单"
                    :loading="vm.sourceLoading"
                    :model-value="vm.form.parentDocumentId || null"
                    no-filter
                    variant="outlined"
                    @update:model-value="selectSource"
                    @update:search="vm.searchSourceDocuments($event ?? '')"
                  />
                  <v-text-field
                    v-else-if="vm.config.parentEntity"
                    label="来源单据"
                    :model-value="parentDocumentNo"
                    readonly
                    variant="outlined"
                  />

                  <VoucherReferenceAutocomplete
                    v-if="
                      vm.config.partyMode === 'customer' ||
                      vm.config.partyMode === 'dual'
                    "
                    :disabled="!vm.editing"
                    v-bind="referenceProps('customer')"
                    label="客户"
                    :model-value="vm.form.customer"
                    required
                    @search="search('customer', $event)"
                    @update:model-value="updateReference('customer', $event)"
                  />
                  <VoucherReferenceAutocomplete
                    v-if="
                      vm.config.partyMode === 'supplier' ||
                      vm.config.partyMode === 'dual'
                    "
                    :disabled="!vm.editing"
                    v-bind="referenceProps('supplier')"
                    label="普通供应商"
                    :model-value="vm.form.supplier"
                    required
                    @search="search('supplier', $event)"
                    @update:model-value="updateReference('supplier', $event)"
                  />

                  <v-select
                    v-if="vm.config.partyMode === 'counterparty'"
                    :disabled="!vm.editing"
                    item-title="title"
                    item-value="value"
                    :items="[
                      { title: '客户', value: 'customer' },
                      { title: '供应商', value: 'supplier' },
                    ]"
                    label="往来方类型"
                    :model-value="vm.form.counterpartyType"
                    variant="outlined"
                    @update:model-value="changeCounterpartyType($event)"
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.partyMode === 'counterparty'"
                    :disabled="!vm.editing || !vm.form.counterpartyType"
                    v-bind="referenceProps('counterparty')"
                    :label="
                      vm.form.counterpartyType === 'supplier'
                        ? '供应商'
                        : '客户'
                    "
                    :model-value="vm.form.counterparty"
                    :required="vm.config.entity !== 'other-income'"
                    @search="search('counterparty', $event)"
                    @update:model-value="
                      updateReference('counterparty', $event)
                    "
                  />

                  <VoucherReferenceAutocomplete
                    v-if="vm.config.usesSalesperson"
                    :disabled="!vm.editing"
                    v-bind="referenceProps('salesperson')"
                    hint="新增时默认使用客户业务员"
                    label="业务员"
                    :model-value="vm.form.salesperson"
                    @search="search('salesperson', $event)"
                    @update:model-value="updateReference('salesperson', $event)"
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.usesPurchaser"
                    :disabled="!vm.editing"
                    v-bind="referenceProps('purchaser')"
                    hint="新增时默认使用供应商采购员"
                    label="采购员"
                    :model-value="vm.form.purchaser"
                    @search="search('purchaser', $event)"
                    @update:model-value="updateReference('purchaser', $event)"
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.usesWarehouse"
                    :disabled="
                      !vm.editing ||
                      (vm.config.entity === 'sale-outbound' &&
                        Boolean(vm.form.warehouse))
                    "
                    v-bind="referenceProps('warehouse')"
                    label="仓库"
                    :model-value="vm.form.warehouse"
                    required
                    @search="search('warehouse', $event)"
                    @update:model-value="updateReference('warehouse', $event)"
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.productionMode"
                    :disabled="!vm.editing"
                    v-bind="referenceProps('materialWarehouse')"
                    label="材料仓库"
                    :model-value="vm.form.materialWarehouse"
                    required
                    @search="search('materialWarehouse', $event)"
                    @update:model-value="
                      updateReference('materialWarehouse', $event)
                    "
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.productionMode"
                    :disabled="!vm.editing"
                    v-bind="referenceProps('finishedWarehouse')"
                    label="成品仓库"
                    :model-value="vm.form.finishedWarehouse"
                    required
                    @search="search('finishedWarehouse', $event)"
                    @update:model-value="
                      updateReference('finishedWarehouse', $event)
                    "
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.entity === 'sale-delivery'"
                    :disabled="!vm.editing"
                    v-bind="referenceProps('platform')"
                    label="物流平台"
                    :model-value="vm.form.platform"
                    required
                    @search="search('platform', $event)"
                    @update:model-value="updateReference('platform', $event)"
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.entity === 'sale-delivery'"
                    :disabled="!vm.editing || !vm.form.platform"
                    v-bind="referenceProps('vehicle')"
                    label="配送车辆"
                    :model-value="vm.form.vehicle"
                    required
                    @search="search('vehicle', $event)"
                    @update:model-value="updateReference('vehicle', $event)"
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.usesEmployee"
                    :disabled="!vm.editing || vm.config.generatedOnly"
                    v-bind="referenceProps('employee')"
                    label="员工"
                    :model-value="vm.form.employee"
                    required
                    @search="search('employee', $event)"
                    @update:model-value="updateReference('employee', $event)"
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.usesHandler"
                    :disabled="!vm.editing"
                    v-bind="referenceProps('handler')"
                    label="经办人"
                    :model-value="vm.form.handler"
                    required
                    @search="search('handler', $event)"
                    @update:model-value="updateReference('handler', $event)"
                  />
                  <VoucherReferenceAutocomplete
                    v-if="vm.config.usesFundAccount"
                    :disabled="!vm.editing"
                    v-bind="referenceProps('fundAccount')"
                    label="资金账户"
                    :model-value="vm.form.fundAccount"
                    required
                    @search="search('fundAccount', $event)"
                    @update:model-value="updateReference('fundAccount', $event)"
                  />
                  <v-text-field
                    v-if="vm.config.usesSourceName"
                    v-model="vm.form.sourceName"
                    :disabled="!vm.editing"
                    label="来源名称"
                    maxlength="200"
                    variant="outlined"
                  />
                  <v-text-field
                    v-if="vm.config.directAmount"
                    v-model="vm.form.amount"
                    :disabled="!vm.editing || vm.config.generatedOnly"
                    inputmode="decimal"
                    label="金额"
                    variant="outlined"
                  />
                  <v-textarea
                    v-if="
                      vm.config.entity === 'sale-return' ||
                      vm.config.entity === 'purchase-return'
                    "
                    v-model="vm.form.returnReason"
                    class="voucher-form__wide"
                    counter="1000"
                    :disabled="!vm.editing"
                    label="退货原因"
                    required
                    variant="outlined"
                  />
                  <v-textarea
                    v-model="vm.form.remark"
                    class="voucher-form__wide"
                    counter="1000"
                    :disabled="!vm.editing"
                    label="备注"
                    variant="outlined"
                  />
                </div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>

          <v-divider class="my-5" />
          <VoucherProductLinesEditor
            v-if="vm.config.lineKind === 'product'"
            v-model="vm.form.productLines"
            :editable="vm.editing"
            :formula-enabled="vm.config.entity === 'sale-order'"
            :product-error="vm.referenceError('product')"
            :product-loading="vm.referenceLoading('product')"
            :product-options="vm.referenceOptions('product')"
            :purchase-price-required="false"
            :settlement-surcharge-enabled="vm.config.entity === 'sale-order'"
            @product-search="vm.searchReference('product', $event)"
            @product-change="vm.changeLineProduct"
          />
          <VoucherPriceLinesEditor
            v-if="vm.config.lineKind === 'price'"
            v-model="vm.form.priceLines"
            :editable="vm.editing"
            :product-error="vm.referenceError('product')"
            :product-loading="vm.referenceLoading('product')"
            :product-options="vm.referenceOptions('product')"
            @product-search="vm.searchReference('product', $event)"
          />
          <VoucherExpenseLinesEditor
            v-if="vm.config.lineKind === 'expense'"
            v-model="vm.form.expenseLines"
            :editable="vm.editing"
          />
          <VoucherProductionLinesEditor
            v-if="vm.config.productionMode"
            v-model="vm.form.productionLines"
            :editable="vm.editing"
            :material-error="vm.referenceError('actualMaterial')"
            :material-loading="vm.referenceLoading('actualMaterial')"
            :material-options="vm.referenceOptions('actualMaterial')"
            :mode="vm.config.productionMode"
            :product-error="vm.referenceError('product')"
            :product-loading="vm.referenceLoading('product')"
            :product-options="vm.referenceOptions('product')"
            @add-line="vm.addProductionLine"
            @material-search="vm.searchReference('actualMaterial', $event)"
            @product-change="vm.changeProductionProduct"
            @product-search="vm.searchReference('product', $event)"
            @recalculate="vm.recalculateProductionLine"
          />
          <div
            v-if="
              (vm.config.entity === 'sale-return' ||
                vm.config.entity === 'purchase-return') &&
              vm.form.salesChainLines.length
            "
            class="voucher-form__chain-table"
          >
            <h3>退货明细</h3>
            <v-alert
              v-if="vm.form.returnKind === 'REFUSAL'"
              class="mb-3"
              type="info"
              variant="tonal"
            >
              本单由签收拒收自动生成，来源和数量不可修改。
            </v-alert>
            <v-table class="responsive-table responsive-table--form">
              <thead>
                <tr>
                  <th>产品</th>
                  <th>可退</th>
                  <th>退货数量</th>
                  <th>备注</th>
                  <th
                    v-if="vm.editing && vm.form.returnKind !== 'REFUSAL'"
                  ></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(line, index) in vm.form.salesChainLines"
                  :key="line.key"
                >
                  <td data-label="产品">
                    {{
                      formatReferenceLabel({
                        code: line.productCode,
                        name: line.productName,
                      })
                    }}
                    {{ line.productUnit }}
                  </td>
                  <td data-label="可退">{{ line.availableQuantity || '—' }}</td>
                  <td data-label="退货数量">
                    <CompactTableField
                      v-model="line.quantity"
                      :disabled="
                        !vm.editing || vm.form.returnKind === 'REFUSAL'
                      "
                      inputmode="decimal"
                    />
                  </td>
                  <td data-label="备注">
                    <CompactTableField
                      v-model="line.remark"
                      :disabled="
                        !vm.editing || vm.form.returnKind === 'REFUSAL'
                      "
                    />
                  </td>
                  <td
                    v-if="vm.editing && vm.form.returnKind !== 'REFUSAL'"
                    class="responsive-table__actions"
                    data-label="操作"
                  >
                    <v-btn
                      aria-label="移除此退货明细"
                      icon="mdi-delete-outline"
                      size="small"
                      variant="text"
                      @click="vm.form.salesChainLines.splice(index, 1)"
                    />
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
          <div
            v-if="
              vm.config.entity === 'sale-outbound' &&
              vm.form.salesChainLines.length
            "
            class="voucher-form__chain-table"
          >
            <h3>出库明细</h3>
            <v-table class="responsive-table responsive-table--form">
              <thead>
                <tr>
                  <th>产品</th>
                  <th>可出库</th>
                  <th>本次出库</th>
                  <th>备注</th>
                  <th v-if="vm.editing"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(line, index) in vm.form.salesChainLines"
                  :key="line.key"
                >
                  <td data-label="产品">
                    {{
                      formatReferenceLabel({
                        code: line.productCode,
                        name: line.productName,
                      })
                    }}
                    {{ line.productUnit }}
                  </td>
                  <td data-label="可出库">{{ line.availableQuantity }}</td>
                  <td data-label="本次出库">
                    <CompactTableField
                      v-model="line.quantity"
                      :disabled="!vm.editing"
                      inputmode="decimal"
                    />
                  </td>
                  <td data-label="备注">
                    <CompactTableField
                      v-model="line.remark"
                      :disabled="!vm.editing"
                    />
                  </td>
                  <td
                    v-if="vm.editing"
                    class="responsive-table__actions"
                    data-label="操作"
                  >
                    <v-btn
                      aria-label="移除此出库明细"
                      icon="mdi-delete-outline"
                      size="small"
                      variant="text"
                      @click="vm.form.salesChainLines.splice(index, 1)"
                    />
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>
          <div
            v-if="
              vm.config.entity === 'sale-delivery' && vm.form.parentDocumentId
            "
            class="voucher-form__chain-summary"
          >
            <v-alert type="info" variant="tonal">
              本销售送货承接销售出库
              {{ vm.form.parentDocumentNo }} 的全部出库明细。
            </v-alert>
          </div>
          <div
            v-if="
              vm.config.entity === 'sale-signoff' &&
              vm.form.salesChainLines.length
            "
            class="voucher-form__chain-table"
          >
            <h3>签收明细</h3>
            <v-table class="responsive-table responsive-table--form">
              <thead>
                <tr>
                  <th>产品</th>
                  <th>配送</th>
                  <th>签收</th>
                  <th>拒收</th>
                  <th>损耗</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in vm.form.salesChainLines" :key="line.key">
                  <td data-label="产品">
                    {{
                      formatReferenceLabel({
                        code: line.productCode,
                        name: line.productName,
                      })
                    }}
                    {{ line.productUnit }}
                  </td>
                  <td data-label="配送">{{ line.outboundQuantity }}</td>
                  <td data-label="签收">
                    <CompactTableField
                      v-model="line.signedQuantity"
                      :disabled="!vm.editing"
                      inputmode="decimal"
                      @update:model-value="updateSignoffLoss(line)"
                    />
                  </td>
                  <td data-label="拒收">
                    <CompactTableField
                      v-model="line.rejectedQuantity"
                      :disabled="!vm.editing"
                      inputmode="decimal"
                      @update:model-value="updateSignoffLoss(line)"
                    />
                  </td>
                  <td data-label="损耗">{{ line.lossQuantity || '—' }}</td>
                  <td data-label="备注">
                    <CompactTableField
                      v-model="line.remark"
                      :disabled="!vm.editing"
                    />
                  </td>
                </tr>
              </tbody>
            </v-table>
          </div>

          <template v-if="vm.documentView">
            <v-divider class="my-5" />
            <h3>业务快照与处理结果</h3>
            <div class="voucher-form__snapshot-grid">
              <div>
                <strong>金额</strong><span>{{ vm.documentView.amount }}</span>
              </div>
              <div>
                <strong>联系人</strong
                ><span>{{ vm.documentView.data.contactName || '—' }}</span>
              </div>
              <div>
                <strong>联系电话</strong
                ><span>{{ vm.documentView.data.contactPhone || '—' }}</span>
              </div>
              <div>
                <strong>送货地址</strong
                ><span>{{ vm.documentView.data.deliveryAddress || '—' }}</span>
              </div>
              <div v-if="vm.documentView.data.settlementMethod">
                <strong>结算方式</strong>
                <span>
                  {{
                    formatReferenceLabel(vm.documentView.data.settlementMethod)
                  }}
                  · 到期
                  {{
                    resolveDueDate(
                      vm.documentView.data.dueDate,
                      vm.documentView.data.businessDate,
                      vm.documentView.data.settlementMethod,
                    )
                  }}
                </span>
              </div>
              <div v-if="vm.documentView.data.customerSettlementMethod">
                <strong>客户结算</strong>
                <span>
                  {{
                    formatReferenceLabel(
                      vm.documentView.data.customerSettlementMethod,
                    )
                  }}
                  · 到期
                  {{
                    resolveDueDate(
                      vm.documentView.data.dueDate,
                      vm.documentView.data.businessDate,
                      vm.documentView.data.customerSettlementMethod,
                    )
                  }}
                </span>
              </div>
              <div v-if="vm.documentView.data.supplierSettlementMethod">
                <strong>供应商结算</strong>
                <span>
                  {{
                    formatReferenceLabel(
                      vm.documentView.data.supplierSettlementMethod,
                    )
                  }}
                  · 到期
                  {{
                    resolveDueDate(
                      vm.documentView.data.dueDate,
                      vm.documentView.data.businessDate,
                      vm.documentView.data.supplierSettlementMethod,
                    )
                  }}
                </span>
              </div>
              <div v-if="vm.documentView.data.outboundDate">
                <strong>出库/签收</strong>
                <span
                  >{{ vm.documentView.data.outboundDate }} /
                  {{ vm.documentView.data.signoffDate }}</span
                >
              </div>
              <div v-if="vm.documentView.data.inboundDate">
                <strong>入库日期</strong
                ><span>{{ vm.documentView.data.inboundDate }}</span>
              </div>
              <div v-if="vm.documentView.data.platform">
                <strong>物流平台/车辆</strong>
                <span>
                  {{ formatReferenceLabel(vm.documentView.data.platform) }} /
                  {{
                    vm.documentView.data.vehicle
                      ? formatReferenceLabel(vm.documentView.data.vehicle)
                      : '—'
                  }}
                </span>
              </div>
              <div v-if="vm.documentView.parentDocumentNo">
                <strong>来源单据</strong>
                <span>{{ vm.documentView.parentDocumentNo }}</span>
              </div>
              <div v-if="vm.documentView.data.fulfillmentStatus">
                <strong>履约状态</strong>
                <span>{{ vm.documentView.data.fulfillmentStatus }}</span>
              </div>
              <div v-if="vm.documentView.data.remainingQuantity">
                <strong>已签 / 在途 / 可出库</strong>
                <span>
                  {{ vm.documentView.data.signedQuantity }} /
                  {{ vm.documentView.data.inTransitQuantity }} /
                  {{ vm.documentView.data.remainingQuantity }}
                </span>
              </div>
            </div>
          </template>
        </v-card-text>
      </v-card>
    </template>

    <template #attachments>
      <v-card rounded="lg" variant="flat">
        <v-card-text>
          <VoucherAttachmentPanel
            :attachments="vm.documentView?.attachments ?? []"
            :can-download="vm.actionAvailability.attachmentDownload"
            :can-remove="vm.actionAvailability.attachmentRemove"
            :can-upload="vm.actionAvailability.attachmentInitiate"
            :document-created="Boolean(vm.documentView)"
            :draft="vm.documentView?.status === 'DRAFT'"
            :error-message="vm.attachmentError"
            :loading="vm.attachmentLoading"
            @download="vm.downloadAttachment"
            @remove="vm.removeAttachment"
            @upload="vm.uploadAttachments"
          />
        </v-card-text>
      </v-card>
    </template>

    <template #audit>
      <v-card rounded="lg" variant="flat">
        <v-card-text>
          <VoucherAuditHistory
            v-if="vm.actionAvailability.audit"
            :error-message="vm.auditError"
            :events="vm.auditEvents"
            :loading="vm.auditLoading"
            :page="vm.auditPage"
            :page-size="vm.auditPageSize"
            :total="vm.auditTotal"
            @reload="vm.loadAudit()"
            @update:page="vm.loadAudit"
          />
          <v-alert v-else type="warning" variant="tonal">
            当前账号没有查看审计记录的权限，或单据尚未创建。
          </v-alert>
        </v-card-text>
      </v-card>
    </template>
  </VoucherWorkspace>

  <VoucherExecutionDialog
    v-model="vm.executionOpen"
    :document="vm.documentView"
    :error-message="vm.executionError"
    :kind="vm.config.finalizationKind"
    :platform-loading="vm.referenceLoading('platform')"
    :platform-options="vm.referenceOptions('platform')"
    :saving="vm.actionLoading === 'finalize'"
    :vehicle-loading="vm.referenceLoading('vehicle')"
    :vehicle-options="vm.referenceOptions('vehicle')"
    @platform-search="vm.searchReference('platform', $event)"
    @submit="vm.finalize"
    @vehicle-search="vm.searchReference('vehicle', $event)"
  />

  <VoucherReasonDialog
    v-model="secondaryOpen"
    :reason="secondaryReason"
    :title="secondaryTitle"
    @confirm="confirmSecondary"
    @update:reason="secondaryReason = $event"
  />
</template>

<style scoped>
.voucher-form__basic-panel {
  margin-bottom: 4px;
}
.voucher-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 20px;
}
.voucher-form__wide {
  grid-column: 1 / -1;
}
.voucher-form__snapshot-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 14px;
}
.voucher-form__snapshot-grid div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}
.voucher-form__snapshot-grid span {
  color: rgb(var(--v-theme-on-surface-variant));
}
.voucher-form__chain-table {
  margin-top: 18px;
  overflow-x: auto;
}
.voucher-form__chain-table h3 {
  margin-bottom: 12px;
}
.voucher-form__chain-table :deep(.v-input) {
  min-width: 120px;
}
.voucher-form__chain-summary {
  margin-top: 18px;
}
@media (max-width: 800px) {
  .voucher-form__grid,
  .voucher-form__snapshot-grid {
    grid-template-columns: 1fr;
  }
  .voucher-form__wide {
    grid-column: auto;
  }
}
</style>
