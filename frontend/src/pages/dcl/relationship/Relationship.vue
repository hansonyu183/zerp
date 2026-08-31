<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BusinessObjectEditor,
  BusinessObjectList,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { approvalStatusPresentation } from '@/shared/approval'
import { formatLocalDateTime } from '@/utils/date'
import {
  dclRelationshipActiveVersion,
  type DclRelationshipEntity,
  type DclRelationshipListItem,
} from './types'
import { useDclRelationshipViewModel } from './vm'

const props = defineProps<{
  entity: DclRelationshipEntity
}>()
const vm = reactive(useDclRelationshipViewModel(props.entity))
const route = useRoute()
const router = useRouter()
const deleteTarget = ref<DclRelationshipListItem | null>(null)
const reviewTarget = ref<DclRelationshipListItem | null>(null)
const reviewComment = ref('')
const reverseTarget = ref<DclRelationshipListItem | null>(null)
const reverseAction = ref<'unsubmit' | 'unapprove'>('unsubmit')
const reverseReason = ref('')
const versionsLength = computed(() =>
  Math.max(1, Math.ceil(vm.versionsTotal / vm.versionsPageSize)),
)
const auditLength = computed(() =>
  Math.max(1, Math.ceil(vm.auditTotal / vm.auditPageSize)),
)
watch(
  () => [route.query.objectId, route.query.mode] as const,
  ([objectId, mode]) => {
    if (typeof objectId === 'string')
      void vm.openById(objectId, mode === 'edit' ? 'edit' : 'view')
  },
  { immediate: true },
)
watch(
  () => vm.drawerOpen,
  (open, wasOpen) => {
    if (open || !wasOpen || typeof route.query.objectId !== 'string') return
    const { objectId: _id, mode: _mode, ...query } = route.query
    void router.replace({ query })
  },
)

function actions(row: DclRelationshipListItem): ListRowAction[] {
  const available = vm.actionAvailability(row)
  const result: ListRowAction[] = []
  if (available.edit)
    result.push({
      key: 'edit',
      label: `编辑 ${row.code}`,
      icon: 'mdi-pencil-outline',
      color: 'primary',
    })
  else if (available.view)
    result.push({
      key: 'view',
      label: `查看 ${row.code}`,
      icon: 'mdi-eye-outline',
    })
  if (available.submit)
    result.push({
      key: 'submit',
      label: '提交',
      icon: 'mdi-send-outline',
      color: 'primary',
    })
  if (available.unsubmit)
    result.push({
      key: 'unsubmit',
      label: '撤回',
      icon: 'mdi-undo-variant',
      color: 'warning',
    })
  if (available.approve)
    result.push({
      key: 'approve',
      label: '批准',
      icon: 'mdi-check-decagram-outline',
      color: 'success',
    })
  if (available.unapprove)
    result.push({
      key: 'unapprove',
      label: '反批准',
      icon: 'mdi-backup-restore',
      color: 'warning',
    })
  if (available.reject)
    result.push({
      key: 'reject',
      label: '驳回',
      icon: 'mdi-close-octagon-outline',
      color: 'error',
    })
  if (available.enable || available.disable)
    result.push({
      key: 'toggle-enabled',
      label: available.enable ? '启用' : '禁用',
      icon: available.enable
        ? 'mdi-play-circle-outline'
        : 'mdi-pause-circle-outline',
    })
  if (available.versions)
    result.push({ key: 'versions', label: '版本历史', icon: 'mdi-history' })
  if (available.audit)
    result.push({
      key: 'audit',
      label: '审核历史',
      icon: 'mdi-clipboard-text-clock-outline',
    })
  if (available.delete)
    result.push({
      key: 'delete',
      label: '删除首版草稿',
      icon: 'mdi-delete-outline',
      color: 'error',
    })
  return result
}
function selectAction(action: string, row: DclRelationshipListItem): void {
  if (action === 'edit') void vm.openEdit(row)
  else if (action === 'view') void vm.openView(row)
  else if (action === 'submit') void vm.submitObject(row)
  else if (action === 'approve') void vm.review(row, 'approve', '')
  else if (action === 'reject') {
    reviewTarget.value = row
    reviewComment.value = ''
  } else if (action === 'unsubmit') {
    void vm.reverse(row, 'unsubmit', '')
  } else if (action === 'unapprove') {
    reverseTarget.value = row
    reverseAction.value = 'unapprove'
    reverseReason.value = ''
  } else if (action === 'toggle-enabled') void vm.changeEnabled(row)
  else if (action === 'versions') void vm.openVersions(row)
  else if (action === 'audit') void vm.openAudit(row)
  else if (action === 'delete') deleteTarget.value = row
}
async function confirmDelete() {
  if (deleteTarget.value && (await vm.deleteObject(deleteTarget.value)))
    deleteTarget.value = null
}
async function confirmReview() {
  if (
    reviewTarget.value &&
    (await vm.review(reviewTarget.value, 'reject', reviewComment.value))
  )
    reviewTarget.value = null
}
async function confirmReverse() {
  if (
    reverseTarget.value &&
    (await vm.reverse(
      reverseTarget.value,
      reverseAction.value,
      reverseReason.value,
    ))
  )
    reverseTarget.value = null
}
</script>

