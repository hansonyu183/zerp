<script setup lang="ts">
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import { ApprovalStatusBadge, approvalActionLabels } from '@/shared/approval'
import EntityListControls from '@/components/common/EntityListControls.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import { mappingEntities, createAccountingMappingViewModel } from './vm'
import type { AccountingMapping } from './api'

const vm = createAccountingMappingViewModel()

function actions(mapping: AccountingMapping): ListRowAction[] {
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
      ...(vm.canSubmitApproval
        ? [
            {
              key: 'submit',
              label: approvalActionLabels.submit,
              icon: 'mdi-send-outline',
            },
          ] : []),
      ...(vm.canDeleteVersion
        ? [{ key: 'delete-version', label: '删除草稿', icon: 'mdi-delete-outline', color: 'error' }]
        : []),
    ]
  }
  if (mapping.approval.status === 'PENDING') {
    return [
      ...(vm.canUnsubmitApproval ? [{ key: 'unsubmit', label: approvalActionLabels.unsubmit, icon: 'mdi-undo' }] : []),
      ...(vm.canRejectApproval ? [{ key: 'reject', label: approvalActionLabels.reject, icon: 'mdi-close-circle-outline', color: 'error' }] : []),
      ...(vm.canApprove ? [{ key: 'approve', label: approvalActionLabels.approve, icon: 'mdi-check-circle-outline' }] : []),
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
    ...(vm.canUnapprove
      ? [
          {
            key: 'unapprove',
            label: '反批准',
            icon: 'mdi-backup-restore',
          },
        ]
      : []),
    ...(vm.canVersions
      ? [{ key: 'versions', label: '版本历史', icon: 'mdi-history' }]
      : []),
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
  void vm.changeState(mapping, action as 'submit' | 'unsubmit' | 'approve' | 'reject' | 'unapprove' | 'delete-version')
}

void vm.initialize()
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
          @update:model-value="vm.query()"
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
    <v-card title="VOU 会计映射">
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
              :disabled="Boolean(vm.editing)"
              :items="mappingEntities"
              label="VOU 单据类型"
              variant="outlined"
              @update:model-value="vm.loadCatalog"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="vm.form.defaultResult"
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
      </v-card-text>
      <v-card-actions class="px-6 pb-6">
        <v-spacer />
        <v-btn variant="text" @click="vm.closeEditor">取消</v-btn>
        <v-btn
          color="primary"
          :disabled="!vm.canSubmit"
          :loading="vm.saving"
          @click="vm.save"
          >保存</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>
</template>

<style scoped>
.mapping-filter {
  max-width: 280px;
  min-width: 220px;
}
</style>
