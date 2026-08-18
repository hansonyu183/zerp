<script setup lang="ts">
import { onUnmounted, reactive } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import DiscardChangesDialog from '../shared/DiscardChangesDialog.vue'
import {
  adminStatusOptions,
  formatAdminStatus,
  formatRoleType,
} from '../shared/labels'
import type { AdminRole } from '../shared/api'
import RoleActionConfirmDialog from './RoleActionConfirmDialog.vue'
import { createRoleManagementViewModel } from './vm'

const vm = reactive(createRoleManagementViewModel())
const router = useRouter()
let pendingRoute: string | null = null

const columns: readonly BusinessObjectColumn<AdminRole>[] = [
  { key: 'code', label: '编码', value: (item) => item.code },
  { key: 'name', label: '名称', value: (item) => item.name },
  {
    key: 'type',
    label: '类型',
    value: (item) => formatRoleType(item.type),
    sizing: 'compact',
  },
  {
    key: 'status',
    label: '状态',
    value: (item) => formatAdminStatus(item.status),
    sizing: 'compact',
  },
]

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}

function selectAction(action: string, row: AdminRole): void {
  if (action === 'VIEW') void vm.openDetail(row)
  else if (action === 'EDIT') void vm.openEdit(row)
  else vm.requestChangeEnabled(row)
}

async function confirmDiscard(): Promise<void> {
  vm.confirmDiscard()
  const target = pendingRoute
  pendingRoute = null
  if (target) await router.push(target)
}