<template>
  <v-container fluid class="dcl-relationship-page pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <BusinessObjectList
      :columns="vm.config.columns"
      :creatable="vm.canCreate"
      :editable="vm.hasAnyAction"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(row) => row.objectId"
      :rows="vm.rows"
      :search-label="`${vm.entityLabel}编码或主体名称`"
      :sort="vm.sort"
      :total="vm.total"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
      @update:sort="vm.changeSort"
    >
      <template #filters>
        <v-select
          v-for="field in vm.config.filters"
          :key="field.key"
          v-model="vm.filters[field.key]"
          clearable
          density="comfortable"
          item-title="title"
          item-value="value"
          :items="field.options"
          :label="field.label"
          :multiple="field.multiple"
          variant="outlined"
        />
      </template>
      <template #cell-status="{ row }">
        <div class="dcl-status-chips">
          <v-chip density="comfortable" size="small" variant="tonal">
            {{
              approvalStatusPresentation[
                dclRelationshipActiveVersion(row).approval.status
              ].label
            }}
          </v-chip>
          <v-chip
            v-if="row.latestApproved"
            :color="row.enabled ? 'success' : 'default'"
            density="comfortable"
            size="small"
            variant="tonal"
          >
            {{ row.enabled ? '启用' : '禁用' }}
          </v-chip>
          <v-chip
            v-if="row.openVersion"
            color="warning"
            density="comfortable"
            size="small"
            variant="tonal"
          >
            有候选版本
          </v-chip>
        </div>
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :actions="actions(row)"
          :label="`操作 ${row.code}`"
          :loading="Boolean(vm.actionLoading)"
          :more-label="`更多操作 ${row.code}`"
          @select="selectAction($event, row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.drawerOpen"
    class="dcl-relationship-drawer"
    location="end"
    temporary
    width="760"
  >
    <div class="dcl-relationship-drawer__content">
      <BusinessObjectEditor
        :editable="false"
        :editing="vm.editorMode !== 'view'"
        :error-message="vm.editorErrorMessage"
        :fields="vm.editorFields"
        :loading="vm.editorLoading"
        :model-value="vm.editorModel"
        :reset-key="vm.editorResetKey"
        :saving="vm.saving"
        :title="vm.editorTitle"
        @cancel="vm.closeEditor"
        @reference-search="vm.searchEditorReference"
        @save="vm.save"
      >
        <template #actions="{ cancel, save }">
          <v-btn
            v-if="vm.editorMode === 'view'"
            variant="text"
            @click="vm.closeEditor"
          >
            关闭
          </v-btn>
          <template v-else>
            <v-btn :disabled="vm.saving" variant="text" @click="cancel">
              取消
            </v-btn>
            <v-btn color="primary" :loading="vm.saving" @click="save">
              保存
            </v-btn>
          </template>
        </template>
      </BusinessObjectEditor>
    </div>
  </v-navigation-drawer>

  <v-dialog
    :model-value="Boolean(deleteTarget)"
    max-width="540"
    @update:model-value="
      (value) => {
        if (!value) deleteTarget = null
      }
    "
  >
    <v-card rounded="xl" :title="`确认删除${vm.entityLabel}变更草稿`">
      <v-card-text>
        仅从未提交、从未生效且未被引用的首版草稿可以删除。
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="deleteTarget = null">取消</v-btn>
        <v-btn color="error" @click="confirmDelete">删除草稿</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(reverseTarget)"
    max-width="620"
    @update:model-value="
      (value) => {
        if (!value) reverseTarget = null
      }
    "
  >
    <v-card
      rounded="xl"
      :title="reverseAction === 'unapprove' ? '反批准' : '撤回'"
    >
      <v-card-text>
        <v-textarea
          v-model="reverseReason"
          counter="1000"
          label="原因"
          :maxlength="1000"
          required
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="reverseTarget = null">取消</v-btn>
        <v-btn
          color="warning"
          :disabled="!reverseReason.trim()"
          @click="confirmReverse"
        >
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="Boolean(reviewTarget)"
    max-width="620"
    @update:model-value="
      (value) => {
        if (!value) reviewTarget = null
      }
    "
  >
    <v-card rounded="xl" title="驳回">
      <v-card-text>
        <v-textarea
          v-model="reviewComment"
          counter="1000"
          label="驳回意见"
          :maxlength="1000"
          required
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="reviewTarget = null">取消</v-btn>
        <v-btn
          color="error"
          :disabled="!reviewComment.trim()"
          @click="confirmReview"
        >
          确认驳回
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.versionsOpen" max-width="980">
    <v-card rounded="xl" title="版本历史">
      <v-progress-linear
        :active="vm.versionsLoading"
        color="primary"
        indeterminate
      />
      <v-card-text>
        <v-table class="responsive-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>状态</th>
              <th>业务资料</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in vm.versions"
              :key="item.approval.approvalEntryId"
            >
              <td>V{{ item.approval.versionNo }}</td>
              <td>
                {{ approvalStatusPresentation[item.approval.status].label }}
              </td>
              <td>{{ vm.versionSummary(item) }}</td>
              <td>{{ formatLocalDateTime(item.approval.updatedAt) }}</td>
            </tr>
          </tbody>
        </v-table>
        <v-pagination
          v-if="vm.versionsTotal > vm.versionsPageSize"
          :length="versionsLength"
          :model-value="vm.versionsPage"
          @update:model-value="vm.changeVersionsPage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.versionsOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.auditOpen" max-width="1080">
    <v-card rounded="xl" title="审核历史">
      <v-progress-linear
        :active="vm.auditLoading"
        color="primary"
        indeterminate
      />
      <v-card-text>
        <v-table class="responsive-table">
          <thead>
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
              <td>{{ event.action }}</td>
              <td>
                {{
                  event.fromStatus
                    ? approvalStatusPresentation[event.fromStatus].label
                    : '—'
                }}
                →
                {{
                  event.toStatus
                    ? approvalStatusPresentation[event.toStatus].label
                    : '—'
                }}
              </td>
              <td>{{ event.actorId }}</td>
              <td>{{ formatLocalDateTime(event.createdAt) }}</td>
              <td>{{ event.reason || '—' }}</td>
            </tr>
          </tbody>
        </v-table>
        <v-pagination
          v-if="vm.auditTotal > vm.auditPageSize"
          :length="auditLength"
          :model-value="vm.auditPage"
          @update:model-value="vm.changeAuditPage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.auditOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.dcl-relationship-drawer {
  background: rgb(var(--v-theme-background));
}
.dcl-relationship-drawer__content {
  padding: 20px;
}
.dcl-status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
@media (max-width: 640px) {
  .dcl-relationship-drawer {
    width: 100vw !important;
    max-width: 100vw !important;
  }
  .dcl-relationship-drawer__content {
    padding: 12px;
  }
}
</style>
