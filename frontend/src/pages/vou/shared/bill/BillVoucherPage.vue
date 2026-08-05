<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  VoucherAttachmentPanel,
  VoucherAuditHistory,
  VoucherBillCashLinesEditor,
  VoucherBillLinesEditor,
  VoucherLifecycleActions,
  VoucherReferenceAutocomplete,
  VoucherWorkspace,
} from '@/components/voucher'
import { formatVoucherStatus } from '@/components/voucher/status'
import VoucherReasonDialog from '../VoucherReasonDialog.vue'
import { billVoucherConfigs, type BillVoucherConfig } from './config'
import { useBillVoucherViewModel } from './vm'
import { summarizeBillVoucher } from './validation'

const props = defineProps<{ config?: BillVoucherConfig }>()
const vm = useBillVoucherViewModel(
  props.config ?? billVoucherConfigs['bill-receipt'],
)
const deleteDialog = ref(false)
const deleteReason = ref('')
const summary = computed(() => summarizeBillVoucher(vm.form))

async function confirmDelete(): Promise<void> {
  const reason = deleteReason.value.trim()
  if (!reason || Array.from(reason).length > 1000) return
  if (await vm.deleteDraft(reason)) {
    deleteDialog.value = false
    deleteReason.value = ''
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
            <th>客户</th>
            <th>状态</th>
            <th>票面合计</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in vm.rows.value" :key="row.documentId">
            <td data-label="单号">{{ row.documentNo }}</td>
            <td data-label="日期">{{ row.businessDate }}</td>
            <td data-label="客户">{{ row.partyName || '—' }}</td>
            <td data-label="状态">{{ formatVoucherStatus(row.status) }}</td>
            <td data-label="票面合计">{{ row.currency }} {{ row.amount }}</td>
            <td data-label="操作">
              <v-btn size="small" variant="text" @click="vm.openDocument(row)"
                >查看</v-btn
              >
            </td>
          </tr>
          <tr v-if="!vm.loading.value && vm.rows.value.length === 0">
            <td class="text-center py-8" colspan="6">暂无票据收入</td>
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
      @close="vm.workspaceOpen.value = false"
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
          :status="vm.documentStatus.value"
          :availability="vm.actionAvailability.value"
          :loading-action="vm.actionLoading.value"
          :labels="{
            check: '检查',
            uncheck: '反检查',
            approve: '批准',
            unapprove: '反批准',
            finalize: '完成',
            unfinalize: '反完成',
            checked: '已检查',
            finalized: '已完成',
          }"
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
          <v-col cols="12" md="3"
            ><VoucherReferenceAutocomplete
              v-model="vm.form.customer"
              :disabled="!vm.editing.value"
              label="客户"
              required
              :options="vm.customerOptions.value"
              @search="vm.searchCustomer"
          /></v-col>
          <v-col cols="12" md="3"
            ><VoucherReferenceAutocomplete
              v-model="vm.form.handler"
              :disabled="!vm.editing.value"
              label="经办人"
              required
              :options="vm.handlerOptions.value"
              @search="vm.searchHandler"
          /></v-col>
          <v-col cols="12" md="3"
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
        <VoucherBillLinesEditor
          v-model="vm.form.billLines"
          :business-date="vm.form.businessDate"
          :currency="vm.form.currency"
          :editable="vm.editing.value"
          :internal-cost-rate-bps="vm.form.internalCostRateBps"
          :max-lines="vm.config.maxBillLines"
          :held-options="vm.heldBillOptions.value"
          @search-held="vm.searchHeldBills"
        />
        <VoucherBillCashLinesEditor
          class="mt-6"
          v-model="vm.form.billCashLines"
          :editable="vm.editing.value"
          :fund-options="vm.fundAccountOptions.value"
          :max-lines="vm.config.maxCashLines"
          @fund-search="vm.searchFundAccount"
        />
        <v-sheet class="bill-voucher-summary mt-5 pa-4" rounded="lg">
          <div>
            <span>收入票据</span>
            <strong>{{ vm.form.currency }} {{ summary.primary }}</strong>
          </div>
          <div>
            <span>找零票据</span>
            <strong>{{ vm.form.currency }} {{ summary.change }}</strong>
          </div>
          <div>
            <span>现金补款</span>
            <strong>{{ vm.form.currency }} {{ summary.cashIn }}</strong>
          </div>
          <div>
            <span>现金找零</span>
            <strong>{{ vm.form.currency }} {{ summary.cashOut }}</strong>
          </div>
          <div :class="{ 'text-error': !summary.valid }">
            <span>客户净结算额</span>
            <strong>{{ vm.form.currency }} {{ summary.net }}</strong>
          </div>
        </v-sheet>
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
