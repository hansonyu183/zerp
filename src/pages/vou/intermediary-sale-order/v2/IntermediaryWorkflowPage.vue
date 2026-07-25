<script setup lang="ts">
import { reactive } from 'vue'
import {
  VoucherAttachmentPanel,
  VoucherReferenceAutocomplete,
  type VoucherListItem,
  type VoucherReference,
} from '@/components/voucher'
import type { IntermediaryAction } from './api'
import IntermediaryOrderLinesEditor from './IntermediaryOrderLinesEditor.vue'
import IntermediaryStageSection from './IntermediaryStageSection.vue'
import {
  useIntermediaryWorkflowViewModel,
  type IntermediaryWorkflowViewModel,
} from './vm'
import type {
  IntermediaryDeliveryDraft,
  IntermediaryListItem,
  IntermediaryProcurementDraft,
  IntermediaryReceiptDraft,
  IntermediarySignoffDraft,
  IntermediaryStage,
} from './types'

const props = defineProps<{ model?: IntermediaryWorkflowViewModel }>()
const emit = defineEmits<{ 'open-legacy': [row: VoucherListItem] }>()
const vm = reactive(props.model ?? useIntermediaryWorkflowViewModel())

const workflowStatuses: Record<string, string> = {
  DRAFT: '客户订单草稿',
  CHECKED: '客户订单已核对',
  APPROVED: '履约中',
  COMPLETED: '已完成',
  SHORT_CLOSE_REQUESTED: '待短结确认',
  SHORT_CLOSED: '已短结',
  REVIEWED: 'V1 已审核',
  EXECUTED: 'V1 已执行',
}

const stageNames: Record<string, string> = {
  ORDER: '客户订单',
  PROCUREMENT: '居间采购',
  RECEIPT: '收货',
  DELIVERY: '送货',
  SIGNOFF: '签收',
  SHORT_CLOSE: '短结',
}

const stepItems = [
  { value: 1, title: '客户订单', icon: 'mdi-cart-outline' },
  { value: 2, title: '居间采购', icon: 'mdi-file-sign' },
  { value: 3, title: '分批收货', icon: 'mdi-tray-arrow-down' },
  { value: 4, title: '分批送货', icon: 'mdi-truck-delivery-outline' },
  { value: 5, title: '客户签收', icon: 'mdi-clipboard-check-outline' },
  { value: 6, title: '主单附件', icon: 'mdi-paperclip' },
  { value: 7, title: '审计', icon: 'mdi-history' },
]

void vm.query()

function workflowText(status?: string): string {
  return status ? (workflowStatuses[status] ?? status) : '—'
}

function stageName(stage?: IntermediaryStage): string {
  return stage ? (stageNames[stage] ?? stage) : '主单'
}

function selectOrderReference(
  key: 'customer' | 'salesperson',
  value: VoucherReference | null,
): void {
  vm.orderDraft[key] = value
  vm.orderDirty = true
}

