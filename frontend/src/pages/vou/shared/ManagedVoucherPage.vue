<script setup lang="ts">
import { computed, reactive } from 'vue'
import { useRoute } from 'vue-router'
import {
  VoucherAttachmentPanel,
  VoucherAuditHistory,
  VoucherDocumentHeader,
  VoucherList,
  VoucherWorkspace,
  type VoucherEntity,
  type VoucherManagedLineView,
  type VoucherReferenceView,
} from '@/components/voucher'
import { formatMediumDateTime } from '@/utils/date'
import { voucherEntityConfigs, voucherStatusText } from './config'
import { useVoucherEntityViewModel } from './vm'

defineOptions({ name: 'ManagedVoucherPage' })

const route = useRoute()
const entity = route.path.split('/')[2] as VoucherEntity
const config = voucherEntityConfigs[entity]
if (!config?.managedByWorkflow) {
  throw new Error(`未注册的流程单据页面：${entity}`)
}
const vm = reactive(useVoucherEntityViewModel(config))
void vm.query()

const workflowTitle = computed(() => {
  if (config.managedByWorkflow === 'sales-fulfillment') return '销售履约'
  if (config.managedByWorkflow === 'purchase-fulfillment') return '采购履约'
  return '居间贸易'
})
const document = computed(() => vm.documentView)
const data = computed(() => document.value?.data)
const lines = computed(() => data.value?.lines ?? data.value?.productLines ?? data.value?.signoffLines ?? [])

function changeSort(value: typeof vm.sort): void {
  vm.sort = value
  void vm.search()
}

function referenceText(value?: VoucherReferenceView): string {
  return value ? `${value.code} · ${value.name}` : '—'
}

function quantityText(line: VoucherManagedLineView): string {
  return line.orderedQuantity || line.quantity || '—'
}
</script>

