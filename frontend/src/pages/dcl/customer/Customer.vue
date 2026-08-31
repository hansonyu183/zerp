<script setup lang="ts">
import { reactive, ref } from 'vue'
import { BusinessObjectList } from '@/components/business-object'
import type { BusinessObjectColumn } from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import CustomerAccountFields from '../customer-account/CustomerAccountFields.vue'
import CustomerAttachments from '../customer-account/CustomerAttachments.vue'
import {
  dclApprovalEventActionText,
  dclApprovalStatusText,
} from '../shared/declaration'
import type { DclCustomerListItem } from './data'
import { customerActiveVersion, useDclCustomerViewModel } from './vm'

const vm = reactive(useDclCustomerViewModel())
const reasonTarget = ref<{
  row: DclCustomerListItem
  action: 'reject' | 'unapprove'
} | null>(null)
const reason = ref('')
const columns: readonly BusinessObjectColumn<DclCustomerListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  { key: 'party', label: '主体', value: (row) => row.partyDisplayName },
  {
    key: 'operatingEntity',
    label: '经营主体',
    value: (row) => `${row.operatingEntityCode} · ${row.operatingEntityName}`,
  },
  {
    key: 'status',
    label: '审核状态',
    value: (row) =>
      dclApprovalStatusText[customerActiveVersion(row).approval.status],
  },
  {
    key: 'candidate',
    label: '候选版本',
    value: (row) => (row.openVersion ? '有' : '无'),
  },
]

function actions(row: DclCustomerListItem): ListRowAction[] {
  const available = vm.actionAvailability(row)
  const result: ListRowAction[] = available.view
    ? [{ key: 'view', label: '查看', icon: 'mdi-eye-outline' }]
    : []
  if (available.submit)
    result.push({ key: 'submit', label: '提交审核', icon: 'mdi-send-outline' })
  if (available.delete)
    result.push({
      key: 'delete',
      label: '删除草稿',
      icon: 'mdi-delete-outline',
      color: 'error',
    })
  if (available.approve)
    result.push({
      key: 'approve',
      label: '审核通过',
      icon: 'mdi-check-outline',
      color: 'success',
    })
  if (available.reject)
    result.push({
      key: 'reject',
      label: '审核驳回',
      icon: 'mdi-close-outline',
      color: 'error',
    })
  if (available.unsubmit)
    result.push({ key: 'unsubmit', label: '撤回提交', icon: 'mdi-undo' })
  if (available.unapprove)
    result.push({
      key: 'unapprove',
      label: '撤销批准',
      icon: 'mdi-backup-restore',
    })
  if (available.enable || available.disable)
    result.push({
      key: 'toggle',
      label: available.disable ? '禁用' : '启用',
      icon: 'mdi-power',
    })
  if (available.versions)
    result.push({ key: 'versions', label: '版本历史', icon: 'mdi-history' })
  if (available.audit)
    result.push({
      key: 'audit',
      label: '审核历史',
      icon: 'mdi-clipboard-text-clock-outline',
    })
  return result
}

function selectAction(action: string, row: DclCustomerListItem): void {
  if (action === 'view') void vm.openById(row.objectId)
  else if (action === 'versions') void vm.openVersions(row)
  else if (action === 'audit') void vm.openAudit(row)
  else if (action === 'delete') void vm.remove(row)
  else if (action === 'toggle') void vm.toggleEnabled(row)
  else if (action === 'reject' || action === 'unapprove') {
    reasonTarget.value = { row, action }
    reason.value = ''
  } else if (
    action === 'submit' ||
    action === 'unsubmit' ||
    action === 'approve'
  )
    void vm.runAction(row, action)
}

async function confirmReason(): Promise<void> {
  const target = reasonTarget.value
  if (!target || !reason.value.trim()) return
  if (await vm.runAction(target.row, target.action, reason.value))
    reasonTarget.value = null
}

