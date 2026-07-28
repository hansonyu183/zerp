<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import {
  isMoney,
  isQuantity,
  VoucherAttachmentPanel,
  VoucherDocumentHeader,
  VoucherReferenceAutocomplete,
  type VoucherReference,
} from '@/components/voucher'
import CompactTableField from '@/components/common/CompactTableField.vue'
import {
  WflAuditHistory,
  WflProcessList,
  WflProcessWorkspace,
  WflReasonDialog,
  WflStageSection,
  type WflAction,
  type WflDocumentSummary,
  type WflProcessListRow,
  type WflStage,
} from '@/components/wfl'
import type { IntermediaryAction } from './api'
import IntermediaryOrderLinesEditor from './IntermediaryOrderLinesEditor.vue'
import {
  intermediaryTradeDefinition,
  stageDefinition,
} from './definition'
import {
  useIntermediaryWorkflowViewModel,
  type IntermediaryWorkflowViewModel,
} from './vm'
import type {
  IntermediaryChildStage,
  IntermediaryChildSummary,
  IntermediaryDeliveryDraft,
  IntermediaryProcurementDraft,
  IntermediaryReceiptDraft,
  IntermediarySignoffDraft,
} from './types'

const props = defineProps<{ model?: IntermediaryWorkflowViewModel }>()
const vm = reactive(props.model ?? useIntermediaryWorkflowViewModel())
const showCurrency = ref(false)
const currencyVisible = computed(() =>
  showCurrency.value ||
  vm.orderDraft.currency.trim().toUpperCase() !== 'CNY' ||
  Boolean(vm.errorMessage?.includes('币种') || vm.workspaceError?.includes('币种')),
)

const workflowStatuses: Readonly<Record<string, string>> =
  intermediaryTradeDefinition.statuses

const stageNames: Record<string, string> = {
  CUSTOMER_ORDER: '居间订单',
  PROCUREMENT: '居间采购',
  RECEIPT: '收货',
  DELIVERY: '送货',
  SIGNOFF: '签收',
}

const stepItems = [
  { value: 1, title: '居间订单', icon: 'mdi-cart-outline' },
  { value: 2, title: '居间采购', icon: 'mdi-file-sign' },
  { value: 3, title: '居间收货', icon: 'mdi-tray-arrow-down' },
  { value: 4, title: '居间送货', icon: 'mdi-truck-delivery-outline' },
  { value: 5, title: '居间签收', icon: 'mdi-clipboard-check-outline' },
  { value: 6, title: '审计', icon: 'mdi-history' },
]

const statusOptions = Object.entries(workflowStatuses).map(([value, title]) => ({
  value,
  title,
}))

void vm.query()

