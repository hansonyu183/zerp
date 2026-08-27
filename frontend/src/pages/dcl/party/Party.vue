<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import type { components } from '@/api/generated/schema'
import { formatLocalDateTime } from '@/utils/date'
import { useDclPartyViewModel } from './vm'

const vm = reactive(useDclPartyViewModel())
const route = useRoute()
const router = useRouter()
const reasonTarget = ref<{
  row: components['schemas']['DclPartyListItem']
  action: 'unsubmit' | 'reject' | 'unapprove'
} | null>(null)
const reason = ref('')
type DclPartyListItem = components['schemas']['DclPartyListItem']
type DclPartyMergeRelationshipConflict =
  components['schemas']['DclPartyMergeRelationshipConflict']
const statusText: Record<components['schemas']['ApprovalStatus'], string> = {
  DRAFT: '草稿',
  PENDING: '待批准',
  APPROVED: '已批准',
}
const relationshipLabels: Record<
  DclPartyMergeRelationshipConflict['relationshipType'],
  string
> = {
  customer: '客户关系',
  supplier: '供应关系',
  employee: '雇佣关系',
  'other-unit': '服务关系',
  'sales-partner': '销售合作关系',
}
const kindItems = [
  { title: '个人', value: 'PERSON' },
  { title: '组织', value: 'ORGANIZATION' },
]
const identifierTypeItems = [
  { title: '身份证件号', value: 'PERSON_ID' },
  { title: '统一社会信用代码', value: 'UNIFIED_SOCIAL_CREDIT_CODE' },
]
const columns: readonly BusinessObjectColumn<DclPartyListItem>[] = [
  {
    key: 'name',
    label: '主体',
    value: (row) =>
      active(row)?.data.displayName ?? active(row)?.data.legalName ?? '—',
  },
  {
    key: 'legalName',
    label: '法定名称',
    value: (row) => active(row)?.data.legalName ?? '—',
  },
  {
    key: 'status',
    label: '状态',
    value: (row) => active(row)?.approval.status ?? '—',
    sizing: 'compact',
  },
]
const versionsLength = computed(() =>
  Math.max(1, Math.ceil(vm.versionsTotal / 20)),
)
const auditLength = computed(() => Math.max(1, Math.ceil(vm.auditTotal / 20)))

function active(row: DclPartyListItem) {
  return row.openVersion ?? row.latestApproved
}
function rowName(row: DclPartyListItem): string {
  return (
    active(row)?.data.displayName || active(row)?.data.legalName || row.partyId
  )
}
function rowActions(row: DclPartyListItem): ListRowAction[] {
  const allowed = vm.permissions(row)
  return [
    ...(allowed.edit
      ? [
          {
            key: 'edit',
            label: `编辑 ${rowName(row)}`,
            icon: 'mdi-pencil-outline',
            color: 'primary' as const,
          },
        ]
      : allowed.view
        ? [
            {
              key: 'view',
              label: `查看 ${rowName(row)}`,
              icon: 'mdi-eye-outline',
            },
          ]
        : []),
    ...(allowed.submit
      ? [
          {
            key: 'submit',
            label: '提交审核',
            icon: 'mdi-send-outline',
            color: 'primary' as const,
          },
        ]
      : []),
    ...(allowed.unsubmit
      ? [
          {
            key: 'unsubmit',
            label: '撤回提交',
            icon: 'mdi-undo-variant',
            color: 'warning' as const,
          },
        ]
      : []),
    ...(allowed.approve
      ? [
          {
            key: 'approve',
            label: '审核通过',
            icon: 'mdi-check-decagram-outline',
            color: 'success' as const,
          },
        ]
      : []),
    ...(allowed.reject
      ? [
          {
            key: 'reject',
            label: '审核驳回',
            icon: 'mdi-close-octagon-outline',
            color: 'error' as const,
          },
        ]
      : []),
    ...(allowed.unapprove
      ? [
          {
            key: 'unapprove',
            label: '撤销批准',
            icon: 'mdi-backup-restore',
            color: 'warning' as const,
          },
        ]
      : []),
    ...(allowed.versions
      ? [{ key: 'versions', label: '版本历史', icon: 'mdi-history' }]
      : []),
    ...(allowed.audit
      ? [
          {
            key: 'audit',
            label: '审核历史',
            icon: 'mdi-clipboard-text-clock-outline',
          },
        ]
      : []),
    ...(allowed.delete
      ? [
          {
            key: 'delete',
            label: '删除候选草稿',
            icon: 'mdi-delete-outline',
            color: 'error' as const,
          },
        ]
      : []),
  ]
}
function selectAction(action: string, row: DclPartyListItem): void {
  if (action === 'view') void vm.open(row, 'view')
  else if (action === 'edit') void vm.open(row, 'edit')
  else if (action === 'versions') void vm.openVersions(row)
  else if (action === 'audit') void vm.openAudit(row)
  else if (
    action === 'unsubmit' ||
    action === 'reject' ||
    action === 'unapprove'
  ) {
    reasonTarget.value = { row, action }
    reason.value = ''
  } else if (action === 'delete') {
    if (window.confirm('删除当前候选草稿，确认继续？'))
      void vm.runAction(row, 'delete')
  } else if (action === 'submit' || action === 'approve')
    void vm.runAction(row, action)
}
async function confirmReason(): Promise<void> {
  if (
    reasonTarget.value &&
    (await vm.runAction(
      reasonTarget.value.row,
      reasonTarget.value.action,
      reason.value,
    ))
  ) {
    reasonTarget.value = null
    reason.value = ''
  }
}
function setConflictResolution(
  conflict: DclPartyMergeRelationshipConflict,
  objectId: string | null,
): void {
  if (objectId) vm.mergeResolutions[vm.conflictKey(conflict)] = objectId
}
async function confirmMerge(): Promise<void> {
  if (
    window.confirm(
      '主体合并不可撤销。来源主体将永久只读，历史单据不改写；确认执行？',
    )
  )
    await vm.confirmMerge()
}

