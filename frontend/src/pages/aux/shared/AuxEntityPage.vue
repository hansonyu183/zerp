<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  BusinessObjectEditor,
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import {
  approvalActionLabels,
  approvalStatusPresentation,
  type ApprovalAction,
} from '@/shared/approval'
import { formatLocalDateTime } from '@/utils/date'
import {
  auxListActiveVersion,
  type AuxEntityViewModel,
  type AuxListItem,
} from './vm'

const props = defineProps<{ model: AuxEntityViewModel }>()
const vm = reactive(props.model)
const reasonTarget = ref<AuxListItem | null>(null)
const reasonAction = ref<'reject' | 'unapprove'>('reject')
const reason = ref('')
const versionsLength = computed(() =>
  Math.max(1, Math.ceil(vm.versionsTotal / vm.versionsPageSize)),
)
const auditLength = computed(() =>
  Math.max(1, Math.ceil(vm.auditTotal / vm.auditPageSize)),
)
const columns: readonly BusinessObjectColumn<AuxListItem>[] = [
  { key: 'code', label: '编码', value: (item) => item.code },
  {
    key: 'displayName',
    label: '名称',
    value: (item) => auxListActiveVersion(item)?.data.name ?? '—',
  },
  ...(vm.config.listFields ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    value: (item: AuxListItem) =>
      auxListActiveVersion(item)?.data[field.key] ?? '—',
    format: field.format,
  })),
  {
    key: 'approvalStatus',
    label: '审批状态',
    value: (item) => {
      const version = auxListActiveVersion(item)
      return version
        ? approvalStatusPresentation[version.approval.status].label
        : '无批准版本'
    },
  },
  { key: 'enabled', label: '状态', value: (item) => item.enabled },
]

function rowActions(item: AuxListItem): ListRowAction[] {
  const approvalActions = vm.approvalActions(item)
  return [
    ...(vm.canSave && auxListActiveVersion(item)?.approval.status !== 'PENDING'
      ? [
          {
            key: 'edit',
            label: '查看 / 编辑',
            icon: 'mdi-pencil-outline',
            color: 'primary',
          },
        ]
      : []),
    ...approvalActions.map((action) => ({
      key: action,
      label: approvalActionLabels[action],
      icon:
        action === 'approve'
          ? 'mdi-check-decagram-outline'
          : action === 'reject'
            ? 'mdi-close-octagon-outline'
            : action === 'submit'
              ? 'mdi-send-outline'
              : 'mdi-undo-variant',
      color:
        action === 'approve'
          ? 'success'
          : action === 'reject'
            ? 'error'
            : 'warning',
    })),
    ...((item.enabled ? vm.canDisable : vm.canEnable)
      ? [
          {
            key: 'toggle',
            label: item.enabled ? '停用' : '启用',
            icon: item.enabled
              ? 'mdi-pause-circle-outline'
              : 'mdi-play-circle-outline',
          },
        ]
      : []),
    ...(vm.canVersions
      ? [{ key: 'versions', label: '版本历史', icon: 'mdi-history' }]
      : []),
    ...(vm.canAuditHistory
      ? [
          {
            key: 'audit',
            label: '审批历史',
            icon: 'mdi-clipboard-text-clock-outline',
          },
        ]
      : []),
    ...(vm.canDelete && auxListActiveVersion(item)?.approval.status === 'DRAFT'
      ? [
          {
            key: 'delete',
            label: '删除草稿',
            icon: 'mdi-delete-outline',
            color: 'error',
          },
        ]
      : []),
  ]
}

function selectAction(action: string, item: (typeof vm.rows)[number]): void {
  if (action === 'edit') vm.openEdit(item)
  else if (action === 'toggle') void vm.changeEnabled(item)
  else if (action === 'delete') void vm.deleteObject(item)
  else if (action === 'versions') void vm.openVersions(item)
  else if (action === 'audit') void vm.openAuditHistory(item)
  else if (action === 'reject' || action === 'unapprove') {
    reasonTarget.value = item
    reasonAction.value = action
    reason.value = ''
  } else void vm.runApprovalAction(item, action as ApprovalAction)
}