function openRow(row: IntermediaryListItem): void {
  if (vm.isLegacy(row)) {
    emit('open-legacy', vm.legacyRow(row))
  } else {
    void vm.openDocument(row)
  }
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

function stageCanSave(): boolean {
  const prefix = vm.stageEditing.toLowerCase()
  const action = `${prefix}${vm.stageChild ? 'Save' : 'Create'}` as IntermediaryAction
  return vm.stageEditable && vm.can(action)
}

function childAttachmentCan(
  operation: 'Initiate' | 'Download' | 'Remove',
): boolean {
  const prefix = vm.stageEditing.toLowerCase()
  return vm.can(`${prefix}Attachment${operation}` as IntermediaryAction)
}

function openShortClose(): void {
  vm.shortCloseReason = ''
  vm.shortCloseDialogOpen = true
}

function selectFilterCustomer(value: VoucherReference | null): void {
  vm.selectedParty = value
}
</script>

<template>
  <v-container fluid class="intermediary-v2 pa-4 pa-md-7">
    <div class="intermediary-v2__heading">
      <div>
        <div class="intermediary-v2__eyebrow">VOU · 居间订单</div>
        <h1>居间订单长流程</h1>
      </div>
      <v-btn
        v-if="vm.canCreate"
        color="primary"
        :disabled="vm.loading"
        prepend-icon="mdi-plus"
        @click="vm.openCreate"
      >
        新建 V2 客户订单
      </v-btn>
    </div>

    <v-alert v-if="vm.errorMessage" class="mb-4" type="error" variant="tonal">
      {{ vm.errorMessage }}
    </v-alert>

    <v-expansion-panels class="mb-4" variant="accordion">
      <v-expansion-panel>
        <v-expansion-panel-title>筛选条件</v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="intermediary-v2__filter-grid">
            <v-text-field
              v-model="vm.filters.keyword"
              clearable
              label="单号或往来方关键字"
              variant="outlined"
            />
            <VoucherReferenceAutocomplete
              clearable
              :error-message="vm.referenceError('filterCustomer')"
              label="客户"
              :loading="vm.referenceLoading('filterCustomer')"
              :model-value="vm.selectedParty"
              :options="vm.referenceOptions('filterCustomer')"
              @search="vm.searchReference('filterCustomer', $event)"
              @update:model-value="selectFilterCustomer"
            />
            <v-text-field v-model="vm.filters.dateFrom" label="业务日期起" type="date" variant="outlined" />
            <v-text-field v-model="vm.filters.dateTo" label="业务日期止" type="date" variant="outlined" />
          </div>
          <div class="intermediary-v2__filter-actions">
            <v-btn variant="text" @click="vm.resetFilters">重置</v-btn>
            <v-btn color="primary" :loading="vm.loading" @click="vm.search">查询</v-btn>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-card rounded="lg" variant="flat">
      <v-progress-linear v-if="vm.loading" indeterminate />
      <div class="intermediary-v2__table-wrap">
        <v-table class="intermediary-v2__list">
          <thead>
            <tr>
              <th>单据号</th><th>流程</th><th>业务日期</th><th>客户/供应商</th>
              <th>状态</th><th class="text-end">金额</th><th>更新时间</th><th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in vm.rows" :key="row.documentId">
              <td>{{ row.documentNo }}</td>
              <td><v-chip size="small" variant="tonal">V{{ row.workflowVersion ?? 1 }}</v-chip></td>
              <td>{{ row.businessDate }}</td>
              <td>{{ row.partyName || '—' }}</td>
              <td>{{ workflowText(row.workflowStatus || row.status) }}</td>
              <td class="text-end">{{ row.amount }} {{ row.currency }}</td>
              <td>{{ new Date(row.updatedAt).toLocaleString('zh-CN') }}</td>
              <td class="text-end">
                <v-btn
                  :aria-label="`打开 ${row.documentNo}`"
                  icon="mdi-open-in-new"
                  variant="text"
                  @click="openRow(row)"
                />
              </td>
            </tr>
            <tr v-if="!vm.loading && vm.rows.length === 0">
              <td colspan="8" class="text-center py-12">暂无居间订单</td>
            </tr>
          </tbody>
        </v-table>
      </div>
      <v-card-actions class="justify-end">
        <span class="text-caption">共 {{ vm.total }} 条，第 {{ vm.page }} 页</span>
        <v-btn :disabled="vm.page <= 1 || vm.loading" icon="mdi-chevron-left" variant="text" @click="vm.changePage(vm.page - 1)" />
        <v-btn :disabled="vm.page * vm.pageSize >= vm.total || vm.loading" icon="mdi-chevron-right" variant="text" @click="vm.changePage(vm.page + 1)" />
      </v-card-actions>
    </v-card>
  </v-container>

  <v-dialog v-model="vm.workspaceOpen" fullscreen persistent>
    <v-card class="intermediary-workspace">
      <v-toolbar color="surface">
        <v-btn
          icon="mdi-close"
          :disabled="Boolean(vm.actionLoading) || vm.rootAttachmentLoading || vm.childAttachmentLoading"
          @click="vm.closeWorkspace"
        />
        <v-toolbar-title>{{ vm.document?.documentNo ?? '新建居间客户订单' }}</v-toolbar-title>
        <v-chip v-if="vm.document" class="mr-4" color="primary" variant="tonal">
          {{ workflowText(vm.document.workflowStatus) }} · r{{ vm.document.rootRevision }}
        </v-chip>
        <v-btn v-if="vm.document" icon="mdi-refresh" :loading="vm.workspaceLoading" @click="vm.loadDocument()" />
      </v-toolbar>

      <v-alert v-if="vm.workspaceError" class="ma-4 mb-0" closable type="error" variant="tonal" @click:close="vm.workspaceError = null">
        {{ vm.workspaceError }}
      </v-alert>
      <v-progress-linear v-if="vm.workspaceLoading" indeterminate />

      <v-tabs v-model="vm.activeStep" color="primary" show-arrows>
        <v-tab v-for="step in stepItems" :key="step.value" :value="step.value" :prepend-icon="step.icon">
          {{ step.title }}
        </v-tab>
      </v-tabs>

      <v-window v-model="vm.activeStep" class="intermediary-workspace__window">
        <v-window-item :value="1">
          <v-card rounded="lg" variant="flat">
            <v-card-title class="intermediary-workspace__section-title">
              <span>客户订单</span>
              <div>
                <template v-if="vm.orderEditing">
                  <v-btn v-if="vm.document" :disabled="Boolean(vm.actionLoading)" variant="text" @click="vm.cancelOrderEditing">取消</v-btn>
                  <v-btn color="primary" :loading="vm.actionLoading === 'save'" @click="vm.saveOrder">
                    {{ vm.document ? '保存草稿' : '创建草稿' }}
                  </v-btn>
                </template>
                <template v-else-if="vm.document">
                  <v-btn v-if="vm.document.workflowStatus === 'DRAFT' && vm.can('save')" variant="tonal" @click="vm.startOrderEditing">编辑</v-btn>
                  <v-btn v-if="vm.document.workflowStatus === 'DRAFT' && vm.can('check')" color="primary" @click="vm.runRootAction('check')">核对</v-btn>
                  <v-btn v-if="vm.document.workflowStatus === 'CHECKED' && vm.can('uncheck')" variant="text" @click="vm.openReverse('uncheck')">反核对</v-btn>
                  <v-btn
                    v-if="vm.document.workflowStatus === 'CHECKED' && vm.can('approve')"
                    color="primary"
                    :disabled="!vm.canFinalize('approve', vm.document.checkedBy)"
                    :title="vm.document.checkedBy === vm.currentUserId ? '批准人与核对人不能是同一用户' : undefined"
                    @click="vm.runRootAction('approve')"
                  >
                    批准
                  </v-btn>
                  <v-btn v-if="vm.document.workflowStatus === 'APPROVED' && vm.can('unapprove')" variant="text" @click="vm.openReverse('unapprove')">反批准</v-btn>
                </template>
              </div>
            </v-card-title>
            <v-card-text>
              <div class="intermediary-workspace__form-grid">
                <v-text-field v-model="vm.orderDraft.businessDate" :disabled="!vm.orderEditing" label="订购日期" type="date" variant="outlined" @update:model-value="vm.orderDirty = true" />
                <v-text-field v-model="vm.orderDraft.currency" :disabled="!vm.orderEditing" label="币种" maxlength="3" variant="outlined" @update:model-value="vm.orderDraft.currency = ($event ?? '').toUpperCase(); vm.orderDirty = true" />
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
          <v-alert v-if="!vm.can('procurementGet')" class="mb-4" type="info" variant="tonal">
            当前账号没有采购详情权限，供应商、采购价格和采购数量已由后端脱敏。
          </v-alert>
          <IntermediaryStageSection
            stage="procurement"
            title="居间采购"
            :items="vm.procurement ? [vm.procurement] : []"
            :can-create="Boolean(vm.document?.workflowStatus === 'APPROVED' && !vm.procurement && vm.can('procurementCreate'))"
            :can-action="vm.can"
            :current-user-id="vm.currentUserId"
            @create="vm.openStage('PROCUREMENT')"
            @open="vm.openStage('PROCUREMENT', $event)"
            @action="vm.runChildAction"
            @reverse="vm.openReverse"
          />
        </v-window-item>

        <v-window-item :value="3">
          <IntermediaryStageSection
            stage="receipt"
            title="分批收货"
            :items="vm.receipts"
            :can-create="vm.canCreateReceipt && vm.can('receiptCreate')"
            :can-action="vm.can"
            :current-user-id="vm.currentUserId"
            @create="vm.openStage('RECEIPT')"
            @open="vm.openStage('RECEIPT', $event)"
            @action="vm.runChildAction"
            @reverse="vm.openReverse"
          />
        </v-window-item>

        <v-window-item :value="4">
          <IntermediaryStageSection
            stage="delivery"
            title="分批送货"
            :items="vm.deliveries"
            :can-create="vm.canCreateDelivery && vm.can('deliveryCreate')"
            :can-action="vm.can"
            :current-user-id="vm.currentUserId"
            @create="vm.openStage('DELIVERY')"
            @open="vm.openStage('DELIVERY', $event)"
            @action="vm.runChildAction"
            @reverse="vm.openReverse"
            @create-signoff="vm.openStage('SIGNOFF', undefined, $event)"
          />
        </v-window-item>

        <v-window-item :value="5">
          <IntermediaryStageSection
            stage="signoff"
            title="客户签收"
            :items="vm.signoffs"
            :can-create="false"
            :can-action="vm.can"
            :current-user-id="vm.currentUserId"
            @open="vm.openStage('SIGNOFF', $event)"
            @action="vm.runChildAction"
            @reverse="vm.openReverse"
          />
        </v-window-item>

        <v-window-item :value="6">
          <v-card rounded="lg" variant="flat">
            <v-card-text>
              <VoucherAttachmentPanel
                :attachments="vm.document?.attachments ?? []"
                :can-download="vm.can('attachmentDownload')"
                :can-remove="vm.can('attachmentRemove')"
                :can-upload="vm.can('attachmentInitiate')"
                :document-created="Boolean(vm.document)"
                :draft="vm.document?.workflowStatus === 'DRAFT'"
                :error-message="vm.rootAttachmentError"
                :loading="vm.rootAttachmentLoading"
                @download="vm.downloadRootAttachment"
                @remove="vm.removeRootAttachment"
                @upload="vm.uploadRootAttachments"
              />
            </v-card-text>
          </v-card>
        </v-window-item>

        <v-window-item :value="7">
          <v-card rounded="lg" variant="flat">
            <v-card-title class="intermediary-workspace__section-title">
              <span>统一审计历史</span>
              <v-btn :disabled="!vm.document || !vm.can('auditHistory')" prepend-icon="mdi-refresh" variant="text" @click="vm.loadAudit(1)">加载审计</v-btn>
            </v-card-title>
            <v-card-text>
              <v-alert v-if="vm.auditError" type="error" variant="tonal">{{ vm.auditError }}</v-alert>
              <v-progress-linear v-if="vm.auditLoading" indeterminate />
              <v-timeline v-if="vm.auditEvents.length" density="compact" side="end">
                <v-timeline-item v-for="event in vm.auditEvents" :key="event.id" dot-color="primary" size="small">
                  <div><strong>{{ stageName(event.stage) }} · {{ event.eventType }}</strong></div>
                  <div class="text-body-2">{{ event.childNo || vm.document?.documentNo }} · {{ event.actorId }} · {{ new Date(event.occurredAt).toLocaleString('zh-CN') }}</div>
                  <div v-if="event.reason" class="text-body-2">原因：{{ event.reason }}</div>
                  <div class="text-caption">请求编号：{{ event.requestId }}</div>
                </v-timeline-item>
              </v-timeline>
              <div v-else-if="!vm.auditLoading" class="text-center text-medium-emphasis py-10">暂无审计记录</div>
              <v-pagination
                v-if="vm.auditTotal > vm.auditPageSize"
                class="mt-4"
                :length="Math.ceil(vm.auditTotal / vm.auditPageSize)"
                :model-value="vm.auditPage"
                @update:model-value="vm.loadAudit"
              />
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
          v-if="vm.document.workflowStatus === 'APPROVED' && vm.can('shortCloseRequest')"
          color="warning"
          prepend-icon="mdi-archive-arrow-down-outline"
          variant="tonal"
          @click="openShortClose"
        >
          申请短结
        </v-btn>
        <v-btn
          v-if="vm.document.workflowStatus === 'SHORT_CLOSE_REQUESTED' && vm.can('shortCloseCancel')"
          variant="text"
          @click="vm.openReverse('shortCloseCancel')"
        >
          撤销短结申请
        </v-btn>
        <v-btn
          v-if="vm.document.workflowStatus === 'SHORT_CLOSE_REQUESTED' && vm.can('shortCloseConfirm')"
          color="warning"
          @click="vm.runRootAction('shortCloseConfirm')"
        >
          确认短结
        </v-btn>
        <v-btn
          v-if="vm.document.workflowStatus === 'SHORT_CLOSED' && vm.can('shortCloseUnconfirm')"
          variant="text"
          @click="vm.openReverse('shortCloseUnconfirm')"
        >
          反确认短结
        </v-btn>
      </v-footer>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.stageDialogOpen" max-width="1180" persistent scrollable>
    <v-card>
      <v-card-title>{{ stageTitle() }}</v-card-title>
      <v-card-text>
        <v-alert v-if="vm.stageDialogError" class="mb-4" type="error" variant="tonal">{{ vm.stageDialogError }}</v-alert>

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
          <div class="intermediary-v2__table-wrap">
            <v-table>
              <thead><tr><th>产品</th><th>客户订购量</th><th>采购数量</th><th>采购含税单价</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="line in stageDraftAs<IntermediaryProcurementDraft>().lines" :key="line.rootLineId">
                  <td>{{ lineName(line.rootLineId) }}</td>
                  <td>{{ vm.document?.productLines.find((item) => item.lineId === line.rootLineId)?.orderedQuantity }}</td>
                  <td><v-text-field v-model="line.quantity" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
                  <td><v-text-field v-model="line.unitPrice" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
                  <td><v-text-field v-model="line.remark" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </template>

        <template v-else-if="vm.stageEditing === 'RECEIPT' && vm.stageDraft">
          <v-text-field v-model="stageDraftAs<IntermediaryReceiptDraft>().receiptDate" :disabled="!vm.stageEditable" label="收货日期" type="date" variant="outlined" />
          <div class="intermediary-v2__table-wrap">
            <v-table>
              <thead><tr><th>产品</th><th>本次实收数量</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="line in stageDraftAs<IntermediaryReceiptDraft>().lines" :key="line.rootLineId">
                  <td>{{ lineName(line.rootLineId) }}</td>
                  <td><v-text-field v-model="line.quantity" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
                  <td><v-text-field v-model="line.remark" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
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
          <div class="intermediary-v2__table-wrap">
            <v-table>
              <thead><tr><th>产品</th><th>当前可送</th><th>本次送货</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="line in stageDraftAs<IntermediaryDeliveryDraft>().lines" :key="line.rootLineId">
                  <td>{{ lineName(line.rootLineId) }}</td>
                  <td>{{ vm.document?.balances.lines.find((item) => item.rootLineId === line.rootLineId)?.availableToDeliverQuantity }}</td>
                  <td><v-text-field v-model="line.quantity" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
                  <td><v-text-field v-model="line.remark" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
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
          <div class="intermediary-v2__table-wrap">
            <v-table>
              <thead><tr><th>产品</th><th>送货数</th><th>签收数</th><th>拒收数</th><th>损耗数（自动）</th><th>备注</th></tr></thead>
              <tbody>
                <tr v-for="(line, index) in stageDraftAs<IntermediarySignoffDraft>().lines" :key="line.rootLineId">
                  <td>{{ lineName(line.rootLineId) }}</td>
                  <td>{{ vm.deliveredQuantity(line.rootLineId) }}</td>
                  <td><v-text-field v-model="line.signedQuantity" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
                  <td><v-text-field v-model="line.rejectedQuantity" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
                  <td>{{ vm.signoffLoss(index) ?? '数量不守恒' }}</td>
                  <td><v-text-field v-model="line.remark" :disabled="!vm.stageEditable" density="compact" hide-details="auto" variant="outlined" /></td>
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
        <v-btn v-if="stageCanSave()" color="primary" :loading="Boolean(vm.actionLoading)" @click="vm.saveStage">保存草稿</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.reverseDialogOpen" max-width="520" persistent>
    <v-card title="确认操作">
      <v-card-text>
        <v-textarea v-model="vm.reverseReason" label="原因" counter="1000" variant="outlined" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.reverseDialogOpen = false">取消</v-btn>
        <v-btn color="error" :loading="Boolean(vm.actionLoading)" @click="vm.confirmReverse">确认</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.shortCloseDialogOpen" max-width="560" persistent>
    <v-card title="申请短结">
      <v-card-text>
        <v-alert class="mb-4" type="warning" variant="tonal">
          短结会保留尚未履约的数量，需要另一名用户确认。
        </v-alert>
        <v-textarea v-model="vm.shortCloseReason" label="短结原因" counter="1000" variant="outlined" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.shortCloseDialogOpen = false">取消</v-btn>
        <v-btn color="warning" :loading="vm.actionLoading === 'shortCloseRequest'" @click="vm.requestShortClose">提交申请</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.intermediary-v2__heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.intermediary-v2__heading h1 { margin: 2px 0 0; font-size: 28px; }
.intermediary-v2__eyebrow { color: rgb(var(--v-theme-primary)); font-size: 11px; font-weight: 700; letter-spacing: .12em; }
.intermediary-v2__filter-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.intermediary-v2__filter-actions { display: flex; justify-content: flex-end; gap: 8px; }
.intermediary-v2__table-wrap { overflow-x: auto; }
.intermediary-v2__list { min-width: 1050px; }
.intermediary-workspace { background: rgb(var(--v-theme-background)); }
.intermediary-workspace__window { padding: 20px; overflow-y: auto; }
.intermediary-workspace__section-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.intermediary-workspace__section-title > div { display: flex; gap: 8px; flex-wrap: wrap; }
.intermediary-workspace__form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 18px; }
.intermediary-workspace__wide { grid-column: 1 / -1; }
.intermediary-workspace__footer { padding: 12px 20px; border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.intermediary-workspace__balances { display: flex; gap: 14px; flex-wrap: wrap; }
@media (max-width: 900px) {
  .intermediary-v2__filter-grid, .intermediary-workspace__form-grid { grid-template-columns: 1fr; }
  .intermediary-v2__heading { align-items: stretch; flex-direction: column; }
}
</style>
