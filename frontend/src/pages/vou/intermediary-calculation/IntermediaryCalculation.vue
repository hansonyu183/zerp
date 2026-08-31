<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import {
  VoucherAttachmentPanel,
  VoucherAuditHistory,
  VoucherDocumentHeader,
  VoucherList,
  VoucherWorkspace,
  type VoucherLifecycleAction,
  type VoucherListItem,
} from '@/components/voucher'
import { formatReferenceLabel } from '@/utils/reference-label'
import { formatBillType } from '@/utils/bill-type'
import VoucherReasonDialog from '../shared/VoucherReasonDialog.vue'
import VoucherWorkspaceActions from '../shared/VoucherWorkspaceActions.vue'
import {
  approvalActionPresentation,
  approvalStatusLabel,
} from '@/shared/approval'
import { useIntermediaryCalculationViewModel } from './vm'

defineOptions({ name: 'IntermediaryCalculation' })

const model = useIntermediaryCalculationViewModel()
const vm = reactive(model)
const route = useRoute()
const router = useRouter()
const detailOpen = ref(false)
const secondaryOpen = ref(false)
const secondaryReason = ref('')
const listLifecycleTarget = ref<VoucherListItem | null>(null)
const listLifecycleAction =
  ref<Extract<VoucherLifecycleAction, 'reject' | 'unapprove'>>('reject')
const listLifecycleReason = ref('')
const payeeEntityLabels: Readonly<Record<string, string>> = {
  customer: '客户',
  employee: '员工',
  'other-unit': '居间商',
  'sales-partner': '销售合作方',
}

function payeeEntityLabel(entity: string): string {
  return payeeEntityLabels[entity] ?? entity
}

void vm.query()

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