void vm.query()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <BusinessObjectList
      :columns="columns"
      :creatable="vm.canCreate"
      :deletable="false"
      :editable="(row) => actions(row).length > 0"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(row) => row.objectId"
      :rows="vm.rows"
      search-label="客户关系编码或主体"
      :total="vm.total"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-select
          v-model="vm.enabled"
          clearable
          :items="[
            { title: '启用', value: true },
            { title: '禁用', value: false },
          ]"
          label="启停状态"
          variant="outlined"
        />
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :actions="actions(row)"
          :label="`操作 ${row.code}`"
          :loading="vm.actionLoading === row.objectId"
          :more-label="`更多操作 ${row.code}`"
          @select="selectAction($event, row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-dialog v-model="vm.createOpen" max-width="980" persistent>
    <v-card title="新建客户关系申报">
      <v-card-text>
        <v-row dense>
          <v-col cols="12" md="4">
            <v-select
              v-model="vm.createForm.partyMode"
              :items="[
                { title: '新建主体', value: 'NEW' },
                { title: '复用已有主体', value: 'EXISTING' },
              ]"
              label="主体来源"
            />
          </v-col>
          <v-col v-if="vm.createForm.partyMode === 'EXISTING'" cols="12" md="8">
            <v-autocomplete
              v-model="vm.createForm.partyId"
              :error-messages="vm.referenceError.partyId ?? undefined"
              :items="vm.referenceOptions.partyId"
              label="已有主体"
              :loading="vm.referenceLoading.partyId"
              required
              @update:search="vm.searchReference('partyId', $event)"
            />
          </v-col>
          <template v-else>
            <v-col cols="12" md="4"
              ><v-select
                v-model="vm.createForm.partyKind"
                :items="[
                  { title: '组织', value: 'ORGANIZATION' },
                  { title: '个人', value: 'PERSON' },
                ]"
                label="主体类型"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field
                v-model="vm.createForm.legalName"
                label="法定名称"
                required
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field
                v-model="vm.createForm.displayName"
                label="显示名称"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field v-model="vm.createForm.taxNumber" label="税号"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-select
                v-model="vm.createForm.identifierType"
                :items="[
                  {
                    title: '统一社会信用代码',
                    value: 'UNIFIED_SOCIAL_CREDIT_CODE',
                  },
                  { title: '个人证件', value: 'PERSON_ID' },
                ]"
                label="强标识类型"
            /></v-col>
            <v-col cols="12" md="4"
              ><v-text-field
                v-model="vm.createForm.identifierValue"
                label="强标识值"
            /></v-col>
          </template>
          <v-col cols="12"
            ><v-autocomplete
              v-model="vm.createForm.operatingEntityId"
              :error-messages="vm.referenceError.operatingEntityId ?? undefined"
              :items="vm.referenceOptions.operatingEntityId"
              label="经营主体"
              :loading="vm.referenceLoading.operatingEntityId"
              required
              @update:search="vm.searchReference('operatingEntityId', $event)"
          /></v-col>
          <v-col cols="12"
            ><v-divider class="my-3" />
            <div class="text-h6 mb-3">默认结算子账户</div></v-col
          >
        </v-row>
        <CustomerAccountFields
          v-model="vm.createForm.defaultAccount"
          :reference-error="{
            customerTypeId: vm.referenceError.customerTypeId,
            settlementMethodId: vm.referenceError.settlementMethodId,
            paymentMethodId: vm.referenceError.paymentMethodId,
            primarySalesAttributionSubjectObjectId:
              vm.referenceError.primarySalesAttributionSubjectObjectId,
          }"
          :reference-loading="{
            customerTypeId: vm.referenceLoading.customerTypeId,
            settlementMethodId: vm.referenceLoading.settlementMethodId,
            paymentMethodId: vm.referenceLoading.paymentMethodId,
            primarySalesAttributionSubjectObjectId:
              vm.referenceLoading.primarySalesAttributionSubjectObjectId,
          }"
          :reference-options="{
            customerTypeId: vm.referenceOptions.customerTypeId,
            settlementMethodId: vm.referenceOptions.settlementMethodId,
            paymentMethodId: vm.referenceOptions.paymentMethodId,
            primarySalesAttributionSubjectObjectId:
              vm.referenceOptions.primarySalesAttributionSubjectObjectId,
          }"
          @search-reference="vm.searchReference"
        />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.createOpen = false">取消</v-btn
        ><v-btn color="primary" :loading="vm.saving" @click="vm.create"
          >创建草稿</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>

  <v-navigation-drawer
    v-model="vm.drawerOpen"
    location="end"
    temporary
    width="640"
  >
    <v-card v-if="vm.currentView" flat title="客户关系申报">
      <v-list density="compact">
        <v-list-item title="编码" :subtitle="vm.currentView.code" />
        <v-list-item title="主体" :subtitle="vm.currentView.partyDisplayName" />
        <v-list-item
          title="经营主体"
          :subtitle="`${vm.currentView.operatingEntityCode} · ${vm.currentView.operatingEntityName}`"
        />
        <v-list-item
          title="审核状态"
          :subtitle="dclApprovalStatusText[vm.currentView.approval.status]"
        />
        <v-list-item
          title="附件数"
          :subtitle="String(vm.currentView.attachments.length)"
        />
      </v-list>
      <v-card-text>
        <CustomerAttachments
          scope="CUSTOMER"
          :owner-approval-entry-id="vm.currentView.approval.approvalEntryId"
          :approval-revision="vm.currentView.approval.revision"
          :attachments="vm.currentView.attachments"
          :editable="vm.currentView.approval.status === 'DRAFT'"
          @changed="
            vm.openById(
              vm.currentView.objectId,
              vm.currentView.approval.approvalEntryId,
            )
          "
        />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.drawerOpen = false"
          >关闭</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-navigation-drawer>
  <v-dialog v-model="vm.versionsOpen" max-width="720">
    <v-card title="客户关系版本历史">
      <v-list density="compact">
        <v-list-item
          v-for="version in vm.versions"
          :key="version.approval.approvalEntryId"
          :title="`V${version.approval.versionNo} · ${dclApprovalStatusText[version.approval.status]}`"
          :subtitle="version.approval.updatedAt"
        />
      </v-list>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.versionsOpen = false"
          >关闭</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
  <v-dialog v-model="vm.auditOpen" max-width="720">
    <v-card title="客户关系审核历史">
      <v-list density="compact">
        <v-list-item
          v-for="event in vm.auditEvents"
          :key="event.id"
          :title="dclApprovalEventActionText[event.action]"
          :subtitle="`${event.createdAt}${event.reason ? ` · ${event.reason}` : ''}`"
        />
      </v-list>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.auditOpen = false"
          >关闭</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
  <v-dialog
    :model-value="Boolean(reasonTarget)"
    max-width="620"
    @update:model-value="
      (value) => {
        if (!value) reasonTarget = null
      }
    "
  >
    <v-card
      :title="reasonTarget?.action === 'reject' ? '审核驳回' : '撤销批准'"
    >
      <v-card-text
        ><v-textarea
          v-model="reason"
          label="原因"
          maxlength="1000"
          counter
          required
      /></v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn @click="reasonTarget = null">取消</v-btn
        ><v-btn
          color="warning"
          :disabled="!reason.trim()"
          @click="confirmReason"
          >确认</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>
