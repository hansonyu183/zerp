<script setup lang="ts">
import { onUnmounted, reactive } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import DiscardChangesDialog from './DiscardChangesDialog.vue'
import TemporaryPasswordDialog from './TemporaryPasswordDialog.vue'
import UserActionConfirmDialog from './UserActionConfirmDialog.vue'
import { createUserManagementViewModel } from './vm'
import type { AdminUser } from '../shared/api'

const vm = reactive(createUserManagementViewModel())
const router = useRouter()
let pendingRoute: string | null = null
const columns: readonly BusinessObjectColumn<AdminUser>[] = [
  { key: 'username', label: '用户名', value: (item) => item.username },
  { key: 'displayName', label: '名称', value: (item) => item.displayName },
  { key: 'status', label: '状态', value: (item) => item.status },
  {
    key: 'updatedAt',
    label: '更新时间',
    value: (item) => new Date(item.updatedAt).toLocaleString('zh-CN'),
  },
]
function leaveEditor(): boolean {
  if (!vm.hasUnsavedChanges) return true
  vm.closeEditor()
  return false
}
async function confirmDiscard(): Promise<void> {
  vm.confirmDiscard()
  const target = pendingRoute
  pendingRoute = null
  if (target) await router.push(target)
}
onBeforeRouteLeave((to) => {
  vm.clearTemporaryPassword()
  if (leaveEditor()) return true
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
      <v-btn class="ml-2" size="small" variant="text" @click="vm.query"
        >重试</v-btn
      >
    </v-alert>
    <BusinessObjectList
      :columns="columns"
      :creatable="vm.canCreate"
      :deletable="
        (row) => vm.canChangeEnabled(row) || vm.canResetUserPassword(row)
      "
      :editable="
        vm.rows.some((row) => vm.canEditUser(row) || vm.canViewUser(row))
      "
      :empty-text="
        vm.queryErrorMessage
          ? '用户加载失败，请重试。'
          : vm.total === 0
            ? '暂无用户'
            : '当前页暂无用户，请返回上一页或重新查询。'
      "
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(item) => item.id"
      :rows="vm.rows"
      search-label="用户名或名称"
      :total="vm.total"
      @apply-filters="vm.applyFilters"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters
        ><v-select
          v-model="vm.status"
          clearable
          density="comfortable"
          :items="[
            { title: '启用', value: 'ENABLED' },
            { title: '停用', value: 'DISABLED' },
          ]"
          label="状态"
          variant="outlined"
      /></template>
      <template #cell-status="{ row }"
        ><v-chip
          :color="row.status === 'ENABLED' ? 'success' : 'default'"
          size="small"
          variant="tonal"
          >{{ row.status === 'ENABLED' ? '启用' : '停用' }}</v-chip
        ></template
      >
      <template #actions="{ row }">
        <ListRowActions
          :actions="[
            ...(vm.canEditUser(row)
              ? [
                  {
                    key: 'edit',
                    label: '编辑',
                    icon: 'mdi-pencil-outline',
                    color: 'primary',
                  },
                ]
              : vm.canViewUser(row)
                ? [
                    {
                      key: 'view',
                      label: '查看',
                      icon: 'mdi-eye-outline',
                      color: 'primary',
                    },
                  ]
                : []),
            ...(vm.canChangeEnabled(row)
              ? [
                  {
                    key: 'toggle',
                    label: row.status === 'ENABLED' ? '停用' : '启用',
                    icon:
                      row.status === 'ENABLED'
                        ? 'mdi-account-off-outline'
                        : 'mdi-account-check-outline',
                  },
                ]
              : []),
            ...(vm.canResetUserPassword(row)
              ? [{ key: 'reset', label: '重置密码', icon: 'mdi-lock-reset' }]
              : []),
          ]"
          :label="`操作 ${row.username}`"
          :loading="vm.actionLoadingID === row.id"
          @select="
            $event === 'edit'
              ? vm.openEdit(row)
              : $event === 'view'
                ? vm.openDetail(row)
                : $event === 'reset'
                  ? vm.requestResetPassword(row)
                  : vm.requestChangeEnabled(row)
          "
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    :model-value="vm.editorOpen"
    location="end"
    temporary
    width="640"
    @update:model-value="!$event && vm.closeEditor()"
  >
    <v-card class="h-100" flat
      ><v-card-title class="d-flex align-center px-6 py-5"
        >{{
          vm.isDetail
            ? '查看用户'
            : vm.editorMode === 'edit'
              ? '编辑用户'
              : '新增用户'
        }}<v-spacer /><v-btn
          icon="mdi-close"
          variant="text"
          @click="vm.closeEditor" /></v-card-title
      ><v-divider />
      <v-card-text class="pa-6">
        <v-alert v-if="vm.editorErrorMessage" type="error" variant="tonal"
          >{{ vm.editorErrorMessage
          }}<template #append
            ><v-btn size="small" variant="text" @click="vm.retryEditor"
              >重试</v-btn
            ></template
          ></v-alert
        >
        <v-alert v-if="vm.roleErrorMessage" type="error" variant="tonal"
          >{{ vm.roleErrorMessage
          }}<template #append
            ><v-btn size="small" variant="text" @click="vm.retryRoles"
              >重试</v-btn
            ></template
          ></v-alert
        >
        <v-text-field
          v-model="vm.form.username"
          autocomplete="off"
          :disabled="vm.editorMode !== 'create'"
          label="用户名"
          required
          variant="outlined"
        />
        <v-text-field
          v-model="vm.form.displayName"
          :readonly="vm.isDetail"
          label="显示名称"
          required
          variant="outlined"
        />
        <v-text-field
          v-if="vm.editorMode === 'create'"
          v-model="vm.form.password"
          autocomplete="new-password"
          :hint="`${vm.passwordMinLength} 至 256 个字符，包含大小写字母、数字和符号`"
          label="初始密码"
          required
          type="password"
          variant="outlined"
        />
        <template v-if="vm.isDetail"
          ><div class="text-subtitle-2 mb-2">角色</div>
          <v-chip
            v-for="role in vm.editing?.roles ?? []"
            :key="role.id"
            class="mr-2 mb-2"
            :color="role.status === 'DISABLED' ? 'default' : 'primary'"
            >{{ role.code }} · {{ role.name
            }}{{ role.status === 'DISABLED' ? '（已停用）' : '' }}</v-chip
          >
          <dl class="mt-5">
            <dt>账号状态</dt>
            <dd>{{ vm.editing?.status === 'ENABLED' ? '启用' : '停用' }}</dd>
            <dt>密码更新时间</dt>
            <dd>{{ vm.editing?.passwordChangedAt }}</dd>
            <dt>创建时间</dt>
            <dd>{{ vm.editing?.createdAt }}</dd>
            <dt>更新时间</dt>
            <dd>{{ vm.editing?.updatedAt }}</dd>
            <dt>版本</dt>
            <dd>{{ vm.editing?.revision }}</dd>
          </dl></template
        >
        <v-select
          v-else
          v-model="vm.form.roleIds"
          chips
          clearable
          item-title="title"
          item-value="value"
          :items="vm.roleOptions"
          label="角色"
          :loading="vm.rolesLoading"
          multiple
          :readonly="vm.rolesReadonly"
          variant="outlined"
        />
        <v-alert
          v-if="vm.validationError"
          density="compact"
          type="warning"
          variant="tonal"
          >{{ vm.validationError }}</v-alert
        > </v-card-text
      ><v-card-actions class="px-6 pb-6"
        ><v-spacer /><v-btn variant="text" @click="vm.closeEditor">{{
          vm.isDetail ? '关闭' : '取消'
        }}</v-btn
        ><v-btn
          v-if="!vm.isDetail"
          color="primary"
          :disabled="!vm.canSubmit"
          :loading="vm.saving"
          @click="vm.save"
          >保存</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-navigation-drawer>

  <DiscardChangesDialog
    :open="vm.discardConfirmOpen"
    @cancel="vm.cancelDiscard"
    @confirm="confirmDiscard"
  />
  <UserActionConfirmDialog
    :kind="vm.pendingAction?.kind ?? null"
    :loading="Boolean(vm.actionLoadingID)"
    :open="Boolean(vm.pendingAction)"
    :username="vm.pendingAction?.row.username ?? ''"
    @cancel="vm.pendingAction = null"
    @confirm="vm.confirmPendingAction"
  />
  <TemporaryPasswordDialog
    :copy-error-message="vm.copyErrorMessage"
    :password="vm.temporaryPassword"
    :saved="vm.passwordSaved"
    @close="vm.closeResetResult"
    @copy="vm.copyTemporaryPassword"
    @update:saved="vm.passwordSaved = $event"
  />
</template>