<template>
  <v-container fluid class="managed-voucher-page pa-4 pa-md-7">
    <v-alert class="mb-4" type="info" variant="tonal">
      此类单据由{{ workflowTitle }}流程维护，独立页面仅供查询和查看。
    </v-alert>
    <v-alert v-if="vm.errorMessage" class="mb-4" type="error" variant="tonal">
      {{ vm.errorMessage }}
    </v-alert>
    <VoucherList
      :can-edit="vm.canEdit"
      :can-view="vm.canView"
      :creatable="false"
      :date-from="vm.filters.dateFrom"
      :date-to="vm.filters.dateTo"
      :keyword="vm.filters.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :party="vm.selectedParty"
      :party-enabled="config.partyMode !== 'none'"
      :party-label="config.partyMode === 'supplier' ? '供应商' : '客户'"
      :party-error="vm.referenceError('party')"
      :party-loading="vm.referenceLoading('party')"
      :party-options="vm.referenceOptions('party')"
      :queryable="vm.canQuery"
      :rows="vm.rows"
      :sort="vm.sort"
      :statuses="vm.filters.status"
      :total="vm.total"
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

  <VoucherWorkspace
    v-model="vm.workspaceOpen"
    :busy="vm.busy"
    :can-reload="Boolean(document)"
    :document="document"
    :error-message="vm.workspaceError"
    :title="`查看${config.title}`"
    @close="vm.closeWorkspace"
    @reload="vm.reloadDocument"
  >
    <template #document>
      <v-alert class="mb-5" type="info" variant="tonal">
        此单据由{{ workflowTitle }}流程维护；新建、编辑和流转请在业务流程中完成。
      </v-alert>
      <v-card v-if="document" rounded="lg" variant="flat">
        <v-card-text>
          <VoucherDocumentHeader
            :document-no="document.documentNo"
            :entity-label="config.title"
            :revision="document.revision"
            :status="document.status"
            :status-label="voucherStatusText[document.status]"
          />
          <v-divider class="my-5" />
          <div class="managed-voucher-page__facts">
            <div><span>业务日期</span><strong>{{ data?.businessDate || '—' }}</strong></div>
            <div><span>币种</span><strong>{{ data?.currency || '—' }}</strong></div>
            <div><span>金额</span><strong>{{ document.amount }}</strong></div>
            <div v-if="document.sourceDocumentNo">
              <span>来源单据</span><strong>{{ document.sourceDocumentNo }}</strong>
            </div>
            <div v-if="data?.customer"><span>客户</span><strong>{{ referenceText(data.customer) }}</strong></div>
            <div v-if="data?.supplier"><span>供应商</span><strong>{{ referenceText(data.supplier) }}</strong></div>
            <div v-if="data?.salesperson"><span>业务员</span><strong>{{ referenceText(data.salesperson) }}</strong></div>
            <div v-if="data?.purchaser"><span>采购员</span><strong>{{ referenceText(data.purchaser) }}</strong></div>
            <div v-if="data?.warehouse"><span>仓库</span><strong>{{ referenceText(data.warehouse) }}</strong></div>
            <div v-if="data?.platform"><span>物流平台</span><strong>{{ referenceText(data.platform) }}</strong></div>
            <div v-if="data?.vehicle"><span>车辆</span><strong>{{ referenceText(data.vehicle) }}</strong></div>
            <div><span>创建时间</span><strong>{{ formatMediumDateTime(document.createdAt) }}</strong></div>
            <div><span>更新时间</span><strong>{{ formatMediumDateTime(document.updatedAt) }}</strong></div>
          </div>
          <div v-if="data?.remark" class="mt-5">
            <div class="text-caption text-medium-emphasis mb-1">备注</div>
            <div class="managed-voucher-page__remark">{{ data.remark }}</div>
          </div>

          <v-divider v-if="lines.length" class="my-5" />
          <div v-if="lines.length" class="managed-voucher-page__table-wrap">
            <v-table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>产品</th>
                  <th class="text-end">数量</th>
                  <th class="text-end">签收</th>
                  <th class="text-end">拒收</th>
                  <th class="text-end">损耗</th>
                  <th class="text-end">单价</th>
                  <th class="text-end">金额</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(line, index) in lines" :key="line.lineId">
                  <td>{{ line.lineNo ?? index + 1 }}</td>
                  <td>{{ referenceText(line.product) }}</td>
                  <td class="text-end">{{ quantityText(line) }}</td>
                  <td class="text-end">{{ line.signedQuantity || '—' }}</td>
                  <td class="text-end">{{ line.rejectedQuantity || '—' }}</td>
                  <td class="text-end">{{ line.lossQuantity || '—' }}</td>
                  <td class="text-end">{{ line.unitPrice || '—' }}</td>
                  <td class="text-end">{{ line.lineAmount || '—' }}</td>
                  <td>{{ line.remark || '—' }}</td>
                </tr>
              </tbody>
            </v-table>
          </div>
        </v-card-text>
      </v-card>
    </template>

    <template #attachments>
      <VoucherAttachmentPanel
        :attachments="document?.attachments ?? []"
        :can-download="vm.actionAvailability.attachmentDownload"
        :document-created="Boolean(document)"
        :error-message="vm.attachmentError"
        :loading="vm.attachmentLoading"
        @download="vm.downloadAttachment"
      />
    </template>

    <template #audit>
      <VoucherAuditHistory
        v-if="vm.actionAvailability.audit"
        :error-message="vm.auditError"
        :events="vm.auditEvents"
        :loading="vm.auditLoading"
        :page="vm.auditPage"
        :page-size="vm.auditPageSize"
        :total="vm.auditTotal"
        @reload="vm.loadAudit(vm.auditPage)"
        @update:page="vm.loadAudit"
      />
      <v-empty-state
        v-else
        icon="mdi-lock-outline"
        text="当前账号没有查看此单据审计记录的权限"
        title="审计不可用"
      />
    </template>
  </VoucherWorkspace>
</template>

<style scoped>
.managed-voucher-page__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.managed-voucher-page__facts div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}
.managed-voucher-page__facts span { color: rgb(var(--v-theme-on-surface-variant)); font-size: 12px; }
.managed-voucher-page__remark { white-space: pre-wrap; }
.managed-voucher-page__table-wrap { overflow-x: auto; }
@media (max-width: 800px) {
  .managed-voucher-page__facts { grid-template-columns: 1fr; }
}
</style>