async function saveDocument(): Promise<void> {
  if (await vm.save()) return
  await nextTick()
  document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

function changeSort(value: typeof vm.sort): void {
  vm.sort = value
  vm.search()
}

function requestListLifecycleAction(
  row: VoucherListItem,
  action: VoucherLifecycleAction,
): void {
  if (approvalActionPresentation[action].reasonRequired) {
    listLifecycleTarget.value = row
    listLifecycleAction.value = action as Extract<
      VoucherLifecycleAction,
      'reject' | 'unapprove'
    >
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

async function confirmDelete(): Promise<void> {
  const reason = secondaryReason.value.trim()
  if (!reason) return
  secondaryOpen.value = false
  await vm.secondaryAction('delete', reason)
}
</script>

<template>
  <v-container fluid class="intermediary-page pa-4 pa-md-7">
    <AppSnackbar
      diagnostics
      :message="vm.errorMessage"
      @dismiss="vm.errorMessage = null"
    />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />

    <div class="intermediary-page__toolbar">
      <v-btn
        v-if="vm.canReadScript"
        prepend-icon="mdi-code-braces"
        variant="tonal"
        @click="vm.openScript"
      >
        计算脚本
      </v-btn>
    </div>

    <VoucherList
      :action-loading="vm.actionLoading"
      :can-edit="vm.canEdit"
      :can-view="vm.canView"
      :creatable="vm.canCreate"
      :date-from="vm.filters.dateFrom"
      :date-to="vm.filters.dateTo"
      :keyword="vm.filters.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :party="null"
      :queryable="vm.canQuery"
      :rows="vm.rows"
      search-label="居间计算单号"
      :sort="vm.sort"
      :statuses="vm.filters.status"
      :total="vm.total"
      @create="vm.openCreate"
      @edit="vm.openDocument($event, true)"
      @lifecycle="requestListLifecycleAction"
      @query="vm.search"
      @reset="vm.resetFilters"
      @update:date-from="vm.filters.dateFrom = $event"
      @update:date-to="vm.filters.dateTo = $event"
      @update:keyword="vm.filters.keyword = $event"
      @update:page="vm.changePage"
      @update:sort="changeSort"
      @update:statuses="vm.filters.status = $event"
      @view="vm.openDocument($event)"
    />
  </v-container>

  <VoucherReasonDialog
    :model-value="Boolean(listLifecycleTarget)"
    :confirm-label="`确认${approvalActionPresentation[listLifecycleAction].label}`"
    :loading="
      vm.actionLoading ===
      `${listLifecycleAction}:${listLifecycleTarget?.documentId}`
    "
    :reason="listLifecycleReason"
    :title="approvalActionPresentation[listLifecycleAction].label"
    @confirm="confirmListLifecycleAction"
    @update:model-value="
      (value) => {
        if (!value) listLifecycleTarget = null
      }
    "
    @update:reason="listLifecycleReason = $event"
  />

  <VoucherReasonDialog
    v-model="secondaryOpen"
    confirm-label="确认删除"
    :reason="secondaryReason"
    title="删除草稿"
    @confirm="confirmDelete"
    @update:reason="secondaryReason = $event"
  />

  <VoucherWorkspace
    v-model="vm.workspaceOpen"
    :busy="vm.busy || vm.calculating"
    :can-reload="Boolean(vm.documentView)"
    :dirty="vm.dirty"
    :document="vm.documentView"
    :editing="vm.editing"
    :error-message="vm.workspaceError"
    :success-message="vm.successMessage"
    :title="`${vm.documentView ? '查看' : '新增'}居间计算单`"
    @close="vm.closeWorkspace"
    @reload="vm.reloadDocument"
  >
    <template #actions>
      <VoucherWorkspaceActions
        :model="model"
        @save="saveDocument"
        @secondary="
          (_action, _title) => {
            secondaryReason = ''
            secondaryOpen = true
          }
        "
      />
    </template>

    <template #document>
      <v-card rounded="lg" variant="flat">
        <v-card-text>
          <VoucherDocumentHeader
            v-if="vm.documentView"
            :document-no="vm.documentView.documentNo"
            entity-label="居间计算单"
            :revision="vm.documentView.approval.revision"
            :status="vm.documentView.approval.status"
            :status-label="approvalStatusLabel(vm.documentView.approval.status)"
          />
          <v-divider v-if="vm.documentView" class="my-5" />

          <div class="intermediary-form__grid">
            <v-text-field
              :disabled="!vm.editing"
              label="汇总期间（月末）"
              :model-value="vm.form.businessDate"
              type="date"
              variant="outlined"
              @update:model-value="vm.changeBusinessDate($event ?? '')"
            />
            <v-text-field
              label="应付合计"
              :model-value="vm.calculation ? vm.summaryTotal : '尚未计算'"
              readonly
              suffix="元"
              variant="outlined"
            />
            <v-text-field
              label="计算脚本"
              :model-value="
                vm.calculation
                  ? `${vm.calculation.script.name} · R${vm.calculation.script.revision}`
                  : '尚未计算'
              "
              readonly
              variant="outlined"
            />
            <v-textarea
              v-model="vm.form.remark"
              class="intermediary-form__wide"
              counter="1000"
              :disabled="!vm.editing"
              label="备注"
              variant="outlined"
            />
          </div>

          <div v-if="vm.editing" class="intermediary-form__calculate">
            <v-alert type="info" variant="tonal">
              计算会重新读取期间来源与当前脚本；保存时固定计算稿、脚本和结果，后续脚本修改不影响已保存单据。
            </v-alert>
            <v-btn
              color="primary"
              :disabled="!vm.canCalculate"
              :loading="vm.calculating"
              prepend-icon="mdi-calculator-variant-outline"
              @click="vm.calculate"
            >
              {{ vm.calculation ? '重新计算' : '执行计算' }}
            </v-btn>
          </div>

          <v-alert
            v-if="!vm.calculation"
            class="mt-5"
            type="warning"
            variant="tonal"
          >
            尚未生成计算稿，单据不能保存。
          </v-alert>

          <template v-else>
            <div class="intermediary-form__section-title">
              <div>
                <h3>期间应付汇总</h3>
                <span>
                  {{ vm.calculation.source.periodStart }} 至
                  {{ vm.calculation.source.periodEnd }} ·
                  {{ vm.calculation.result.summaries.length }} 个对象
                </span>
              </div>
              <v-btn
                prepend-icon="mdi-table-eye"
                variant="tonal"
                @click="detailOpen = true"
              >
                详情
              </v-btn>
            </div>
            <div class="responsive-table-wrap">
              <v-table class="responsive-table">
                <thead>
                  <tr>
                    <th>对象类型</th>
                    <th>编码</th>
                    <th>员工/居间商/客户</th>
                    <th>应付类别</th>
                    <th class="text-end">期间金额</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in vm.calculation.result.summaries"
                    :key="`${item.category}:${item.payee.entity}:${item.payee.objectId}`"
                  >
                    <td data-label="对象类型">
                      {{ payeeEntityLabel(item.payee.entity) }}
                    </td>
                    <td data-label="编码">{{ item.payee.code }}</td>
                    <td data-label="员工/居间商/客户">{{ item.payee.name }}</td>
                    <td data-label="应付类别">
                      {{ vm.categoryLabel(item.category) }}
                    </td>
                    <td class="text-end" data-label="期间金额">
                      {{ item.amount }}
                    </td>
                  </tr>
                  <tr
                    v-if="vm.calculation.result.summaries.length === 0"
                    class="responsive-table__empty-row"
                  >
                    <td class="text-center" colspan="5">本期无应付汇总</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="4" data-label="">合计</td>
                    <td class="text-end" data-label="期间金额">
                      {{ vm.summaryTotal }}
                    </td>
                  </tr>
                </tfoot>
              </v-table>
            </div>
          </template>
        </v-card-text>
      </v-card>
    </template>

    <template #attachments>
      <VoucherAttachmentPanel
        :attachments="vm.documentView?.attachments ?? []"
        :can-download="vm.actionAvailability.attachmentDownload"
        :can-remove="vm.actionAvailability.attachmentRemove"
        :can-upload="vm.actionAvailability.attachmentInitiate"
        :document-created="Boolean(vm.documentView)"
        :draft="vm.documentView?.approval.status === 'DRAFT'"
        :error-message="vm.attachmentError"
        :loading="vm.attachmentLoading"
        @download="vm.downloadAttachment"
        @remove="vm.removeAttachment"
        @upload="vm.uploadAttachments"
      />
    </template>

    <template #audit>
      <VoucherAuditHistory
        :error-message="vm.auditError"
        :events="vm.auditEvents"
        :loading="vm.auditLoading"
        :page="vm.auditPage"
        :page-size="vm.auditPageSize"
        :total="vm.auditTotal"
        @reload="vm.loadAudit(vm.auditPage)"
        @update:page="vm.loadAudit"
      />
    </template>
  </VoucherWorkspace>

  <v-dialog v-model="detailOpen" fullscreen>
    <v-card v-if="vm.calculationInput()" class="intermediary-detail">
      <v-toolbar color="surface">
        <v-btn
          aria-label="关闭详情"
          icon="mdi-close"
          @click="detailOpen = false"
        />
        <v-toolbar-title>居间计算稿详情</v-toolbar-title>
        <v-chip class="mr-4" variant="tonal">
          {{ vm.calculationInput()!.source.periodStart }} 至
          {{ vm.calculationInput()!.source.periodEnd }}
        </v-chip>
      </v-toolbar>
      <v-card-text>
        <v-alert class="mb-5" type="info" variant="tonal">
          来源以销售签收明细为索引；收清日期由客户应收余额按日期、单号 FIFO
          倒推，跨月退货按原计算稿形成冲回。脚本快照：
          {{ vm.calculationInput()!.script.name }} · R{{
            vm.calculationInput()!.script.revision
          }}。
        </v-alert>
        <h3>销售签收计算明细</h3>
        <div class="responsive-table-wrap intermediary-detail__table">
          <v-table density="compact" class="responsive-table">
            <thead>
              <tr>
                <th>来源类型</th>
                <th>签收单</th>
                <th>退货单</th>
                <th>签收日期</th>
                <th>应收日期</th>
                <th>收清日期</th>
                <th class="text-end">延期天数</th>
                <th>结算方式</th>
                <th>特批</th>
                <th>客户</th>
                <th>业务员</th>
                <th>归属类型</th>
                <th>销售合作合同</th>
                <th>居间商</th>
                <th>产品</th>
                <th class="text-end">定价数量</th>
                <th class="text-end">标准计件</th>
                <th class="text-end">销售价</th>
                <th class="text-end">签收金额</th>
                <th class="text-end">基准价</th>
                <th class="text-end">数期加价</th>
                <th class="text-end">返点价</th>
                <th class="text-end">溢价</th>
                <th class="text-end">基础提成</th>
                <th class="text-end">溢价提成</th>
                <th class="text-end">低价/特批</th>
                <th class="text-end">维护补贴</th>
                <th class="text-end">开发补贴</th>
                <th class="text-end">票据成本</th>
                <th class="text-end">归属收益</th>
                <th class="text-end">居间金额</th>
                <th class="text-end">返点金额</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="source in vm.calculationInput()!.source.lines"
                :key="source.sourceSignoffLineId"
              >
                <td data-label="来源类型">
                  {{
                    source.sourceKind === 'RETURN_ADJUSTMENT'
                      ? '跨月退货冲回'
                      : '销售计提'
                  }}
                </td>
                <td data-label="签收单">{{ source.signoffDocumentNo }}</td>
                <td data-label="退货单">
                  {{ source.returnDocumentNos?.join('、') || '—' }}
                </td>
                <td data-label="签收日期">{{ source.signoffDate }}</td>
                <td data-label="应收日期">{{ source.dueDate }}</td>
                <td data-label="收清日期">{{ source.collectionDate }}</td>
                <td class="text-end" data-label="延期天数">
                  {{ source.collectionDelayDays }}
                </td>
                <td data-label="结算方式">{{ source.settlementTermCode }}</td>
                <td data-label="特批">
                  {{ source.specialApproval ? '是' : '否' }}
                </td>
                <td data-label="客户">
                  {{ formatReferenceLabel(source.customer) }}
                </td>
                <td data-label="业务员">
                  {{ formatReferenceLabel(source.salesperson) }}
                </td>
                <td data-label="归属类型">
                  {{ vm.categoryLabel(source.salesAttributionType) }}
                </td>
                <td data-label="销售合作合同">
                  {{
                    source.salesContractStatus === 'NOT_REQUIRED'
                      ? '不适用'
                      : source.salesContractStatus === 'MISSING'
                        ? '缺少合同'
                        : (source.salesContract?.documentId ?? '—')
                  }}
                </td>
                <td data-label="居间商">
                  {{
                    source.intermediary
                      ? formatReferenceLabel(source.intermediary)
                      : '—'
                  }}
                </td>
                <td data-label="产品">
                  {{ formatReferenceLabel(source.product) }}
                </td>
                <td class="text-end" data-label="定价数量">
                  {{ source.pricingQuantity }}
                </td>
                <td class="text-end" data-label="标准计件">
                  {{ source.standardPieceQuantity }}
                </td>
                <td class="text-end" data-label="销售价">
                  {{ source.unitPrice }}
                </td>
                <td class="text-end" data-label="签收金额">
                  {{ source.lineAmount }}
                </td>
                <td class="text-end" data-label="基准价">
                  {{ source.referenceUnitPrice }}
                </td>
                <td class="text-end" data-label="数期加价">
                  {{ source.settlementSurcharge }}
                </td>
                <td class="text-end" data-label="溢价">
                  {{
                    vm.lineResult(source.sourceSignoffLineId)?.premiumUnitPrice
                  }}
                </td>
                <td class="text-end" data-label="基础提成">
                  {{
                    vm.lineResult(source.sourceSignoffLineId)?.baseCommission
                  }}
                </td>
                <td class="text-end" data-label="溢价提成">
                  {{
                    vm.lineResult(source.sourceSignoffLineId)?.premiumCommission
                  }}
                </td>
                <td class="text-end" data-label="低价/特批">
                  {{
                    vm.lineResult(source.sourceSignoffLineId)
                      ?.lowPriceCommission
                  }}
                </td>
                <td class="text-end" data-label="维护补贴">
                  {{
                    vm.lineResult(source.sourceSignoffLineId)
                      ?.marketMaintenanceSubsidy
                  }}
                </td>
                <td class="text-end" data-label="开发补贴">
                  {{
                    vm.lineResult(source.sourceSignoffLineId)
                      ?.marketDevelopmentSubsidy
                  }}
                </td>
                <td class="text-end" data-label="票据成本">
                  {{ vm.lineResult(source.sourceSignoffLineId)?.billCost }}
                </td>
                <td class="text-end" data-label="归属收益">
                  {{
                    vm.lineResult(source.sourceSignoffLineId)?.employeeAmount
                  }}
                </td>
                <td class="text-end" data-label="居间金额">
                  {{
                    vm.lineResult(source.sourceSignoffLineId)
                      ?.intermediaryAmount
                  }}
                </td>
                <td data-label="说明">
                  {{ vm.lineResult(source.sourceSignoffLineId)?.note ?? '—' }}
                </td>
              </tr>
            </tbody>
          </v-table>
        </div>

        <h3 class="mt-7">期间票据成本来源（年化 3%）</h3>
        <div class="responsive-table-wrap intermediary-detail__table">
          <v-table density="compact" class="responsive-table">
            <thead>
              <tr>
                <th>票据收入单</th>
                <th>类型</th>
                <th>客户</th>
                <th class="text-end">票面金额</th>
                <th>收票日</th>
                <th>票面到期日</th>
                <th class="text-end">成本天数</th>
                <th>分配状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="bill in vm.calculationInput()!.source.bills"
                :key="bill.billLineId"
              >
                <td data-label="票据收入单">{{ bill.receiptDocumentNo }}</td>
                <td data-label="类型">{{ formatBillType(bill.billType) }}</td>
                <td data-label="客户">
                  {{ formatReferenceLabel(bill.customer) }}
                </td>
                <td class="text-end" data-label="票面金额">
                  {{ bill.faceAmount }}
                </td>
                <td data-label="收票日">{{ bill.receiptDate }}</td>
                <td data-label="票面到期日">{{ bill.maturityDate }}</td>
                <td class="text-end" data-label="成本天数">
                  {{ bill.costDays }}
                </td>
                <td data-label="分配状态">
                  {{
                    vm
                      .calculationInput()!
                      .result.lines.some((line) =>
                        line.billLineIds.includes(bill.billLineId),
                      )
                      ? '本期已分配'
                      : '顺延待分配'
                  }}
                </td>
              </tr>
              <tr
                v-if="vm.calculationInput()!.source.bills.length === 0"
                class="responsive-table__empty-row"
              >
                <td class="text-center" colspan="8">本期无票据成本来源</td>
              </tr>
            </tbody>
          </v-table>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.scriptOpen" fullscreen>
    <v-card class="intermediary-script">
      <v-toolbar color="surface">
        <v-btn icon="mdi-close" @click="vm.scriptOpen = false" />
        <v-toolbar-title>居间计算脚本</v-toolbar-title>
        <v-btn
          v-if="vm.canSaveScript"
          color="primary"
          :loading="vm.scriptSaving"
          prepend-icon="mdi-content-save-outline"
          @click="vm.saveScript"
        >
          保存脚本
        </v-btn>
      </v-toolbar>
      <v-progress-linear v-if="vm.scriptLoading" indeterminate />
      <v-card-text class="intermediary-script__content">
        <AppSnackbar
          :message="vm.scriptError"
          @dismiss="vm.scriptError = null"
        />
        <AppSnackbar
          :message="vm.scriptMessage"
          type="success"
          @dismiss="vm.scriptMessage = null"
        />
        <v-alert class="mb-5" type="warning" variant="tonal">
          脚本在浏览器 QuickJS 沙箱中运行，限制 16 MiB 内存和 2
          秒执行时间；不能访问页面、网络、Cookie
          或后端。保存脚本只影响后续重新计算。
        </v-alert>
        <div class="intermediary-script__meta">
          <v-text-field
            v-model="vm.scriptName"
            :disabled="!vm.canSaveScript"
            label="脚本名称"
            variant="outlined"
          />
          <v-text-field
            label="版本"
            :model-value="
              vm.scriptSnapshot ? `R${vm.scriptSnapshot.revision}` : '—'
            "
            readonly
            variant="outlined"
          />
          <v-text-field
            v-model="vm.scriptTestDate"
            label="试运行期间（月末）"
            type="date"
            variant="outlined"
          />
          <v-btn
            :disabled="!vm.canReadSource"
            :loading="vm.scriptTesting"
            prepend-icon="mdi-play-outline"
            variant="tonal"
            @click="vm.testScript"
          >
            试运行
          </v-btn>
        </div>
        <v-textarea
          v-model="vm.scriptSource"
          auto-grow
          class="intermediary-script__editor"
          :disabled="!vm.canSaveScript"
          label="JavaScript"
          rows="28"
          spellcheck="false"
          variant="outlined"
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.intermediary-page__toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}
.intermediary-form__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.intermediary-form__wide {
  grid-column: 1 / -1;
}
.intermediary-form__calculate,
.intermediary-form__section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
}
.intermediary-form__calculate .v-alert {
  flex: 1 1 auto;
}
.intermediary-form__section-title span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
.intermediary-detail,
.intermediary-script {
  min-height: 100dvh;
  background: rgb(var(--v-theme-background));
}
.intermediary-detail__table {
  margin-top: 12px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}
.intermediary-detail__table th,
.intermediary-detail__table td {
  white-space: nowrap;
}
.intermediary-script__content {
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
  padding: 24px;
}
.intermediary-script__meta {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr auto;
  gap: 16px;
  align-items: start;
}
.intermediary-script__editor :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.55;
}
@media (max-width: 900px) {
  .intermediary-form__grid,
  .intermediary-script__meta {
    grid-template-columns: 1fr;
  }
  .intermediary-form__calculate,
  .intermediary-form__section-title {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
