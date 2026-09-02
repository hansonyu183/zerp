<script setup lang="ts">
import { reactive, ref } from 'vue'
import { BusinessObjectList } from '@/components/business-object'
import type { BusinessObjectColumn } from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import CustomerAttachments from '../customer-subunit/CustomerAttachments.vue'
import CustomerForm from './CustomerForm.vue'
import { approvalActionPresentation, approvalEventActionLabels, approvalStatusPresentation } from '@/shared/approval'
import type { DclCustomerListItem } from './data'
import { customerActiveVersion, customerPrimaryAction, useDclCustomerViewModel } from './vm'

const vm = reactive(useDclCustomerViewModel())
const reasonTarget = ref<{ row: DclCustomerListItem; action: 'reject' | 'unapprove' } | null>(null)
const reason = ref('')
const columns: readonly BusinessObjectColumn<DclCustomerListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  { key: 'name', label: '名称', value: (row) => row.displayName },
  { key: 'operatingEntity', label: '默认经营主体', value: (row) => `${row.defaultOperatingEntityCode} · ${row.defaultOperatingEntityName}` },
  { key: 'status', label: '审核状态', value: (row) => approvalStatusPresentation[customerActiveVersion(row).approval.status].label },
]

function actions(row: DclCustomerListItem): ListRowAction[] {
  const available = vm.actionAvailability(row)
  const primary = customerPrimaryAction(row, vm.canEdit)
  const result: ListRowAction[] = available.view ? [primary] : []
  for (const action of ['submit', 'approve', 'reject', 'unsubmit', 'unapprove'] as const)
    if (available[action]) result.push({ key: action, ...approvalActionPresentation[action] })
  if (available.delete) result.push({ key: 'delete', label: '删除草稿', icon: 'mdi-delete-outline', color: 'error' })
  if (available.versions) result.push({ key: 'versions', label: '版本历史', icon: 'mdi-history' })
  if (available.audit) result.push({ key: 'audit', label: '审核历史', icon: 'mdi-clipboard-text-clock-outline' })
  return result
}
function selectAction(action: string, row: DclCustomerListItem) {
  if (action === 'view' || action === 'edit') void vm.openById(row.objectId, action)
  else if (action === 'versions') void vm.openVersions(row)
  else if (action === 'audit') void vm.openAudit(row)
  else if (action === 'delete') void vm.remove(row)
  else if (action === 'reject' || action === 'unapprove') { reasonTarget.value = { row, action }; reason.value = '' }
  else if (action === 'submit' || action === 'unsubmit' || action === 'approve') void vm.runAction(row, action)
}
async function confirmReason() {
  const target = reasonTarget.value
  if (!target || !reason.value.trim()) return
  if (await vm.runAction(target.row, target.action, reason.value)) reasonTarget.value = null
}
void vm.query()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar :message="vm.successMessage" type="success" @dismiss="vm.successMessage = null" />
    <BusinessObjectList :columns="columns" :creatable="vm.canCreate" :deletable="false" :editable="(row) => actions(row).length > 0" :keyword="vm.keyword" :loading="vm.loading" :page="vm.page" :page-size="vm.pageSize" :row-key="(row) => row.objectId" :rows="vm.rows" search-label="客户编码或名称" :total="vm.total" @apply-filters="vm.search" @create="vm.openCreate" @query="vm.search" @update:keyword="vm.keyword = $event" @update:page="vm.changePage">
      <template #filters><v-select v-model="vm.enabled" clearable :items="[{ title: '启用', value: true }, { title: '禁用', value: false }]" label="启停状态" variant="outlined" /></template>
      <template #actions="{ row }"><ListRowActions :actions="actions(row)" :label="`操作 ${row.code}`" :loading="vm.actionLoading === row.objectId" :more-label="`更多操作 ${row.code}`" @select="selectAction($event, row)" /></template>
    </BusinessObjectList>
  </v-container>

  <v-dialog v-model="vm.createOpen" max-width="1080" persistent>
    <v-card title="新建客户草稿"><v-card-text><CustomerForm :vm="vm" kind="create" /></v-card-text><v-card-actions><v-spacer /><v-btn @click="vm.createOpen = false">取消</v-btn><v-btn color="primary" :loading="vm.saving" @click="vm.create">创建草稿</v-btn></v-card-actions></v-card>
  </v-dialog>
  <v-navigation-drawer v-model="vm.drawerOpen" location="end" temporary width="920">
    <v-card v-if="vm.currentView" flat :title="vm.editorMode === 'edit' ? '编辑客户' : '查看客户'">
      <v-card-text><CustomerForm :vm="vm" kind="editor" :readonly="!vm.editorEditable" />
        <CustomerAttachments scope="CUSTOMER" :owner-approval-entry-id="vm.currentView.approval.approvalEntryId" :approval-revision="vm.currentView.approval.revision" :attachments="vm.currentView.attachments" :editable="vm.canEditRoot" @changed="vm.openById(vm.currentView!.objectId, vm.editorMode, vm.currentView!.approval.approvalEntryId)" />
      </v-card-text>
      <v-card-actions><v-spacer /><v-btn v-if="vm.canEditRoot" color="primary" :loading="vm.saving" @click="vm.save">保存客户资料</v-btn><v-btn v-if="vm.canEditSubunits" color="primary" variant="tonal" :loading="vm.saving" @click="vm.saveSubunits">保存客户子单位</v-btn><v-btn @click="vm.drawerOpen = false">关闭</v-btn></v-card-actions>
    </v-card>
  </v-navigation-drawer>
  <v-dialog v-model="vm.versionsOpen" max-width="720"><v-card title="客户版本历史"><v-list density="compact"><v-list-item v-for="version in vm.versions" :key="version.approval.approvalEntryId" :title="`V${version.approval.versionNo} · ${approvalStatusPresentation[version.approval.status].label}`" :subtitle="version.approval.updatedAt" /></v-list><v-card-actions><v-spacer /><v-btn @click="vm.versionsOpen = false">关闭</v-btn></v-card-actions></v-card></v-dialog>
  <v-dialog v-model="vm.auditOpen" max-width="720"><v-card title="客户审核历史"><v-list density="compact"><v-list-item v-for="event in vm.auditEvents" :key="event.id" :title="approvalEventActionLabels[event.action]" :subtitle="`${event.createdAt}${event.reason ? ` · ${event.reason}` : ''}`" /></v-list><v-card-actions><v-spacer /><v-btn @click="vm.auditOpen = false">关闭</v-btn></v-card-actions></v-card></v-dialog>
  <v-dialog :model-value="Boolean(reasonTarget)" max-width="620" @update:model-value="(value) => { if (!value) reasonTarget = null }"><v-card :title="approvalActionPresentation[reasonTarget?.action ?? 'reject'].label"><v-card-text><v-textarea v-model="reason" label="原因" maxlength="1000" counter required /></v-card-text><v-card-actions><v-spacer /><v-btn @click="reasonTarget = null">取消</v-btn><v-btn :color="approvalActionPresentation[reasonTarget?.action ?? 'reject'].color" :disabled="!reason.trim()" @click="confirmReason">确认</v-btn></v-card-actions></v-card></v-dialog>
</template>