async function saveOrder(): Promise<void> {
  if (await vm.saveOrder()) return
  await nextTick()
  document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

async function saveStage(): Promise<void> {
  if (await vm.saveStage()) return
  await nextTick()
  document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

function workflowText(status?: string): string {
  return status ? (workflowStatuses[status] ?? status) : '—'
}

function stageName(stage?: string): string {
  return stage ? (stageNames[stage] ?? stage) : '主单'
}

function selectOrderReference(
  key: 'customer' | 'salesperson',
  value: VoucherReference | null,
): void {
  vm.orderDraft[key] = value
  vm.orderDirty = true
}

function openRow(row: WflProcessListRow): void {
  if (!vm.can('get')) return
  const source = vm.rows.find((item) => item.processId === row.processId)
  if (source) void vm.openDocument(source)
}

function lineName(rootLineId: string): string {
  const line = vm.document?.productLines.find(
    (candidate) => candidate.lineId === rootLineId,
  )
  return line ? `${line.product.code} · ${line.product.name}` : rootLineId
}

function stageDraftAs<T>(): T {
  return vm.stageDraft as T
}

function stageTitle(): string {
  return `${vm.stageChild ? '查看/编辑' : '新建'}${stageName(vm.stageEditing)}`
}

function childAttachmentCan(
  operation: 'Initiate' | 'Download' | 'Remove',
): boolean {
  const prefix = vm.stageEditing.toLowerCase()
  return vm.can(
    `${prefix}-attachment-${operation.toLowerCase()}` as IntermediaryAction,
  )
}

function openShortClose(): void {
  vm.shortCloseReason = ''
  vm.shortCloseDialogOpen = true
}

function stageDocuments(
  items: readonly IntermediaryChildSummary[],
  stage: WflStage,
): WflDocumentSummary[] {
  const definition = stageDefinition(stage)
  return items.map((item) => ({
    documentId: item.childId,
    documentNo: item.childNo,
    entity: definition.entity,
    stage,
    status: item.status,
    revision: item.revision,
    parentDocumentId: item.parentDocumentId,
    businessDate: item.businessDate ?? item.createdAt.slice(0, 10),
    currency: item.currency,
    amount: item.amount ?? '0.00',
    attachments: item.attachments ?? [],
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    reviewedAt: item.checkedAt,
    reviewedBy: item.checkedBy,
    approvedAt: item.finalAt,
    approvedBy: item.finalBy,
  }))
}

function child(document: WflDocumentSummary): IntermediaryChildSummary {
  const result = vm.document?.children.find(
    (item) => item.childId === document.documentId,
  )
  if (!result) throw new Error('阶段单据已经变化，请重新加载流程。')
  return result
}

function openStageDocument(
  stage: IntermediaryChildStage,
  document: WflDocumentSummary,
): void {
  void vm.openStage(stage, child(document))
}

function runStageAction(
  action: WflAction,
  document: WflDocumentSummary,
): void {
  void vm.runChildAction(action, child(document))
}

function reverseStageAction(
  action: WflAction,
  document: WflDocumentSummary,
): void {
  vm.openReverse(action, child(document))
}

function createSignoff(document: WflDocumentSummary): void {
  void vm.openStage('SIGNOFF', undefined, child(document))
}
</script>

<template>
  <v-container fluid class="intermediary-trade pa-4 pa-md-7">
    <v-alert v-if="vm.errorMessage" class="mb-4" type="error" variant="tonal">
      {{ vm.errorMessage }}
    </v-alert>
    <WflProcessList
      :can-create="vm.canCreate"
      :can-open="vm.can('get')"
      :can-query="vm.canQuery"
      :keyword="vm.filters.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :rows="vm.rows"
      :stage-text="stageName"
      :status-options="statusOptions"
      :status-text="workflowText"
      :statuses="vm.filters.statuses"
      :total="vm.total"
      @create="vm.openCreate"
      @open="openRow"
      @query="vm.search"
      @reset="vm.resetFilters"
      @update:keyword="vm.filters.keyword = $event"
      @update:page="vm.changePage"
      @update:statuses="vm.filters.statuses = $event"
    >
      <template #heading>
        <div>
          <div class="intermediary-trade__eyebrow">WFL · 业务流程</div>
          <h1>居间贸易</h1>
        </div>
      </template>
    </WflProcessList>
  </v-container>

  <WflProcessWorkspace
    v-model="vm.workspaceOpen"
    :active-tab="vm.activeStep"
    :busy="vm.workspaceLoading || Boolean(vm.actionLoading) || vm.childAttachmentLoading"
    :dirty="vm.workspaceDirty"
    :error-message="vm.workspaceError"
    :revision="vm.document?.rootRevision"
    :status-label="workflowText(vm.document?.workflowStatus)"
    :tabs="stepItems"
    :title="vm.document?.documentNo ?? '新建居间订单'"
    @close="vm.closeWorkspace"
    @reload="vm.loadDocument()"
    @update:active-tab="vm.changeActiveStep(Number($event))"
  >
      <v-window
        class="intermediary-workspace__window"
        :model-value="vm.activeStep"
        @update:model-value="vm.changeActiveStep(Number($event))"
      >
        <v-window-item :value="1">
          <v-card rounded="lg" variant="flat">
            <v-card-title class="intermediary-workspace__section-title">
              <span>居间订单</span>
              <div>
                <template v-if="vm.orderEditing">
                  <v-btn v-if="vm.document" :disabled="Boolean(vm.actionLoading)" variant="text" @click="vm.cancelOrderEditing">取消</v-btn>
                  <v-btn color="primary" :loading="vm.actionLoading === 'save'" @click="saveOrder">
                    {{ vm.document ? '保存草稿' : '创建草稿' }}
                  </v-btn>
                </template>
                <template v-else-if="vm.document">
                  <v-btn v-if="vm.document.workflowStatus === 'DRAFT' && vm.can('save')" :disabled="Boolean(vm.actionLoading)" variant="tonal" @click="vm.startOrderEditing">编辑</v-btn>
                  <v-btn v-if="vm.document.workflowStatus === 'DRAFT' && vm.can('check')" color="primary" :disabled="Boolean(vm.actionLoading)" :loading="vm.actionLoading === 'check'" @click="vm.runRootAction('check')">核对</v-btn>
                  <v-btn v-if="vm.document.workflowStatus === 'CHECKED' && vm.can('uncheck')" :disabled="Boolean(vm.actionLoading)" variant="text" @click="vm.openReverse('uncheck')">反核对</v-btn>
                  <v-btn
                    v-if="vm.document.workflowStatus === 'CHECKED' && vm.can('approve')"
                    color="primary"
                    :disabled="Boolean(vm.actionLoading) || !vm.canFinalize('approve', vm.document.checkedBy)"
                    :loading="vm.actionLoading === 'approve'"
                    :title="vm.document.checkedBy === vm.currentUserId ? '批准人与核对人不能是同一用户' : undefined"
                    @click="vm.runRootAction('approve')"
                  >
                    批准
                  </v-btn>
                  <v-btn v-if="vm.document.workflowStatus === 'APPROVED' && vm.can('unapprove')" :disabled="Boolean(vm.actionLoading)" variant="text" @click="vm.openReverse('unapprove')">反批准</v-btn>
                </template>
              </div>
            </v-card-title>
            <v-card-text>
              <VoucherDocumentHeader
                v-if="vm.document"
                :document-no="vm.document.documentNo"
                entity-label="居间订单"
                :revision="vm.document.documentRevision"
                :status="vm.document.workflowStatus"
                :status-label="workflowText(vm.document.workflowStatus)"
              />
              <div
                v-if="vm.document"
                class="intermediary-workspace__document-meta my-5"
              >
                <div><strong>Process ID</strong><span>{{ vm.document.processId }}</span></div>
                <div><strong>Document ID</strong><span>{{ vm.document.documentId }}</span></div>
                <div><strong>业务日期</strong><span>{{ vm.document.businessDate }}</span></div>
                <div><strong>金额</strong><span>{{ vm.document.amount }}</span></div>
                <div><strong>核对人</strong><span>{{ vm.document.checkedBy || '—' }}</span></div>
                <div><strong>批准人</strong><span>{{ vm.document.approvedBy || '—' }}</span></div>
              </div>
              <div class="intermediary-workspace__form-grid">
                <v-text-field v-model="vm.orderDraft.businessDate" :disabled="!vm.orderEditing" label="订购日期" type="date" variant="outlined" @update:model-value="vm.orderDirty = true" />
                <v-text-field v-if="currencyVisible" v-model="vm.orderDraft.currency" :disabled="!vm.orderEditing" label="币种" maxlength="3" variant="outlined" @update:model-value="vm.orderDraft.currency = ($event ?? '').toUpperCase(); vm.orderDirty = true" />
                <div class="intermediary-workspace__wide text-end">
                  <v-btn size="small" variant="text" @click="showCurrency = !showCurrency">
                    {{ showCurrency ? '隐藏币种' : '更多设置' }}
                  </v-btn>
                </div>
                <VoucherReferenceAutocomplete
                  :disabled="!vm.orderEditing"
                  :error-message="vm.referenceError('customer')"
                  label="客户"
                  :loading="vm.referenceLoading('customer')"
                  :model-value="vm.orderDraft.customer"
                  :options="vm.referenceOptions('customer')"
                  required
                  @search="vm.searchReference('customer', $event)"
                  @update:model-value="selectOrderReference('customer', $event)"
                />
                <VoucherReferenceAutocomplete
                  :disabled="!vm.orderEditing"
                  :error-message="vm.referenceError('salesperson')"
                  label="业务员（可使用客户默认值）"
                  :loading="vm.referenceLoading('salesperson')"
                  :model-value="vm.orderDraft.salesperson"
                  :options="vm.referenceOptions('salesperson')"
                  @search="vm.searchReference('salesperson', $event)"
                  @update:model-value="selectOrderReference('salesperson', $event)"
                />
                <v-textarea v-model="vm.orderDraft.remark" class="intermediary-workspace__wide" :disabled="!vm.orderEditing" label="备注" counter="1000" variant="outlined" @update:model-value="vm.orderDirty = true" />
              </div>
              <IntermediaryOrderLinesEditor
                v-model="vm.orderDraft.productLines"
                :editable="vm.orderEditing"
                :product-error="vm.referenceError('product')"
                :product-loading="vm.referenceLoading('product')"
                :product-options="vm.referenceOptions('product')"
                @product-search="vm.searchReference('product', $event)"
                @update:model-value="vm.orderDirty = true"
              />
            </v-card-text>
          </v-card>
        </v-window-item>

        <v-window-item :value="2">
          <v-alert v-if="!vm.can('procurement-get')" class="mb-4" type="info" variant="tonal">
            当前账号没有采购详情权限，供应商、采购价格和采购数量已由后端脱敏。
          </v-alert>
          <WflStageSection
            :definition="stageDefinition('PROCUREMENT')"
            :items="stageDocuments(vm.procurement ? [vm.procurement] : [], 'PROCUREMENT')"
            :can-create="Boolean(vm.document?.workflowStatus === 'APPROVED' && !vm.procurement && vm.can('procurement-create'))"
            :can-open="vm.can('procurement-get')"
            :can-action="vm.can"
            :current-user-id="vm.currentUserId"
            @create="vm.openStage('PROCUREMENT')"
            @open="openStageDocument('PROCUREMENT', $event)"
            @action="runStageAction"
            @reverse="reverseStageAction"
          />
        </v-window-item>

        <v-window-item :value="3">
          <WflStageSection
            :definition="stageDefinition('RECEIPT')"
            :items="stageDocuments(vm.receipts, 'RECEIPT')"
            :can-create="vm.canCreateReceipt && vm.can('receipt-create')"
            :can-open="vm.can('receipt-get')"
            :can-action="vm.can"
            :current-user-id="vm.currentUserId"
            @create="vm.openStage('RECEIPT')"
            @open="openStageDocument('RECEIPT', $event)"
            @action="runStageAction"
            @reverse="reverseStageAction"
          />
        </v-window-item>

        <v-window-item :value="4">
          <WflStageSection
            :definition="stageDefinition('DELIVERY')"
            :items="stageDocuments(vm.deliveries, 'DELIVERY')"
            :can-create="vm.canCreateDelivery && vm.can('delivery-create')"
            :can-open="vm.can('delivery-get')"
            :can-action="vm.can"
            :current-user-id="vm.currentUserId"
            @create="vm.openStage('DELIVERY')"
            @open="openStageDocument('DELIVERY', $event)"
            @action="runStageAction"
            @reverse="reverseStageAction"
            @create-signoff="createSignoff"
          />
        </v-window-item>

        <v-window-item :value="5">
          <WflStageSection
            :definition="stageDefinition('SIGNOFF')"
            :items="stageDocuments(vm.signoffs, 'SIGNOFF')"
            :can-create="false"
            :can-open="vm.can('signoff-get')"
            :can-action="vm.can"
            :current-user-id="vm.currentUserId"
            @open="openStageDocument('SIGNOFF', $event)"
            @action="runStageAction"
            @reverse="reverseStageAction"
          />
        </v-window-item>

        <v-window-item :value="6">
          <v-card rounded="lg" variant="flat">
            <v-card-text>
              <WflAuditHistory
                v-if="vm.can('audit-history')"
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
                当前账号没有查看流程审计的权限。
              </v-alert>
            </v-card-text>
          </v-card>
        </v-window-item>
      </v-window>

      <v-footer v-if="vm.document" class="intermediary-workspace__footer">
        <div class="intermediary-workspace__balances">
          <span>客户空桶余额（溶剂）：{{ vm.rootContainerBalance.solvent }}</span>
          <span>客户空桶余额（树脂）：{{ vm.rootContainerBalance.resin }}</span>
        </div>
        <v-spacer />
        <v-btn
          v-if="vm.document.workflowStatus === 'APPROVED' && vm.can('short-close-request')"
          color="warning"
          :disabled="Boolean(vm.actionLoading)"
          prepend-icon="mdi-archive-arrow-down-outline"
          variant="tonal"
          @click="openShortClose"
        >
          申请短结
        </v-btn>
        <v-btn
          v-if="vm.document.workflowStatus === 'SHORT_CLOSE_REQUESTED' && vm.can('short-close-cancel')"
          :disabled="Boolean(vm.actionLoading)"
          variant="text"
          @click="vm.openReverse('short-close-cancel')"
        >
          撤销短结申请
        </v-btn>
        <v-btn
          v-if="vm.document.workflowStatus === 'SHORT_CLOSE_REQUESTED' && vm.can('short-close-confirm')"
          color="warning"
          :disabled="Boolean(vm.actionLoading)"
          :loading="vm.actionLoading === 'short-close-confirm'"
          @click="vm.openReverse('short-close-confirm')"
        >
          确认短结
        </v-btn>
        <v-btn
          v-if="vm.document.workflowStatus === 'SHORT_CLOSED' && vm.can('short-close-unconfirm')"
          :disabled="Boolean(vm.actionLoading)"
          variant="text"
          @click="vm.openReverse('short-close-unconfirm')"
        >
          反确认短结
        </v-btn>
      </v-footer>
  </WflProcessWorkspace>

  <v-dialog v-model="vm.stageDialogOpen" max-width="1180" persistent scrollable>
    <v-card>
      <v-card-title>{{ stageTitle() }}</v-card-title>
      <v-card-text>
        <v-alert v-if="vm.stageDialogError" class="mb-4" type="error" variant="tonal">{{ vm.stageDialogError }}</v-alert>
        <v-alert
          v-if="vm.stageSaveBlockedReason"
          class="mb-4"
          type="warning"
          variant="tonal"
        >
          {{ vm.stageSaveBlockedReason }}
        </v-alert>
        <template v-if="vm.stageEditing === 'PROCUREMENT' && vm.stageDraft">
          <div class="intermediary-workspace__form-grid">
            <v-text-field v-model="stageDraftAs<IntermediaryProcurementDraft>().purchaseDate" :disabled="!vm.stageEditable" label="采购日期" type="date" variant="outlined" />
            <VoucherReferenceAutocomplete
              :disabled="!vm.stageEditable"
              :error-message="vm.referenceError('supplier')"
              label="普通供应商"
              :loading="vm.referenceLoading('supplier')"
              :model-value="stageDraftAs<IntermediaryProcurementDraft>().supplier"
              :options="vm.referenceOptions('supplier')"
              required
              @search="vm.searchReference('supplier', $event)"
              @update:model-value="stageDraftAs<IntermediaryProcurementDraft>().supplier = $event"
            />
            <VoucherReferenceAutocomplete
              :disabled="!vm.stageEditable"
              :error-message="vm.referenceError('purchaser')"
              label="采购员（可使用供应商默认值）"
              :loading="vm.referenceLoading('purchaser')"
              :model-value="stageDraftAs<IntermediaryProcurementDraft>().purchaser"
              :options="vm.referenceOptions('purchaser')"
              @search="vm.searchReference('purchaser', $event)"
              @update:model-value="stageDraftAs<IntermediaryProcurementDraft>().purchaser = $event"
            />
          </div>
          <div class="intermediary-trade__table-wrap">
            <v-table>
              <thead><tr><th>产品</th><th>订购</th><th>采购</th><th>采购价</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="line in stageDraftAs<IntermediaryProcurementDraft>().lines" :key="line.rootLineId">
                  <td>{{ lineName(line.rootLineId) }}</td>
                  <td>{{ vm.document?.productLines.find((item) => item.lineId === line.rootLineId)?.orderedQuantity }}</td>
                  <td><CompactTableField v-model="line.quantity" :disabled="!vm.stageEditable" :rules="[(value) => isQuantity(value) || '采购数量格式不正确。']" /></td>
                  <td><CompactTableField v-model="line.unitPrice" :disabled="!vm.stageEditable" :rules="[(value) => isMoney(value) || '采购单价格式不正确。']" /></td>
                  <td><CompactTableField v-model="line.remark" :disabled="!vm.stageEditable" :maxlength="1000" /></td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </template>

        <template v-else-if="vm.stageEditing === 'RECEIPT' && vm.stageDraft">
          <v-text-field v-model="stageDraftAs<IntermediaryReceiptDraft>().receiptDate" :disabled="!vm.stageEditable" label="收货日期" type="date" variant="outlined" />
          <div class="intermediary-trade__table-wrap">
            <v-table>
              <thead><tr><th>产品</th><th>实收</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="line in stageDraftAs<IntermediaryReceiptDraft>().lines" :key="line.rootLineId">
                  <td>{{ lineName(line.rootLineId) }}</td>
                  <td><CompactTableField v-model="line.quantity" :disabled="!vm.stageEditable" :rules="[(value) => isQuantity(value) || '实收数量格式不正确。']" /></td>
                  <td><CompactTableField v-model="line.remark" :disabled="!vm.stageEditable" :maxlength="1000" /></td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </template>

        <template v-else-if="vm.stageEditing === 'DELIVERY' && vm.stageDraft">
          <div class="intermediary-workspace__form-grid">
            <v-text-field v-model="stageDraftAs<IntermediaryDeliveryDraft>().deliveryDate" :disabled="!vm.stageEditable" label="送货日期" type="date" variant="outlined" />
            <VoucherReferenceAutocomplete
              :disabled="!vm.stageEditable"
              :error-message="vm.referenceError('platform')"
              label="物流平台"
              :loading="vm.referenceLoading('platform')"
              :model-value="stageDraftAs<IntermediaryDeliveryDraft>().platform"
              :options="vm.referenceOptions('platform')"
              required
              @search="vm.searchReference('platform', $event)"
              @update:model-value="stageDraftAs<IntermediaryDeliveryDraft>().platform = $event; stageDraftAs<IntermediaryDeliveryDraft>().vehicle = null; vm.searchReference('vehicle', '')"
            />
            <VoucherReferenceAutocomplete
              :disabled="!vm.stageEditable || !stageDraftAs<IntermediaryDeliveryDraft>().platform"
              :error-message="vm.referenceError('vehicle')"
              label="送货车辆"
              :loading="vm.referenceLoading('vehicle')"
              :model-value="stageDraftAs<IntermediaryDeliveryDraft>().vehicle"
              :options="vm.referenceOptions('vehicle')"
              required
              @search="vm.searchReference('vehicle', $event)"
              @update:model-value="stageDraftAs<IntermediaryDeliveryDraft>().vehicle = $event"
            />
          </div>
          <div class="intermediary-trade__table-wrap">
            <v-table>
              <thead><tr><th>产品</th><th>可送</th><th>送货</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="line in stageDraftAs<IntermediaryDeliveryDraft>().lines" :key="line.rootLineId">
                  <td>{{ lineName(line.rootLineId) }}</td>
                  <td>{{ vm.document?.balances.lines.find((item) => item.rootLineId === line.rootLineId)?.availableToDeliverQuantity }}</td>
                  <td><CompactTableField v-model="line.quantity" :disabled="!vm.stageEditable" :rules="[(value) => isQuantity(value) || '送货数量格式不正确。']" /></td>
                  <td><CompactTableField v-model="line.remark" :disabled="!vm.stageEditable" :maxlength="1000" /></td>
                </tr>
              </tbody>
            </v-table>
          </div>
          <v-alert class="mt-4" type="info" variant="tonal">
            本次应回收：溶剂桶 {{ vm.expectedContainers.solvent }} 个，树脂桶 {{ vm.expectedContainers.resin }} 个。
          </v-alert>
        </template>

        <template v-else-if="vm.stageEditing === 'SIGNOFF' && vm.stageDraft">
          <v-text-field v-model="stageDraftAs<IntermediarySignoffDraft>().signoffDate" :disabled="!vm.stageEditable" label="签收日期" type="date" variant="outlined" />
          <div class="intermediary-trade__table-wrap">
            <v-table>
              <thead><tr><th>产品</th><th>送货</th><th>签收</th><th>拒收</th><th>损耗（自动）</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="(line, index) in stageDraftAs<IntermediarySignoffDraft>().lines" :key="line.rootLineId">
                  <td>{{ lineName(line.rootLineId) }}</td>
                  <td>{{ vm.deliveredQuantity(line.rootLineId) }}</td>
                  <td><CompactTableField v-model="line.signedQuantity" :disabled="!vm.stageEditable" :rules="[(value) => isQuantity(value, true) || '签收数量格式不正确。']" /></td>
                  <td><CompactTableField v-model="line.rejectedQuantity" :disabled="!vm.stageEditable" :rules="[(value) => isQuantity(value, true) || '拒收数量格式不正确。']" /></td>
                  <td>{{ vm.signoffLoss(index) ?? '数量不守恒' }}</td>
                  <td><CompactTableField v-model="line.remark" :disabled="!vm.stageEditable" :maxlength="1000" /></td>
                </tr>
              </tbody>
            </v-table>
          </div>
          <div class="intermediary-workspace__form-grid mt-4">
            <v-text-field v-model.number="stageDraftAs<IntermediarySignoffDraft>().returnedSolventContainers" :disabled="!vm.stageEditable" label="本次实收溶剂桶" min="0" step="1" type="number" variant="outlined" />
            <v-text-field v-model.number="stageDraftAs<IntermediarySignoffDraft>().returnedResinContainers" :disabled="!vm.stageEditable" label="本次实收树脂桶" min="0" step="1" type="number" variant="outlined" />
            <v-textarea v-model="stageDraftAs<IntermediarySignoffDraft>().containerDifferenceReason" class="intermediary-workspace__wide" :disabled="!vm.stageEditable" label="空桶差异原因" counter="1000" variant="outlined" />
          </div>
          <v-alert type="info" variant="tonal">
            本次应收：溶剂桶 {{ vm.signoffExpectedContainers.solvent }}，树脂桶 {{ vm.signoffExpectedContainers.resin }}；
            确认后客户余额：溶剂桶 {{ vm.signoffBalanceAfter.solvent }}，树脂桶 {{ vm.signoffBalanceAfter.resin }}。
          </v-alert>
        </template>

        <v-textarea
          v-if="vm.stageDraft"
          v-model="vm.stageDraft.remark"
          class="mt-4"
          :disabled="!vm.stageEditable"
          label="子单备注"
          counter="1000"
          variant="outlined"
        />

        <VoucherAttachmentPanel
          v-if="vm.stageChild"
          class="mt-6"
          :attachments="vm.stageDetail?.attachments ?? []"
          :can-download="childAttachmentCan('Download')"
          :can-remove="childAttachmentCan('Remove')"
          :can-upload="childAttachmentCan('Initiate')"
          document-created
          :draft="vm.stageChild.status === 'DRAFT'"
          :error-message="vm.childAttachmentError"
          :loading="vm.childAttachmentLoading"
          @download="vm.downloadChildAttachment"
          @remove="vm.removeChildAttachment"
          @upload="vm.uploadChildAttachments"
        />
        <v-alert v-else class="mt-6" type="info" variant="tonal">
          请先保存子单草稿，再添加本阶段附件。
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="Boolean(vm.actionLoading) || vm.childAttachmentLoading" variant="text" @click="vm.closeStageDialog">关闭</v-btn>
        <v-btn
          v-if="vm.stageSaveVisible"
          color="primary"
          :disabled="!vm.canSaveStage()"
          :loading="Boolean(vm.actionLoading)"
          :title="vm.stageSaveBlockedReason ?? undefined"
          @click="saveStage"
        >
          保存草稿
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <WflReasonDialog
    v-model="vm.reverseDialogOpen"
    confirm-label="确认操作"
    :loading="Boolean(vm.actionLoading)"
    :reason="vm.reverseReason"
    title="填写操作原因"
    @confirm="vm.confirmReverse"
    @update:reason="vm.reverseReason = $event"
  />

  <WflReasonDialog
    v-model="vm.shortCloseDialogOpen"
    confirm-label="提交申请"
    :loading="vm.actionLoading === 'short-close-request'"
    :reason="vm.shortCloseReason"
    title="申请短结"
    warning="短结会保留尚未履约的数量，需要另一名用户确认。"
    @confirm="vm.requestShortClose"
    @update:reason="vm.shortCloseReason = $event"
  />
</template>

<style scoped>
.intermediary-trade__heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.intermediary-trade__heading h1 { margin: 2px 0 0; font-size: 28px; }
.intermediary-trade__eyebrow { color: rgb(var(--v-theme-primary)); font-size: 11px; font-weight: 700; letter-spacing: .12em; }
.intermediary-trade__filter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.intermediary-trade__filter-actions { display: flex; justify-content: flex-end; gap: 8px; }
.intermediary-trade__table-wrap { overflow-x: auto; }
.intermediary-trade__list { min-width: 1050px; }
.intermediary-workspace { background: rgb(var(--v-theme-background)); }
.intermediary-workspace__window { padding: 20px; overflow-y: auto; }
.intermediary-workspace__section-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.intermediary-workspace__section-title > div { display: flex; gap: 8px; flex-wrap: wrap; }
.intermediary-workspace__form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
.intermediary-workspace__wide { grid-column: 1 / -1; }
.intermediary-workspace__document-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.intermediary-workspace__document-meta div { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 8px; }
.intermediary-workspace__document-meta span { color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.intermediary-workspace__footer { padding: 12px 20px; border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.intermediary-workspace__balances { display: flex; gap: 14px; flex-wrap: wrap; }
@media (max-width: 900px) {
  .intermediary-trade__filter-grid, .intermediary-workspace__form-grid, .intermediary-workspace__document-meta { grid-template-columns: 1fr; }
  .intermediary-trade__heading { align-items: stretch; flex-direction: column; }
}
</style>
