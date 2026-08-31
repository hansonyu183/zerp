<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import {
  ApprovalStatusBadge,
  approvalActionLabels,
  approvalStatusPresentation,
} from '@/shared/approval'
import type { ApprovalStatus } from '@/api/generated'
import { useRoute } from 'vue-router'
import EntityListControls from '@/components/common/EntityListControls.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { mappingEntities } from '@/pages/acc/mapping/entities'
import { formatLocalDateTime } from '@/utils/date'
import { createDclAccMappingViewModel } from './vm'
import type { AccountingMapping } from './api'

const vm = createDclAccMappingViewModel()
const route = useRoute()
const statusOptions = (
  Object.entries(approvalStatusPresentation) as [
    ApprovalStatus,
    { label: string },
  ][]
).map(([value, item]) => ({ title: item.label, value }))

function actions(mapping: AccountingMapping): ListRowAction[] {
  const lifecycle = new Set(vm.approvalActions(mapping))
  const historyActions: ListRowAction[] = [
    ...(vm.canVersions
      ? [{ key: 'versions', label: '版本历史', icon: 'mdi-history' }]
      : []),
    ...(vm.canAudit
      ? [
          {
            key: 'audit',
            label: '审核记录',
            icon: 'mdi-text-box-search-outline',
          },
        ]
      : []),
  ]
  if (mapping.approval.status === 'DRAFT') {
    return [
      ...(vm.canEdit
        ? [
            {
              key: 'edit',
              label: '编辑',
              icon: 'mdi-pencil-outline',
              color: 'primary',
            },
          ]
        : []),
      ...(lifecycle.has('submit')
        ? [
            {
              key: 'submit',
              label: approvalActionLabels.submit,
              icon: 'mdi-send-outline',
            },
          ]
        : []),
      ...(vm.canDeleteVersion
        ? [
            {
              key: 'delete-version',
              label: '删除草稿',
              icon: 'mdi-delete-outline',
              color: 'error',
            },
          ]
        : []),
      ...historyActions,
    ]
  }
  if (mapping.approval.status === 'PENDING') {
    return [
      ...(lifecycle.has('unsubmit')
        ? [
            {
              key: 'unsubmit',
              label: approvalActionLabels.unsubmit,
              icon: 'mdi-undo',
            },
          ]
        : []),
      ...(lifecycle.has('reject')
        ? [
            {
              key: 'reject',
              label: approvalActionLabels.reject,
              icon: 'mdi-close-circle-outline',
              color: 'error',
            },
          ]
        : []),
      ...(lifecycle.has('approve')
        ? [
            {
              key: 'approve',
              label: approvalActionLabels.approve,
              icon: 'mdi-check-circle-outline',
            },
          ]
        : []),
      ...historyActions,
    ]
  }
  return [
    ...(vm.canCreateNext
      ? [
          {
            key: 'create-next',
            label: '基于此版本新建',
            icon: 'mdi-content-copy',
            color: 'primary',
          },
        ]
      : []),
    ...(lifecycle.has('unapprove')
      ? [
          {
            key: 'unapprove',
            label: '反批准',
            icon: 'mdi-backup-restore',
          },
        ]
      : []),
    ...historyActions,
  ]
}

function selectAction(mapping: AccountingMapping, action: string): void {
  if (action === 'edit') {
    void vm.openEdit(mapping)
    return
  }
  if (action === 'create-next') {
    void vm.createNext(mapping)
    return
  }
  if (action === 'versions') {
    void vm.loadVersions(mapping)
    return
  }
  if (action === 'audit') {
    void vm.loadAudit(mapping)
    return
  }
  void vm.changeState(
    mapping,
    action as
      | 'submit'
      | 'unsubmit'
      | 'approve'
      | 'reject'
      | 'unapprove'
      | 'delete-version',
  )
}