async function confirmReasonAction(): Promise<void> {
  const target = reasonTarget.value
  if (
    target &&
    (await vm.runApprovalAction(target, reasonAction.value, reason.value))
  ) {
    reasonTarget.value = null
    reason.value = ''
  }
}

void vm.query()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />

    <BusinessObjectList
      :columns="columns"
      :creatable="vm.canCreate"
      :deletable="vm.canDelete || vm.canEnable || vm.canDisable"
      :editable="vm.canSave"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(item) => item.objectId"
      :rows="vm.rows"
      :search-label="`${vm.config.title}关键字`"
      :sort="vm.sort"
      :total="vm.total"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
      @update:sort="vm.changeSort({ field: 'code', order: $event.order })"
    >
      <template #filters>
        <v-select
          v-for="field in vm.config.filters ?? []"
          :key="field.key"
          v-model="vm.filterValues[field.key]"
          clearable
          density="comfortable"
          item-title="title"
          item-value="value"
          :items="field.options"
          :label="field.label"
          variant="outlined"
        />
        <v-select
          v-model="vm.enabled"
          clearable
          density="comfortable"
          item-title="title"
          item-value="value"
          :items="[
            { title: '启用', value: true },
            { title: '停用', value: false },
          ]"
          label="状态"
          variant="outlined"
        />
      </template>
      <template #cell-enabled="{ row: item }">
        <v-chip
          :color="item.enabled ? 'success' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ item.enabled ? '启用' : '停用' }}
        </v-chip>
      </template>
      <template #cell-approvalStatus="{ row: item }">
        <v-chip
          v-if="auxListActiveVersion(item)"
          :color="
            approvalStatusPresentation[
              auxListActiveVersion(item)!.approval.status
            ].color
          "
          size="small"
          variant="tonal"
        >
          {{
            approvalStatusPresentation[
              auxListActiveVersion(item)!.approval.status
            ].label
          }}
        </v-chip>
        <span v-else>无批准版本</span>
      </template>
      <template #actions="{ row: item }">
        <ListRowActions
          :actions="rowActions(item)"
          :label="`操作 ${item.code}`"
          @select="selectAction($event, item)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    class="aux-entity-drawer"
    location="end"
    temporary
    width="720"
  >
    <BusinessObjectEditor
      :editable="false"
      editing
      :fields="vm.editorFields"
      :model-value="vm.editorModel"
      :reset-key="vm.editorResetKey"
      :saving="vm.saving"
      :title="vm.editing ? `编辑${vm.config.title}` : `新增${vm.config.title}`"
      @cancel="vm.closeEditor"
      @reference-search="vm.searchEditorReference"
      @save="vm.save"
    />
  </v-navigation-drawer>

  <v-dialog :model-value="reasonTarget !== null" max-width="560">
    <v-card rounded="xl">
      <v-card-title>
        {{ reasonAction === 'reject' ? '驳回候选版本' : '反批准版本' }}
      </v-card-title>
      <v-card-text>
        <v-textarea
          v-model="reason"
          autofocus
          counter="1000"
          label="原因"
          maxlength="1000"
          rows="4"
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="reasonTarget = null">取消</v-btn>
        <v-btn
          color="warning"
          :disabled="!reason.trim()"
          :loading="vm.actionLoading === reasonAction"
          @click="confirmReasonAction"
        >
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.versionsOpen" max-width="900">
    <v-card rounded="xl" title="版本历史">
      <v-progress-linear :active="vm.versionsLoading" indeterminate />
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th>版本</th>
              <th>状态</th>
              <th>名称</th>
              <th>更新时间</th>
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
              <td>{{ item.data.name ?? '—' }}</td>
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
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="vm.versionsOpen = false"
          >关闭</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.auditOpen" max-width="980">
    <v-card rounded="xl" title="审批历史">
      <v-progress-linear :active="vm.auditLoading" indeterminate />
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th>动作</th>
              <th>状态变化</th>
              <th>操作人</th>
              <th>时间</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in vm.auditEvents" :key="event.id">
              <td>{{ event.action }}</td>
              <td>
                {{ event.fromStatus ?? '—' }} → {{ event.toStatus ?? '—' }}
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
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="vm.auditOpen = false"
          >关闭</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>
