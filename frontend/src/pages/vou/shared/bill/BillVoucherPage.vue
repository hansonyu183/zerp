<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import {
  VoucherAttachmentPanel,
  VoucherAuditHistory,
  VoucherBillCashLinesEditor,
  VoucherBillLinesEditor,
  VoucherLifecycleActions,
  VoucherReferenceAutocomplete,
  VoucherWorkspace,
  type VoucherLifecycleAction,
} from '@/components/voucher'
import { formatVoucherStatus } from '@/components/voucher/status'
import { formatBillType } from '@/utils/bill-type'
import { formatReferenceLabel } from '@/utils/reference-label'
import VoucherReasonDialog from '../VoucherReasonDialog.vue'
import { billVoucherConfigs, type BillVoucherConfig } from './config'
import { useBillVoucherViewModel } from './vm'
import { previewInterestAmount, summarizeBillVoucher } from './validation'
import { approvalActionPresentation } from '@/shared/approval'
import type { BillListItem } from './vm'

const props = defineProps<{ config?: BillVoucherConfig }>()
const vm = useBillVoucherViewModel(
  props.config ?? billVoucherConfigs['bill-receipt'],
)
const deleteDialog = ref(false)
const deleteReason = ref('')
const listLifecycleTarget = ref<BillListItem | null>(null)
const listLifecycleAction =
  ref<Extract<VoucherLifecycleAction, 'reject' | 'unapprove'>>('reject')
const listLifecycleReason = ref('')
const lifecycleActionPriority: readonly VoucherLifecycleAction[] = [
  'submit',
  'unsubmit',
  'reject',
  'approve',
  'unapprove',
]
const summary = computed(() => summarizeBillVoucher(vm.form, vm.config.mode))
function discountDays(maturityDate: string): number {
  const start = Date.parse(`${vm.form.businessDate}T00:00:00Z`)
  const end = Date.parse(`${maturityDate}T00:00:00Z`)
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.round((end - start) / 86_400_000))
    : 0
}
function discountInterest(line: {
  faceAmount: string
  annualRateBps: number
  maturityDate: string
}): string {
  return (
    previewInterestAmount(
      line.faceAmount,
      line.annualRateBps,
      discountDays(line.maturityDate),
    ) ?? '—'
  )
}

async function confirmDelete(): Promise<void> {
  const reason = deleteReason.value.trim()
  if (!reason || Array.from(reason).length > 1000) return
  if (await vm.deleteDraft(reason)) {
    deleteDialog.value = false
    deleteReason.value = ''
  }
}

function requestListLifecycleAction(
  row: BillListItem,
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
  void vm.lifecycleFromList(row, action)
}

function rowActions(row: BillListItem): ListRowAction[] {
  const actions: ListRowAction[] = [
    {
      key: 'view',
      label: `查看 ${row.documentNo}`,
      icon: 'mdi-eye-outline',
    },
  ]
  for (const action of lifecycleActionPriority) {
    if (!row.availableApprovalActions.includes(action)) continue
    const presentation = approvalActionPresentation[action]
    actions.push({
      key: action,
      label: `${presentation.label} ${row.documentNo}`,
      icon: presentation.icon,
      color: presentation.color,
    })
  }
  return actions
}

function selectRowAction(row: BillListItem, action: string): void {
  if (action === 'view') {
    void vm.openDocument(row)
    return
  }
  if (
    lifecycleActionPriority.includes(action as VoucherLifecycleAction) &&
    row.availableApprovalActions.includes(action as VoucherLifecycleAction)
  ) {
    requestListLifecycleAction(row, action as VoucherLifecycleAction)
  }
}

async function confirmListLifecycleAction(): Promise<void> {
  const row = listLifecycleTarget.value
  const reason = listLifecycleReason.value.trim()
  if (!row || !reason || Array.from(reason).length > 1000) return
  if (await vm.lifecycleFromList(row, listLifecycleAction.value, reason)) {
    listLifecycleTarget.value = null
    listLifecycleReason.value = ''
  }
}

onMounted(() => void vm.query())
</script>

