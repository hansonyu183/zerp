<script setup lang="ts">
import { computed, reactive } from 'vue'
import {
  calculateDueDate,
  VoucherAttachmentPanel,
  VoucherAuditHistory,
  VoucherExecutionDialog,
  VoucherExpenseLinesEditor,
  VoucherLifecycleActions,
  VoucherList,
  VoucherProductLinesEditor,
  VoucherReferenceAutocomplete,
  VoucherWorkspace,
  type VoucherDraftForm,
  type VoucherReference,
} from '@/components/voucher'
import type { VoucherEntityViewModel } from './vm'

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

const workspaceTitle = computed(
  () => `${vm.documentView ? '查看' : '新建'}${vm.config.title}`,
)
const partyEnabled = computed(() => vm.config.partyMode !== 'none')
const partyLabel = computed(() => {
  if (vm.config.partyMode === 'customer') return '客户'
  if (vm.config.partyMode === 'supplier') return '供应商'
  return '往来方'
})

if (props.autoQuery) {
  void vm.query()
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
</script>

<template>
  <v-container v-if="showList" fluid class="voucher-page pa-4 pa-md-7">
    <div class="voucher-page__heading">
      <div>
        <div class="voucher-page__eyebrow">VOU · 业务单据</div>
        <h1>{{ vm.config.title }}</h1>
      </div>
    </div>
    <v-alert
      v-if="vm.errorMessage"
      class="mb-4"
      type="error"
      variant="tonal"
    >
      {{ vm.errorMessage }}
    </v-alert>
    <VoucherList
      :can-edit="vm.canEdit"
      :can-view="vm.canView"
      :creatable="vm.canCreate"
      :date-from="vm.filters.dateFrom"
      :date-to="vm.filters.dateTo"
      :keyword="vm.filters.keyword"
      :loading="vm.loading"
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
      @party-search="vm.searchReference('party', $event)"
      @query="vm.search"
      @reset="vm.resetFilters"
      @update:date-from="vm.filters.dateFrom = $event"
      @update:date-to="vm.filters.dateTo = $event"
      @update:keyword="vm.filters.keyword = $event"
      @update:page="vm.changePage"
      @update:party="vm.selectedParty = $event"
      @update:sort="vm.sort = $event"
      @update:statuses="vm.filters.status = $event"
      @view="vm.openDocument($event)"
    />
  </v-container>

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
      <div class="voucher-page__workspace-actions">
        <template v-if="vm.editing">
          <v-btn
            v-if="vm.documentView"
            :disabled="vm.saving"
            variant="text"
            @click="vm.cancelEditing"
          >
            取消编辑
          </v-btn>
          <v-btn
            color="primary"
            :loading="vm.saving"
            prepend-icon="mdi-content-save-outline"
            @click="vm.save"
          >
            {{ vm.documentView ? '保存草稿' : '创建草稿' }}
          </v-btn>
        </template>
        <v-btn
          v-else-if="vm.actionAvailability.save"
          color="primary"
          prepend-icon="mdi-pencil-outline"
          variant="tonal"
          @click="vm.startEditing"
        >
          编辑草稿
        </v-btn>
        <VoucherLifecycleActions
          v-if="vm.documentView && !vm.editing"
          :availability="vm.actionAvailability"
          :disabled="vm.busy || vm.dirty"
          :loading-action="vm.actionLoading"
          :status="vm.documentView.status"
          @action="vm.lifecycleAction"
        />
      </div>
    </template>

    <template #document>
      <v-card rounded="lg" variant="flat">
        <v-card-text>
          <div class="voucher-form__grid">
            <v-text-field
              v-model="vm.form.businessDate"
              :disabled="!vm.editing"
              label="业务日期"
              type="date"
              variant="outlined"
            />
            <v-text-field
              v-model="vm.form.currency"
              :disabled="!vm.editing || vm.config.usesFundAccount"
              label="币种"
              maxlength="3"
              variant="outlined"
              @update:model-value="vm.form.currency = ($event ?? '').toUpperCase()"
            />

            <VoucherReferenceAutocomplete
              v-if="vm.config.partyMode === 'customer' || vm.config.partyMode === 'dual'"
              :disabled="!vm.editing"
              v-bind="referenceProps('customer')"
              label="客户"
              :model-value="vm.form.customer"
              required
              @search="search('customer', $event)"
              @update:model-value="updateReference('customer', $event)"
            />
            <VoucherReferenceAutocomplete
              v-if="vm.config.partyMode === 'supplier' || vm.config.partyMode === 'dual'"
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
              :label="vm.form.counterpartyType === 'supplier' ? '供应商' : '客户'"
              :model-value="vm.form.counterparty"
              :required="vm.config.entity !== 'other-income'"
              @search="search('counterparty', $event)"
              @update:model-value="updateReference('counterparty', $event)"
            />

            <VoucherReferenceAutocomplete
              v-if="vm.config.usesSalesperson"
              :disabled="!vm.editing"
              v-bind="referenceProps('salesperson')"
              label="业务员（新建时可使用客户默认值）"
              :model-value="vm.form.salesperson"
              @search="search('salesperson', $event)"
              @update:model-value="updateReference('salesperson', $event)"
            />
            <VoucherReferenceAutocomplete
              v-if="vm.config.usesPurchaser"
              :disabled="!vm.editing"
              v-bind="referenceProps('purchaser')"
              label="采购员（新建时可使用供应商默认值）"
              :model-value="vm.form.purchaser"
              @search="search('purchaser', $event)"
              @update:model-value="updateReference('purchaser', $event)"
            />
            <VoucherReferenceAutocomplete
              v-if="vm.config.usesWarehouse"
              :disabled="!vm.editing"
              v-bind="referenceProps('warehouse')"
              label="仓库"
              :model-value="vm.form.warehouse"
              required
              @search="search('warehouse', $event)"
              @update:model-value="updateReference('warehouse', $event)"
            />
            <VoucherReferenceAutocomplete
              v-if="vm.config.usesEmployee"
              :disabled="!vm.editing"
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
              :disabled="!vm.editing"
              inputmode="decimal"
              label="金额"
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

          <v-divider class="my-5" />
          <VoucherProductLinesEditor
            v-if="vm.config.lineKind === 'product'"
            v-model="vm.form.productLines"
            :editable="vm.editing"
            :product-error="vm.referenceError('product')"
            :product-loading="vm.referenceLoading('product')"
            :product-options="vm.referenceOptions('product')"
            :purchase-price-required="vm.config.entity === 'intermediary-sale-order'"
            @product-search="vm.searchReference('product', $event)"
          />
          <VoucherExpenseLinesEditor
            v-if="vm.config.lineKind === 'expense'"
            v-model="vm.form.expenseLines"
            :editable="vm.editing"
          />

          <template v-if="vm.documentView">
            <v-divider class="my-5" />
            <h3>后端快照与执行结果</h3>
            <div class="voucher-form__snapshot-grid">
              <div><strong>金额</strong><span>{{ vm.documentView.amount }}</span></div>
              <div><strong>联系人</strong><span>{{ vm.documentView.data.contactName || '—' }}</span></div>
              <div><strong>联系电话</strong><span>{{ vm.documentView.data.contactPhone || '—' }}</span></div>
              <div><strong>送货地址</strong><span>{{ vm.documentView.data.deliveryAddress || '—' }}</span></div>
              <div v-if="vm.documentView.data.settlementMethod">
                <strong>结算方式</strong>
                <span>
                  {{ vm.documentView.data.settlementMethod.name }} · 到期
                  {{ calculateDueDate(vm.documentView.data.businessDate, vm.documentView.data.settlementMethod) }}
                </span>
              </div>
              <div v-if="vm.documentView.data.customerSettlementMethod">
                <strong>客户结算</strong>
                <span>
                  {{ vm.documentView.data.customerSettlementMethod.name }} · 到期
                  {{ calculateDueDate(vm.documentView.data.businessDate, vm.documentView.data.customerSettlementMethod) }}
                </span>
              </div>
              <div v-if="vm.documentView.data.supplierSettlementMethod">
                <strong>供应商结算</strong>
                <span>
                  {{ vm.documentView.data.supplierSettlementMethod.name }} · 到期
                  {{ calculateDueDate(vm.documentView.data.businessDate, vm.documentView.data.supplierSettlementMethod) }}
                </span>
              </div>
              <div v-if="vm.documentView.data.outboundDate">
                <strong>出库/签收</strong>
                <span>{{ vm.documentView.data.outboundDate }} / {{ vm.documentView.data.signoffDate }}</span>
              </div>
              <div v-if="vm.documentView.data.inboundDate">
                <strong>入库日期</strong><span>{{ vm.documentView.data.inboundDate }}</span>
              </div>
              <div v-if="vm.documentView.data.platform">
                <strong>物流平台/车辆</strong>
                <span>{{ vm.documentView.data.platform.name }} / {{ vm.documentView.data.vehicle?.plateNumber }}</span>
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
    :kind="vm.config.executionKind"
    :platform-loading="vm.referenceLoading('platform')"
    :platform-options="vm.referenceOptions('platform')"
    :saving="vm.actionLoading === 'execute'"
    :vehicle-loading="vm.referenceLoading('vehicle')"
    :vehicle-options="vm.referenceOptions('vehicle')"
    @platform-search="vm.searchReference('platform', $event)"
    @submit="vm.execute"
    @vehicle-search="vm.searchReference('vehicle', $event)"
  />
</template>

<style scoped>
.voucher-page__heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.voucher-page__heading h1 { margin: 2px 0 0; font-size: 28px; }
.voucher-page__eyebrow { color: rgb(var(--v-theme-primary)); font-size: 11px; font-weight: 700; letter-spacing: .12em; }
.voucher-page__workspace-actions { display: flex; align-items: center; gap: 8px; margin-right: 12px; }
.voucher-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 20px; }
.voucher-form__wide { grid-column: 1 / -1; }
.voucher-form__snapshot-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
.voucher-form__snapshot-grid div { display: flex; flex-direction: column; gap: 4px; padding: 12px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 8px; }
.voucher-form__snapshot-grid span { color: rgb(var(--v-theme-on-surface-variant)); }
@media (max-width: 800px) {
  .voucher-form__grid, .voucher-form__snapshot-grid { grid-template-columns: 1fr; }
  .voucher-form__wide { grid-column: auto; }
}
</style>