onBeforeRouteLeave((to) => {
  if (vm.requestRouteLeave()) return true
  pendingRoute = to.fullPath
  return false
})
onUnmounted(() => vm.dispose())
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
    <v-alert
      v-if="vm.queryErrorMessage"
      class="mb-4"
      type="error"
      variant="tonal"
    >
      {{ vm.queryErrorMessage }}
      <v-btn class="ml-2" size="small" variant="text" @click="vm.query">
        重试
      </v-btn>
    </v-alert>
    <BusinessObjectList
      :columns="columns"
      :creatable="vm.canCreate"
      :editable="(row) => vm.rowActions(row).length > 0"
      :empty-text="vm.queryErrorMessage ? '角色加载失败，请重试。' : '暂无角色'"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(item) => item.id"
      :rows="vm.rows"
      search-label="角色编码或名称"
      :total="vm.total"
      @apply-filters="vm.applyFilters"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-select
          v-model="vm.status"
          clearable
          density="comfortable"
          item-title="title"
          item-value="value"
          :items="adminStatusOptions"
          label="状态"
          variant="outlined"
        />
      </template>
      <template #cell-status="{ row }">
        <v-chip
          :color="row.status === 'ENABLED' ? 'success' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ formatAdminStatus(row.status) }}
        </v-chip>
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :actions="vm.rowActions(row)"
          :label="`操作 ${row.code}`"
          :loading="vm.actionLoadingID === row.id"
          @select="selectAction($event, row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    :model-value="vm.editorOpen"
    location="end"
    temporary
    width="760"
    @update:model-value="!$event && vm.requestCloseEditor()"
  >
    <v-card class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        {{ vm.isDetail ? '查看角色' : vm.isEdit ? '编辑角色' : '新增角色' }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.requestCloseEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-alert
          v-if="vm.editorErrorMessage"
          class="mb-4"
          type="error"
          variant="tonal"
        >
          {{ vm.editorErrorMessage }}
        </v-alert>
        <v-alert
          v-if="vm.permissionErrorMessage"
          class="mb-4"
          type="error"
          variant="tonal"
        >
          {{ vm.permissionErrorMessage }}
          <v-btn
            class="ml-2"
            size="small"
            variant="text"
            @click="vm.loadPermissions()"
          >
            重试
          </v-btn>
        </v-alert>

        <template v-if="vm.isDetail">
          <dl class="role-detail">
            <dt>编码</dt>
            <dd>{{ vm.editing?.code }}</dd>
            <dt>名称</dt>
            <dd>{{ vm.editing?.name }}</dd>
            <dt>说明</dt>
            <dd>{{ vm.editing?.description || '—' }}</dd>
            <dt>类型</dt>
            <dd>{{ vm.editing ? formatRoleType(vm.editing.type) : '—' }}</dd>
            <dt>状态</dt>
            <dd>
              {{ vm.editing ? formatAdminStatus(vm.editing.status) : '—' }}
            </dd>
            <dt>版本</dt>
            <dd>{{ vm.editing?.revision }}</dd>
            <dt>创建时间</dt>
            <dd>{{ vm.editing ? formatTime(vm.editing.createdAt) : '—' }}</dd>
            <dt>更新时间</dt>
            <dd>{{ vm.editing ? formatTime(vm.editing.updatedAt) : '—' }}</dd>
          </dl>
          <div class="text-subtitle-1 font-weight-medium mt-6 mb-2">
            完整权限
          </div>
          <v-list density="compact" lines="two">
            <v-list-item
              v-for="permission in vm.editing?.permissions ?? []"
              :key="permission.id"
              :subtitle="permission.path"
              :title="permission.description || '未命名权限'"
            >
              <template #append>
                <v-chip
                  :color="
                    permission.status === 'ENABLED' ? 'success' : 'default'
                  "
                  size="x-small"
                  variant="tonal"
                >
                  {{ formatAdminStatus(permission.status) }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
        </template>

        <template v-else>
          <v-text-field
            v-if="vm.isEdit"
            :model-value="vm.editing?.code"
            label="角色编码"
            readonly
            variant="outlined"
          />
          <v-text-field
            v-model="vm.form.name"
            label="角色名称"
            required
            variant="outlined"
          />
          <v-textarea
            v-model="vm.form.description"
            label="说明"
            rows="2"
            variant="outlined"
          />
          <div class="text-subtitle-1 font-weight-medium mb-2">权限</div>
          <div class="permission-list">
            <div
              v-for="permission in vm.permissions"
              :key="permission.id"
              class="permission-list__item"
            >
              <v-checkbox
                density="compact"
                :disabled="vm.permissionDisabled(permission)"
                hide-details
                :label="vm.permissionLabel(permission)"
                :model-value="vm.permissionChecked(permission.id)"
                @update:model-value="
                  vm.togglePermission(permission.id, Boolean($event))
                "
              />
              <small>{{ permission.path }}</small>
            </div>
          </div>
          <v-alert
            v-if="vm.validationError"
            class="mt-4"
            density="compact"
            type="warning"
            variant="tonal"
          >
            {{ vm.validationError }}
          </v-alert>
        </template>
      </v-card-text>
      <v-card-actions class="px-6 pb-6">
        <v-spacer />
        <v-btn variant="text" @click="vm.requestCloseEditor">
          {{ vm.isDetail ? '关闭' : '取消' }}
        </v-btn>
        <v-btn
          v-if="!vm.isDetail"
          color="primary"
          :disabled="!vm.canSubmit"
          :loading="vm.saving"
          @click="vm.save"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>

  <DiscardChangesDialog
    :open="vm.discardConfirmOpen"
    @cancel="vm.cancelDiscard"
    @confirm="confirmDiscard"
  />
  <RoleActionConfirmDialog
    :loading="Boolean(vm.actionLoadingID)"
    :message="vm.pendingActionMessage"
    :open="Boolean(vm.pendingAction)"
    :title="vm.pendingAction?.kind === 'disable' ? '停用角色' : '启用角色'"
    @cancel="vm.pendingAction = null"
    @confirm="vm.confirmPendingAction"
  />
</template>

<style scoped>
.role-detail {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 10px 20px;
}

.role-detail dt {
  color: rgb(var(--v-theme-on-surface-variant));
}

.permission-list__item {
  padding: 8px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.permission-list__item small {
  display: block;
  margin-left: 40px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
