<script setup lang="ts">
import { reactive, ref } from 'vue'
import { BusinessObjectList } from '@/components/business-object'
import type { BusinessObjectColumn } from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import CustomerAccountFields from './CustomerAccountFields.vue'
import CustomerAttachments from './CustomerAttachments.vue'
import {
  dclApprovalEventActionText,
  dclApprovalStatusText,
} from '../shared/declaration'
import {
  customerAccountActiveVersion,
  useDclCustomerAccountViewModel,
} from './vm'
import type { DclCustomerAccountListItem } from './types'

const vm = reactive(useDclCustomerAccountViewModel())
const reasonTarget = ref<{
  row: DclCustomerAccountListItem
  action: 'reject' | 'unapprove'
} | null>(null)
const reason = ref('')
const columns: readonly BusinessObjectColumn<DclCustomerAccountListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  {
    key: 'name',
    label: '账户名称',
    value: (row) => customerAccountActiveVersion(row).data.name,
  },
  {
    key: 'customer',
    label: '客户关系 ID',
    value: (row) => row.customerRelationshipId,
  },
  {
    key: 'type',
    label: '客户类型',
    value: (row) => customerAccountActiveVersion(row).data.customerType.name,
  },
  {
    key: 'status',
    label: '审核状态',
    value: (row) =>
      dclApprovalStatusText[customerAccountActiveVersion(row).approval.status],
  },
]

function actions(row: DclCustomerAccountListItem): ListRowAction[] {
  const available = vm.actionAvailability(row)
  const result: ListRowAction[] = available.view
    ? [{ key: 'view', label: '查看', icon: 'mdi-eye-outline' }]
    : []
  if (available.edit)
    result.push({ key: 'edit', label: '编辑', icon: 'mdi-pencil-outline' })
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

function selectAction(action: string, row: DclCustomerAccountListItem): void {
  if (action === 'view' || action === 'edit')
    void vm.openById(row.objectId, action)
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
      search-label="结算子账户编码或名称"
      :total="vm.total"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-text-field
          v-model="vm.customerRelationshipId"
          clearable
          label="客户关系 ID（新建时必填）"
          variant="outlined"
        />
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :actions="actions(row)"
          :label="`操作 ${row.code}`"
          :more-label="`更多操作 ${row.code}`"
          @select="selectAction($event, row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.drawerOpen"
    location="end"
    temporary
    width="920"
  >
    <v-card
      flat
      :title="
        vm.editorMode === 'create'
          ? '新建客户结算子账户申报'
          : `${vm.currentView?.code ?? ''} 客户结算子账户申报`
      "
    >
      <v-card-text>
        <CustomerAccountFields
          v-if="vm.editorMode !== 'view'"
          v-model="vm.editorForm"
        />
        <v-list v-else-if="vm.currentView" density="compact">
          <v-list-item title="账户名称" :subtitle="vm.currentView.data.name" />
          <v-list-item
            title="客户类型"
            :subtitle="`${vm.currentView.data.customerType.code} · ${vm.currentView.data.customerType.name}`"
          />
          <v-list-item
            title="联系人"
            :subtitle="vm.currentView.data.contactName ?? '—'"
          />
          <v-list-item
            title="业务归属"
            :subtitle="vm.currentView.data.primarySalesAttribution.subjectName"
          />
          <v-list-item
            title="信用额度"
            :subtitle="vm.currentView.data.creditLimits[0]?.amount ?? '—'"
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
        <CustomerAttachments
          v-if="vm.currentView"
          class="mt-4"
          scope="CUSTOMER_ACCOUNT"
          :owner-approval-entry-id="vm.currentView.approval.approvalEntryId"
          :approval-revision="vm.currentView.approval.revision"
          :attachments="vm.currentView.attachments"
          :editable="vm.currentView.approval.status === 'DRAFT'"
          @changed="
            vm.openById(
              vm.currentView.objectId,
              vm.editorMode === 'edit' ? 'edit' : 'view',
            )
          "
        />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.drawerOpen = false">关闭</v-btn
        ><v-btn
          v-if="vm.editorMode !== 'view'"
          color="primary"
          :loading="vm.saving"
          @click="vm.save"
          >保存草稿</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-navigation-drawer>
  <v-dialog v-model="vm.versionsOpen" max-width="720">
    <v-card title="客户结算子账户版本历史">
      <v-list density="compact">
        <v-list-item
          v-for="version in vm.versions"
          :key="version.approval.approvalEntryId"
          :title="`V${version.approval.versionNo} · ${dclApprovalStatusText[version.approval.status]}`"
          :subtitle="`${version.data.name} · ${version.approval.updatedAt}`"
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
    <v-card title="客户结算子账户审核历史">
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