onMounted(() => void vm.query())
watch(
  () => [route.query.partyId, route.query.mode] as const,
  ([partyId, mode]) => {
    if (typeof partyId === 'string')
      void vm.openById(partyId, mode === 'edit' ? 'edit' : 'view')
  },
  { immediate: true },
)
watch(
  () => vm.drawerOpen,
  (open, wasOpen) => {
    if (open || !wasOpen || typeof route.query.partyId !== 'string') return
    const { partyId: _partyId, mode: _mode, ...query } = route.query
    void router.replace({ query })
  },
)
</script>

<template>
  <v-container fluid class="dcl-party-page pa-3 pa-md-6">
    <v-card
      ><v-card-title>主体申报</v-card-title
      ><v-card-text>
        <v-alert type="info" variant="tonal" class="mb-4"
          >主体只能由首条强类型关系原子创建；此处不提供单独新建。保存、候选、审批与合并均在本页完成。</v-alert
        >
        <BusinessObjectList
          :columns="columns"
          :editable="(row) => rowActions(row).length > 0"
          empty-text="暂无主体申报"
          :keyword="vm.keywordDraft"
          :loading="vm.loading"
          :page="vm.page"
          :page-size="20"
          :row-key="(row) => row.partyId"
          :rows="vm.rows"
          search-label="名称、电话、邮箱或地址"
          :total="vm.total"
          @apply-filters="vm.submitFilters"
          @query="vm.submitFilters"
          @reset-filters="vm.resetFilters"
          @update:keyword="vm.keywordDraft = $event"
          @update:page="
            (value) => {
              vm.page = value
              void vm.query()
            }
          "
        >
          <template #filters
            ><v-select
              v-model="vm.kindDraft"
              :items="kindItems"
              label="主体类型"
              clearable
              hide-details /><v-checkbox
              v-model="vm.mergedDraft"
              label="仅查看已合并主体"
              hide-details
          /></template>
          <template #cell-status="{ row }"
            ><v-chip v-if="active(row)" size="small" variant="tonal">{{
              statusText[active(row)?.approval.status ?? 'DRAFT']
            }}</v-chip
            ><v-chip
              v-if="row.latestApproved"
              size="small"
              color="success"
              variant="tonal"
              class="ml-1"
              >当前 V{{ row.latestApproved.approval.versionNo }}</v-chip
            ><v-chip
              v-if="row.openVersion"
              size="small"
              color="warning"
              variant="tonal"
              class="ml-1"
              >候选 V{{ row.openVersion.approval.versionNo }}</v-chip
            ></template
          >
          <template #actions="{ row }"
            ><ListRowActions
              :actions="rowActions(row)"
              :label="`操作 ${rowName(row)}`"
              :loading="Boolean(vm.actionLoading)"
              @select="selectAction($event, row)"
          /></template>
        </BusinessObjectList> </v-card-text
    ></v-card>

    <v-navigation-drawer
      v-model="vm.drawerOpen"
      class="dcl-party-drawer"
      location="end"
      temporary
      width="760"
      ><div class="pa-4">
        <v-progress-linear
          :active="vm.editorLoading"
          indeterminate
          color="primary"
        />
        <template v-if="vm.currentView && vm.form">
          <v-card v-if="vm.effectiveView" variant="outlined" class="mb-4"
            ><v-card-title class="text-subtitle-1"
              >当前交易使用：V{{
                vm.effectiveView.approval.versionNo
              }}</v-card-title
            ><v-card-text
              ><strong>{{
                vm.effectiveView.data.displayName ||
                vm.effectiveView.data.legalName
              }}</strong>
              · {{ vm.effectiveView.data.legalName }}</v-card-text
            ></v-card
          >
          <v-alert
            v-if="vm.effectiveView"
            type="warning"
            variant="tonal"
            class="mb-4"
            >下方为候选版本。候选批准前，新交易继续使用上方当前版本。</v-alert
          >
          <v-card
            ><v-card-title
              >{{
                vm.editorMode === 'edit' ? '编辑主体申报' : '主体申报详情'
              }}
              · V{{ vm.currentView.approval.versionNo }}</v-card-title
            ><v-card-text>
              <v-alert
                v-if="vm.currentView.mergedIntoPartyId"
                type="warning"
                variant="tonal"
                class="mb-4"
                >该主体已合并并永久只读；保留主体 ID：{{
                  vm.currentView.mergedIntoPartyId
                }}。</v-alert
              >
              <v-alert type="info" variant="tonal" class="mb-4"
                >本次修改会影响未来业务。影响预览仅显示您当前有权读取的关系，历史单据快照不会改变。</v-alert
              >
              <v-row dense
                ><v-col cols="12" sm="4"
                  ><v-select
                    v-model="vm.form.kind"
                    :items="kindItems"
                    label="主体类型"
                    :disabled="vm.editorMode !== 'edit'" /></v-col
                ><v-col cols="12" sm="8"
                  ><v-text-field
                    v-model="vm.form.legalName"
                    label="法定名称"
                    :disabled="vm.editorMode !== 'edit'" /></v-col
                ><v-col cols="12" sm="6"
                  ><v-text-field
                    v-model="vm.form.displayName"
                    label="显示名称"
                    :disabled="vm.editorMode !== 'edit'" /></v-col
                ><v-col cols="12" sm="6"
                  ><v-text-field
                    v-model="vm.form.taxNumber"
                    label="税号"
                    :disabled="vm.editorMode !== 'edit'" /></v-col
              ></v-row>
              <div class="d-flex align-center mt-2 mb-1">
                <span class="text-subtitle-1">强标识</span><v-spacer /><v-btn
                  v-if="vm.editorMode === 'edit'"
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-plus"
                  @click="vm.addIdentifier"
                  >添加强标识</v-btn
                >
              </div>
              <v-row
                v-for="(identifier, index) in vm.form.strongIdentifiers"
                :key="index"
                dense
                ><v-col cols="12" sm="4"
                  ><v-select
                    v-model="identifier.type"
                    :items="identifierTypeItems"
                    label="类型"
                    :disabled="vm.editorMode !== 'edit'" /></v-col
                ><v-col cols="10" sm="7"
                  ><v-text-field
                    v-model="identifier.value"
                    label="标识值"
                    :disabled="vm.editorMode !== 'edit'" /></v-col
                ><v-col cols="2" sm="1"
                  ><v-btn
                    v-if="vm.editorMode === 'edit'"
                    icon="mdi-delete-outline"
                    variant="text"
                    @click="vm.removeIdentifier(index)" /></v-col
              ></v-row>
              <v-row dense
                ><v-col cols="12" sm="6"
                  ><v-text-field
                    v-model="vm.form.phone"
                    label="通用电话"
                    :disabled="vm.editorMode !== 'edit'" /></v-col
                ><v-col cols="12" sm="6"
                  ><v-text-field
                    v-model="vm.form.email"
                    label="通用邮箱"
                    :disabled="vm.editorMode !== 'edit'" /></v-col
                ><v-col cols="12"
                  ><v-textarea
                    v-model="vm.form.address"
                    label="通用地址"
                    rows="2"
                    :disabled="vm.editorMode !== 'edit'" /></v-col
              ></v-row>
              <div class="text-subtitle-1 mt-4 mb-2">受影响的当前可见关系</div>
              <v-row dense
                ><v-col
                  v-for="relation in vm.currentView.impactRelationships"
                  :key="relation.objectId"
                  cols="12"
                  sm="6"
                  ><v-card variant="outlined"
                    ><v-card-text
                      ><div class="font-weight-medium">
                        {{ relation.code }} ·
                        {{ relationshipLabels[relation.entity] }}
                      </div>
                      <div class="text-medium-emphasis">
                        {{ relation.operatingEntityName }}
                      </div></v-card-text
                    ></v-card
                  ></v-col
                ><v-col
                  v-if="!vm.currentView.impactRelationships.length"
                  cols="12"
                  class="text-medium-emphasis"
                  >没有当前权限可见的受影响关系。</v-col
                ></v-row
              > </v-card-text
            ><v-card-actions
              ><v-btn
                v-if="vm.canMerge && !vm.currentView.mergedIntoPartyId"
                color="error"
                variant="tonal"
                @click="vm.openMerge"
                >合并重复主体</v-btn
              ><v-spacer /><v-btn @click="vm.closeEditor">关闭</v-btn
              ><v-btn
                v-if="vm.editorMode === 'edit'"
                color="primary"
                :loading="vm.saving"
                :disabled="!vm.form.legalName.trim()"
                @click="vm.save"
                >保存候选</v-btn
              ></v-card-actions
            ></v-card
          >
        </template>
        <v-alert
          v-if="vm.editorErrorMessage"
          type="error"
          variant="tonal"
          class="mt-3"
          >{{ vm.editorErrorMessage }}</v-alert
        >
      </div></v-navigation-drawer
    >

    <v-dialog v-model="vm.mergeOpen" max-width="860"
      ><v-card
        ><v-card-title>合并重复主体</v-card-title
        ><v-card-text
          ><v-alert type="warning" variant="tonal" class="mb-4"
            >来源和保留主体都必须是当前已批准版本且没有候选。预检绑定双方
            Approval Entry 与 revision；任何变化都会使预检失效。</v-alert
          ><v-row dense
            ><v-col cols="12" sm="8"
              ><v-text-field
                v-model="vm.mergeTargetKeyword"
                label="按名称查找保留主体"
                @keyup.enter="vm.searchMergeTargets" /></v-col
            ><v-col cols="12" sm="4"
              ><v-btn block variant="tonal" @click="vm.searchMergeTargets"
                >查找</v-btn
              ></v-col
            ><v-col cols="12"
              ><v-select
                :model-value="vm.mergeTarget?.partyId"
                :items="
                  vm.mergeTargetRows.map((item) => ({
                    title: rowName(item),
                    value: item.partyId,
                  }))
                "
                label="保留主体"
                @update:model-value="vm.selectMergeTarget" /></v-col></v-row
          ><v-btn
            color="primary"
            variant="tonal"
            :disabled="!vm.mergeTarget"
            :loading="vm.saving"
            @click="vm.preflightMerge"
            >执行合并预检</v-btn
          ><template v-if="vm.mergePreflight"
            ><v-alert
              v-if="vm.mergePreflight.blockReasons.length"
              type="error"
              variant="tonal"
              class="mt-4"
              ><div v-for="item in vm.mergePreflight.blockReasons" :key="item">
                {{ item }}
              </div></v-alert
            ><v-alert v-else type="success" variant="tonal" class="mt-4"
              >预检通过。请为每个关系冲突显式选择保留关系。</v-alert
            ><v-card
              v-for="conflict in vm.mergePreflight.relationshipConflicts"
              :key="vm.conflictKey(conflict)"
              variant="outlined"
              class="mt-3"
              ><v-card-text
                ><div class="font-weight-medium">
                  {{ relationshipLabels[conflict.relationshipType] }} ·
                  {{ conflict.operatingEntityName }}
                </div>
                <v-radio-group
                  :model-value="vm.mergeResolutions[vm.conflictKey(conflict)]"
                  @update:model-value="setConflictResolution(conflict, $event)"
                  ><v-radio
                    :label="`保留来源关系 ${conflict.sourceObjectCode}`"
                    :value="conflict.sourceObjectId" /><v-radio
                    :label="`保留目标关系 ${conflict.targetObjectCode}`"
                    :value="
                      conflict.targetObjectId
                    " /></v-radio-group></v-card-text></v-card></template></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn @click="vm.closeMerge">取消</v-btn
          ><v-btn
            v-if="vm.mergePreflight?.canMerge"
            color="error"
            :loading="vm.saving"
            @click="confirmMerge"
            >确认合并</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-dialog :model-value="Boolean(reasonTarget)" max-width="620"
      ><v-card
        :title="
          reasonTarget?.action === 'reject'
            ? '审核驳回'
            : reasonTarget?.action === 'unapprove'
              ? '撤销批准'
              : '撤回提交'
        "
        ><v-card-text
          ><v-textarea
            v-model="reason"
            :label="reasonTarget?.action === 'reject' ? '驳回意见' : '原因'"
            :maxlength="1000"
            counter="1000" /></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn @click="reasonTarget = null">取消</v-btn
          ><v-btn
            :color="reasonTarget?.action === 'reject' ? 'error' : 'warning'"
            :disabled="!reason.trim()"
            @click="confirmReason"
            >确认</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-dialog v-model="vm.versionsOpen" max-width="900"
      ><v-card title="版本历史"
        ><v-progress-linear
          :active="vm.versionsLoading"
          indeterminate
        /><v-card-text
          ><v-table class="responsive-table"
            ><thead>
              <tr>
                <th>版本</th>
                <th>状态</th>
                <th>法定名称</th>
                <th>更新</th>
                <th class="text-end">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in vm.versions"
                :key="item.approval.approvalEntryId"
              >
                <td data-label="版本">V{{ item.approval.versionNo }}</td>
                <td data-label="状态">
                  {{ statusText[item.approval.status] }}
                </td>
                <td data-label="法定名称">{{ item.data.legalName }}</td>
                <td data-label="更新">
                  {{ formatLocalDateTime(item.approval.updatedAt) }}
                </td>
                <td data-label="操作" class="text-end">
                  <v-btn
                    variant="text"
                    @click="
                      vm.openHistoryVersion(item.approval.approvalEntryId)
                    "
                  >
                    查看
                  </v-btn>
                </td>
              </tr>
            </tbody></v-table
          ><v-pagination
            v-if="vm.versionsTotal > 20"
            :length="versionsLength"
            :model-value="vm.versionsPage"
            @update:model-value="
              (value) => {
                vm.versionsPage = value
                void vm.loadVersions()
              }
            " /></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn @click="vm.versionsOpen = false"
            >关闭</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-dialog v-model="vm.auditOpen" max-width="1000"
      ><v-card title="审核历史"
        ><v-progress-linear
          :active="vm.auditLoading"
          indeterminate
        /><v-card-text
          ><v-table class="responsive-table"
            ><thead>
              <tr>
                <th>事件</th>
                <th>变化</th>
                <th>操作人</th>
                <th>时间</th>
                <th>意见</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in vm.auditEvents" :key="event.id">
                <td data-label="事件">{{ event.action }}</td>
                <td data-label="变化">
                  {{ event.fromStatus ? statusText[event.fromStatus] : '—' }} →
                  {{ event.toStatus ? statusText[event.toStatus] : '—' }}
                </td>
                <td data-label="操作人">{{ event.actorId }}</td>
                <td data-label="时间">
                  {{ formatLocalDateTime(event.createdAt) }}
                </td>
                <td data-label="意见">{{ event.reason || '—' }}</td>
              </tr>
            </tbody></v-table
          ><v-pagination
            v-if="vm.auditTotal > 20"
            :length="auditLength"
            :model-value="vm.auditPage"
            @update:model-value="
              (value) => {
                vm.auditPage = value
                void vm.loadAudit()
              }
            " /></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn @click="vm.auditOpen = false"
            >关闭</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
    <AppSnackbar v-model="vm.errorMessage" color="error" /><AppSnackbar
      v-model="vm.successMessage"
      color="success"
    />
  </v-container>
</template>

<style scoped>
.dcl-party-drawer {
  background: rgb(var(--v-theme-background));
}
@media (max-width: 700px) {
  .dcl-party-drawer {
    width: 100vw !important;
    max-width: 100vw !important;
  }
}
</style>