<template>
  <v-container fluid class="bill-voucher-page pa-4 pa-md-7">
    <v-alert
      v-if="vm.errorMessage.value"
      class="mb-3"
      type="error"
      variant="tonal"
    >
      {{ vm.errorMessage.value }}
    </v-alert>
    <v-card rounded="lg" variant="flat">
      <v-card-title class="d-flex align-center justify-space-between">
        <span>{{ vm.config.title }}</span>
        <v-btn
          v-if="vm.canCreate.value"
          color="primary"
          prepend-icon="mdi-plus"
          @click="vm.openCreate"
        >
          新增
        </v-btn>
      </v-card-title>
      <v-card-text>
        <div class="d-flex flex-wrap ga-3">
          <v-text-field
            v-model="vm.keyword.value"
            clearable
            hide-details
            label="单号或客户"
            variant="outlined"
            @keyup.enter="vm.query"
          />
          <v-btn :loading="vm.loading.value" @click="vm.query">查询</v-btn>
        </div>
      </v-card-text>
      <v-table class="responsive-table">
        <thead>
          <tr>
            <th>单号</th>
            <th>日期</th>
            <th>
              {{
                vm.config.mode === 'payment'
                  ? '供应商'
                  : vm.config.mode === 'discount'
                    ? '贴现方'
                    : vm.config.mode === 'maturity'
                      ? '—'
                      : '客户'
              }}
            </th>
            <th>状态</th>
            <th>票面合计</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in vm.rows.value" :key="row.documentId">
            <td data-label="单号">{{ row.documentNo }}</td>
            <td data-label="日期">{{ row.businessDate }}</td>
            <td data-label="往来方">{{ row.partyName || '—' }}</td>
            <td data-label="状态">{{ formatVoucherStatus(row.status) }}</td>
            <td data-label="票面合计">{{ row.currency }} {{ row.amount }}</td>
            <td data-label="操作">
              <ListRowActions
                :actions="rowActions(row)"
                :label="`操作 ${row.documentNo}`"
                :loading="Boolean(vm.actionLoading.value)"
                :more-label="`更多操作 ${row.documentNo}`"
                @select="selectRowAction(row, $event)"
              />
            </td>
          </tr>
          <tr v-if="!vm.loading.value && vm.rows.value.length === 0">
            <td class="text-center py-8" colspan="6">
              暂无{{ vm.config.title }}
            </td>
          </tr>
        </tbody>
      </v-table>
      <v-pagination
        v-if="vm.total.value > vm.pageSize.value"
        class="py-4"
        :length="Math.ceil(vm.total.value / vm.pageSize.value)"
        :model-value="vm.page.value"
        @update:model-value="vm.changePage"
      />
    </v-card>

    <VoucherReasonDialog
      :model-value="Boolean(listLifecycleTarget)"
      :confirm-label="`确认${approvalActionPresentation[listLifecycleAction].label}`"
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

    <VoucherWorkspace
      v-model="vm.workspaceOpen.value"
      :title="vm.config.title"
      :document="vm.documentView.value"
      :editing="vm.editing.value"
      :busy="
        vm.loading.value || vm.saving.value || Boolean(vm.actionLoading.value)
      "
      :error-message="vm.errorMessage.value"
      :can-reload="Boolean(vm.documentView.value)"
      @reload="vm.openDocument({ documentId: vm.documentId.value ?? '' })"
      @close="vm.closeWorkspace"
    >
      <template #actions>
        <v-btn
          v-if="vm.editing.value"
          color="primary"
          :loading="vm.saving.value"
          @click="vm.save"
          >保存</v-btn
        >
        <v-btn
          v-else-if="vm.documentId.value"
          variant="tonal"
          :disabled="
            vm.documentStatus.value !== 'DRAFT' ||
            !vm.actionAvailability.value.save
          "
          @click="vm.editing.value = true"
          >编辑</v-btn
        >
        <v-btn
          v-if="
            vm.documentId.value &&
            vm.documentStatus.value === 'DRAFT' &&
            vm.actionAvailability.value.delete
          "
          color="error"
          variant="text"
          @click="deleteDialog = true"
          >删除草稿</v-btn
        >
        <VoucherLifecycleActions
          v-if="vm.documentId.value"
          :availability="vm.actionAvailability.value"
          :loading-action="vm.actionLoading.value"
          @action="vm.lifecycle"
        />
      </template>

      <template #document>
        <v-row>
          <v-col cols="12" md="3"
            ><v-text-field
              v-model="vm.form.businessDate"
              :disabled="!vm.editing.value"
              label="业务日期"
              type="date"
              variant="outlined"
          /></v-col>
          <v-col cols="12" md="3"
            ><v-text-field
              v-model="vm.form.currency"
              :disabled="!vm.editing.value"
              label="币种"
              maxlength="3"
              variant="outlined"
          /></v-col>
          <v-col v-if="vm.config.mode === 'receipt'" cols="12" md="3"
            ><VoucherReferenceAutocomplete
              v-model="vm.form.customer"
              :disabled="!vm.editing.value"
              label="客户"
              required
              :options="vm.customerOptions.value"
              @search="vm.searchCustomer"
          /></v-col>
          <v-col v-else-if="vm.config.mode === 'payment'" cols="12" md="3"
            ><VoucherReferenceAutocomplete
              v-model="vm.form.supplier"
              :disabled="!vm.editing.value"
              label="供应商"
              required
              :options="vm.supplierOptions.value"
              @search="vm.searchSupplier"
          /></v-col>
          <v-col v-else-if="vm.config.mode === 'discount'" cols="12" md="3"
            ><VoucherReferenceAutocomplete
              v-model="vm.form.counterparty"
              :disabled="!vm.editing.value"
              label="贴现方"
              required
              :options="vm.otherPartyOptions.value"
              @search="vm.searchOtherParty"
          /></v-col>
          <v-col v-if="vm.config.mode === 'maturity'" cols="12" md="3">
            <v-select
              :model-value="vm.form.maturityType"
              :disabled="!vm.editing.value"
              label="到期处理方式"
              :items="[
                { title: '到期收款', value: 'RECEIPT' },
                { title: '到期付款', value: 'PAYMENT' },
              ]"
              variant="outlined"
              @update:model-value="vm.changeMaturityType"
            />
          </v-col>
          <v-col v-if="vm.config.mode === 'receipt'" cols="12" md="3"
            ><VoucherReferenceAutocomplete
              v-model="vm.form.handler"
              :disabled="!vm.editing.value"
              label="经办人"
              required
              :options="vm.handlerOptions.value"
              @search="vm.searchHandler"
          /></v-col>
          <v-col v-if="vm.config.mode === 'receipt'" cols="12" md="3"
            ><v-text-field
              v-model.number="vm.form.internalCostRateBps"
              :disabled="!vm.editing.value"
              inputmode="numeric"
              label="内部年化成本率(bps)"
              min="0"
              max="100000"
              type="number"
              variant="outlined"
          /></v-col>
          <v-col
            v-if="vm.config.mode === 'issue' || vm.config.mode === 'discount'"
            cols="12"
            md="3"
          >
            <v-select
              v-model="vm.form.interestMode"
              :disabled="!vm.editing.value"
              label="利息承担方式"
              :items="[
                { title: '银行扣息', value: 'BANK_DEDUCTED' },
                { title: '第三方承担应付利息', value: 'THIRD_PARTY_PAYABLE' },
              ]"
              variant="outlined"
            />
          </v-col>
          <v-col
            v-if="
              (vm.config.mode === 'issue' || vm.config.mode === 'discount') &&
              vm.form.interestMode === 'THIRD_PARTY_PAYABLE'
            "
            cols="12"
            md="3"
          >
            <VoucherReferenceAutocomplete
              v-model="vm.form.interestParty"
              :disabled="!vm.editing.value"
              label="利息承担方"
              required
              :options="vm.otherPartyOptions.value"
              @search="vm.searchOtherParty"
            />
          </v-col>
          <v-col v-if="vm.config.mode === 'discount'" cols="12" md="3">
            <v-checkbox
              v-model="vm.form.withRecourse"
              :disabled="!vm.editing.value"
              label="有追索权"
              hide-details
            />
          </v-col>
          <v-col cols="12" md="9"
            ><v-textarea
              v-model="vm.form.remark"
              :disabled="!vm.editing.value"
              counter="1000"
              label="备注"
              rows="1"
              variant="outlined"
          /></v-col>
        </v-row>
        <v-alert
          v-if="vm.config.mode === 'issue'"
          class="mb-3"
          type="info"
          variant="tonal"
          >新开票据固定为负债、流入、主要票据；利息仅按选择的承担方式预览，不自动生成虚假资金行。</v-alert
        >
        <v-alert
          v-if="vm.config.mode === 'discount'"
          class="mb-3"
          type="info"
          variant="tonal"
          >仅可选择当前可用的资产类持有票据；贴现日、到期日和利息预览按业务日期计算。</v-alert
        >
        <VoucherBillLinesEditor
          v-if="vm.config.mode === 'receipt' || vm.config.mode === 'issue'"
          v-model="vm.form.billLines"
          :mode="vm.config.mode === 'issue' ? 'issue' : 'receipt'"
          :business-date="vm.form.businessDate"
          :currency="vm.form.currency"
          :editable="vm.editing.value"
          :internal-cost-rate-bps="vm.form.internalCostRateBps"
          :max-lines="vm.config.maxBillLines"
          :held-options="vm.heldBillOptions.value"
          @search-held="vm.searchHeldBills"
        />
        <section
          v-else-if="vm.config.mode === 'discount'"
          class="bill-payment-lines"
        >
          <div class="d-flex align-center justify-space-between mb-3">
            <h3>贴现票据</h3>
            <v-btn
              color="primary"
              :disabled="
                !vm.editing.value ||
                vm.form.billLines.length >= vm.config.maxBillLines
              "
              @click="vm.openHeldDialog"
              >选择持有票据</v-btn
            >
          </div>
          <v-alert
            v-if="vm.form.billLines.length === 0"
            type="info"
            variant="tonal"
            >请选择当前可用的资产类持有票据。</v-alert
          >
          <v-table v-else class="responsive-table"
            ><thead>
              <tr>
                <th>票据号码</th>
                <th>类型</th>
                <th>币种</th>
                <th>票面金额</th>
                <th>年利率(bps)</th>
                <th>贴现天数</th>
                <th>预计利息</th>
                <th>到期日</th>
                <th>出票人</th>
                <th>承兑人</th>
                <th>收款人</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in vm.form.billLines" :key="line.key">
                <td data-label="票据号码">{{ line.billNo }}</td>
                <td data-label="类型">{{ formatBillType(line.billType) }}</td>
                <td data-label="币种">{{ line.currency }}</td>
                <td data-label="票面金额">{{ line.faceAmount }}</td>
                <td data-label="年利率（基点）">
                  <v-text-field
                    v-model.number="line.annualRateBps"
                    :disabled="!vm.editing.value"
                    type="number"
                    min="0"
                    max="100000"
                    density="compact"
                    hide-details
                  />
                </td>
                <td data-label="贴现天数">
                  {{ discountDays(line.maturityDate) }}
                </td>
                <td data-label="贴现利息">{{ discountInterest(line) }}</td>
                <td data-label="到期日">{{ line.maturityDate }}</td>
                <td data-label="出票人">{{ line.drawer }}</td>
                <td data-label="承兑人">{{ line.acceptor }}</td>
                <td data-label="收款人">{{ line.payee }}</td>
              </tr>
            </tbody></v-table
          >
        </section>
        <section v-else class="bill-payment-lines">
          <div class="d-flex align-center justify-space-between mb-3">
            <h3>
              {{ vm.config.mode === 'maturity' ? '到期票据' : '付出票据' }}
            </h3>
            <v-btn
              color="primary"
              :disabled="
                !vm.editing.value ||
                vm.form.billLines.length >= vm.config.maxBillLines
              "
              @click="vm.openHeldDialog"
              >选择持有票据</v-btn
            >
          </div>
          <v-alert
            v-if="vm.form.billLines.length === 0"
            type="info"
            variant="tonal"
            >请选择当前可用的资产类持有票据。</v-alert
          >
          <v-table v-else class="responsive-table"
            ><thead>
              <tr>
                <th>票据号码</th>
                <th>类型</th>
                <th>币种</th>
                <th>票面金额</th>
                <th>到期日</th>
                <th>出票人</th>
                <th>承兑人</th>
                <th>收款人</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in vm.form.billLines" :key="line.key">
                <td data-label="票据号码">{{ line.billNo }}</td>
                <td data-label="类型">{{ formatBillType(line.billType) }}</td>
                <td data-label="币种">{{ line.currency }}</td>
                <td data-label="票面金额">{{ line.faceAmount }}</td>
                <td data-label="到期日">{{ line.maturityDate }}</td>
                <td data-label="出票人">{{ line.drawer }}</td>
                <td data-label="承兑人">{{ line.acceptor }}</td>
                <td data-label="收款人">{{ line.payee }}</td>
              </tr>
            </tbody></v-table
          >
        </section>
        <VoucherBillCashLinesEditor
          v-if="vm.config.mode !== 'payment'"
          v-model="vm.form.billCashLines"
          class="mt-6"
          :editable="vm.editing.value"
          :fund-options="vm.fundAccountOptions.value"
          :max-lines="vm.config.maxCashLines"
          @fund-search="vm.searchFundAccount"
        />
        <v-sheet
          v-if="vm.config.mode !== 'payment'"
          class="bill-voucher-summary mt-5 pa-4"
          rounded="lg"
        >
          <div>
            <span>{{
              vm.config.mode === 'discount' ? '贴现票据' : '收入票据'
            }}</span>
            <strong>{{ vm.form.currency }} {{ summary.primary }}</strong>
          </div>
          <div>
            <span>找零票据</span>
            <strong>{{ vm.form.currency }} {{ summary.change }}</strong>
          </div>
          <div>
            <span>{{
              vm.config.mode === 'discount' ? '资金流入' : '现金补款'
            }}</span>
            <strong>{{ vm.form.currency }} {{ summary.cashIn }}</strong>
          </div>
          <div>
            <span>{{
              vm.config.mode === 'discount' ? '资金流出' : '现金找零'
            }}</span>
            <strong>{{ vm.form.currency }} {{ summary.cashOut }}</strong>
          </div>
          <div :class="{ 'text-error': !summary.valid }">
            <span>{{
              vm.config.mode === 'issue'
                ? '票据净现金流'
                : vm.config.mode === 'discount'
                  ? '贴现净到账'
                  : '客户净结算额'
            }}</span>
            <strong>{{ vm.form.currency }} {{ summary.net }}</strong>
          </div>
        </v-sheet>
        <v-sheet v-else class="bill-voucher-summary mt-5 pa-4" rounded="lg"
          ><span>票面合计</span
          ><strong
            >{{ vm.form.currency }} {{ summary.primary }}</strong
          ></v-sheet
        >
      </template>

      <template #attachments>
        <VoucherAttachmentPanel
          :attachments="vm.documentView.value?.attachments ?? []"
          :document-created="Boolean(vm.documentView.value)"
          :draft="vm.documentStatus.value === 'DRAFT'"
          :can-upload="vm.actionAvailability.value.attachmentInitiate"
          :can-download="vm.actionAvailability.value.attachmentDownload"
          :can-remove="vm.actionAvailability.value.attachmentRemove"
          :loading="vm.attachmentLoading.value"
          :error-message="vm.attachmentError.value"
          @upload="vm.uploadAttachments"
          @download="vm.downloadAttachment"
          @remove="vm.removeAttachment"
        />
      </template>
      <template #audit>
        <VoucherAuditHistory
          :events="vm.auditEvents.value"
          :loading="vm.auditLoading.value"
          :page="vm.auditPage.value"
          :page-size="vm.auditPageSize.value"
          :total="vm.auditTotal.value"
          :error-message="vm.auditError.value"
          @reload="vm.loadAudit"
          @update:page="vm.loadAudit"
        />
      </template>
    </VoucherWorkspace>

    <v-dialog
      v-if="
        vm.config.mode === 'payment' ||
        vm.config.mode === 'discount' ||
        vm.config.mode === 'maturity'
      "
      v-model="vm.heldDialogOpen.value"
      max-width="1100"
    >
      <v-card
        ><v-card-title>选择可用持有票据</v-card-title
        ><v-card-text>
          <v-text-field
            label="票据号码"
            variant="outlined"
            @update:model-value="vm.searchHeldBills"
          />
          <v-table class="responsive-table"
            ><thead>
              <tr>
                <th>选择</th>
                <th>票据号码</th>
                <th>类型</th>
                <th>币种</th>
                <th>票面金额</th>
                <th>到期日</th>
                <th>往来方</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in vm.heldBillOptions.value" :key="line.billId">
                <td data-label="选择">
                  <v-checkbox
                    v-model="vm.heldSelection.value"
                    :value="line.billId"
                    hide-details
                  />
                </td>
                <td data-label="票据号码">{{ line.billNo }}</td>
                <td data-label="类型">{{ formatBillType(line.billType) }}</td>
                <td data-label="币种">{{ line.currency }}</td>
                <td data-label="票面金额">{{ line.faceAmount }}</td>
                <td data-label="到期日">{{ line.maturityDate }}</td>
                <td data-label="往来方">
                  {{
                    line.originatingParty
                      ? formatReferenceLabel(line.originatingParty)
                      : '—'
                  }}
                </td>
              </tr>
            </tbody></v-table
          > </v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn
            variant="text"
            @click="vm.heldDialogOpen.value = false"
            >取消</v-btn
          ><v-btn color="primary" @click="vm.applyHeldSelection"
            >确定（最多20张）</v-btn
          ></v-card-actions
        ></v-card
      >
    </v-dialog>

    <VoucherReasonDialog
      v-model="deleteDialog"
      title="删除草稿"
      confirm-label="确认删除"
      :reason="deleteReason"
      :loading="vm.actionLoading.value === 'delete'"
      @update:reason="deleteReason = $event"
      @confirm="confirmDelete"
    />
  </v-container>
</template>

<style scoped>
.bill-voucher-summary {
  display: grid;
  gap: 8px 24px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.bill-voucher-summary > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
</style>