void vm.initialize().then(() => {
  const { bookId, vouEntity, approvalEntryId } = route.query
  if (
    typeof bookId === 'string' &&
    typeof vouEntity === 'string' &&
    typeof approvalEntryId === 'string'
  )
    void vm.openByTarget(
      bookId,
      vouEntity,
      approvalEntryId,
      route.query.mode !== 'edit',
    )
})
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <EntityListControls
      :keyword="''"
      :loading="vm.loading"
      :queryable="vm.canQuery"
      :searchable="false"
      filterable
      @apply-filters="vm.query()"
      @query="vm.query()"
      @reset-filters="vm.resetFilters"
    >
      <template #filters>
        <v-select
          v-model="vm.entityFilter"
          clearable
          density="comfortable"
          :items="mappingEntities"
          label="VOU 类型"
          variant="outlined"
        />
        <v-select
          v-model="vm.statusFilter"
          chips
          clearable
          density="comfortable"
          :items="statusOptions"
          label="状态"
          multiple
          variant="outlined"
        />
      </template>
      <template #toolbar>
        <v-select
          class="mapping-filter"
          density="compact"
          hide-details
          item-title="title"
          item-value="value"
          :items="vm.bookOptions"
          label="会计账簿"
          :model-value="vm.selectedBookId"
          variant="outlined"
          @update:model-value="vm.changeBook"
        />
        <v-btn
          color="primary"
          :disabled="!vm.canCreate"
          prepend-icon="mdi-plus"
          @click="vm.openCreate()"
        >
          新建版本
        </v-btn>
      </template>
    </EntityListControls>
    <v-card title="会计映射变更">
      <v-card-text class="pb-0">
        <v-text-field
          v-model="vm.approvalReason"
          density="compact"
          hide-details
          label="驳回/反批准原因"
          style="max-width: 360px"
        />
      </v-card-text>
      <v-data-table-server
        class="mapping-table"
        :headers="[
          { title: 'VOU 类型', key: 'vouEntity' },
          { title: '版本', key: 'approval.versionNo' },
          { title: '状态', key: 'approval.status' },
          { title: '默认结果', key: 'defaultResult' },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.rows"
        :items-length="vm.total"
        :loading="vm.loading"
        :mobile-breakpoint="700"
        :page="vm.page"
        :items-per-page="vm.pageSize"
        @update:page="vm.changePage"
      >
        <template #[`item.approval.status`]="{ item }">
          <ApprovalStatusBadge :status="item.approval.status" />
        </template>
        <template #[`item.defaultResult`]="{ item }">
          {{ item.defaultResult === 'POST' ? '生成凭证' : '忽略' }}
        </template>
        <template #[`item.actions`]="{ item }">
          <ListRowActions
            :actions="actions(item)"
            :label="`操作 ${item.vouEntity} 版本 ${item.approval.versionNo}`"
            @select="selectAction(item, $event)"
          />
        </template>
      </v-data-table-server>
    </v-card>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    location="end"
    temporary
    width="760"
  >
    <v-card class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        {{ vm.editing ? '编辑映射草稿' : '新建映射版本' }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.closeEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-row>
          <v-col cols="12" md="6">
            <v-select
              v-model="vm.form.vouEntity"
              :disabled="Boolean(vm.editing) || vm.editorReadOnly"
              :items="mappingEntities"
              label="VOU 单据类型"
              variant="outlined"
              @update:model-value="vm.loadCatalog"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="vm.form.defaultResult"
              :disabled="vm.editorReadOnly"
              :items="[
                { title: 'POST · 生成凭证', value: 'POST' },
                { title: 'UN_POST · 忽略', value: 'UN_POST' },
              ]"
              label="未命中规则时"
              variant="outlined"
            />
          </v-col>
          <v-col cols="12">
            <v-alert density="compact" type="info" variant="tonal">
              仅支持声明式字段映射，不执行脚本或任意表达式。条件操作符：EQ、NE、IN、NOT_IN、IS_EMPTY、IS_NOT_EMPTY。
              <template v-if="vm.catalog">
                头字段：{{ vm.catalog.headerFields.join('、') }}；行集合：{{
                  Object.keys(vm.catalog.collections).join('、')
                }}。
              </template>
            </v-alert>
          </v-col>
          <v-col cols="12">
            <v-textarea
              v-model="vm.form.definitionText"
              :readonly="vm.editorReadOnly"
              auto-grow
              label="声明式映射定义（JSON）"
              rows="20"
              spellcheck="false"
              variant="outlined"
            />
          </v-col>
        </v-row>
        <v-alert
          v-if="vm.validationError"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ vm.validationError }}
        </v-alert>
        <v-text-field
          v-if="
            vm.editorReadOnly &&
            (vm.editing?.approval.status === 'PENDING' ||
              vm.editing?.approval.status === 'APPROVED')
          "
          v-model="vm.approvalReason"
          density="compact"
          :label="
            vm.editing?.approval.status === 'APPROVED'
              ? '反批准原因'
              : '驳回原因'
          "
          variant="outlined"
        />
      </v-card-text>
      <v-card-actions class="px-6 pb-6">
        <v-spacer />
        <ListRowActions
          v-if="vm.editorReadOnly && vm.editing"
          :actions="actions(vm.editing)"
          :label="`操作 ${vm.editing.vouEntity} 版本 ${vm.editing.approval.versionNo}`"
          @select="selectAction(vm.editing, $event)"
        />
        <v-btn variant="text" @click="vm.closeEditor">取消</v-btn>
        <v-btn
          v-if="!vm.editorReadOnly"
          color="primary"
          :disabled="!vm.canSubmit"
          :loading="vm.saving"
          @click="vm.save"
          >保存</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>

  <v-dialog v-model="vm.versionsOpen" max-width="900">
    <v-card title="会计映射版本历史">
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th>版本</th>
              <th>状态</th>
              <th>默认结果</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in vm.versions"
              :key="item.approval.approvalEntryId"
            >
              <td>V{{ item.approval.versionNo }}</td>
              <td><ApprovalStatusBadge :status="item.approval.status" /></td>
              <td>{{ item.defaultResult === 'POST' ? '生成凭证' : '忽略' }}</td>
              <td>{{ formatLocalDateTime(item.approval.updatedAt) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="vm.versionsOpen = false"
          >关闭</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>

  <v-dialog v-model="vm.auditOpen" max-width="980">
    <v-card title="会计映射审核记录">
      <v-card-text>
        <v-table>
          <thead>
            <tr>
              <th>事件</th>
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
                {{ event.fromStatus || '—' }} → {{ event.toStatus || '—' }}
              </td>
              <td>{{ event.actorId }}</td>
              <td>{{ formatLocalDateTime(event.createdAt) }}</td>
              <td>{{ event.reason || '—' }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" @click="vm.auditOpen = false"
          >关闭</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>

<style scoped>
.mapping-filter {
  max-width: 280px;
  min-width: 220px;
}
</style>
