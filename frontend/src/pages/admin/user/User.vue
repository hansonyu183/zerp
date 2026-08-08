<script setup lang="ts">
import { reactive } from 'vue'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import { createUserManagementViewModel } from './vm'
import type { AdminUser } from '../shared/api'

const vm = reactive(createUserManagementViewModel())
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
      :deletable="vm.canChangeEnabled"
      :editable="vm.canEditUser"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(item) => item.id"
      :rows="vm.rows"
      search-label="用户名或名称"
      :total="vm.total"
      @apply-filters="vm.search"
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
          :items="[
            { title: '启用', value: 'ENABLED' },
            { title: '停用', value: 'DISABLED' },
          ]"
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
          {{ row.status === 'ENABLED' ? '启用' : '停用' }}
        </v-chip>
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :label="`操作 ${row.username}`"
          :more="
            vm.canChangeEnabled(row)
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
              : []
          "
          :primary="
            vm.canEditUser(row)
              ? [
                  {
                    key: 'edit',
                    label: '编辑',
                    icon: 'mdi-pencil-outline',
                    color: 'primary',
                  },
                ]
              : []
          "
          @select="$event === 'edit' ? vm.openEdit(row) : vm.changeEnabled(row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    location="end"
    temporary
    width="640"
  >
    <v-card class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        {{ vm.editing ? '编辑用户' : '新增用户' }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.closeEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-text-field
          v-model="vm.form.username"
          autocomplete="off"
          :disabled="Boolean(vm.editing)"
          label="用户名"
          required
          variant="outlined"
        />
        <v-text-field
          v-model="vm.form.displayName"
          label="显示名称"
          required
          variant="outlined"
        />
        <v-text-field
          v-if="!vm.editing"
          v-model="vm.form.password"
          autocomplete="new-password"
          hint="密码策略由服务端统一校验"
          label="初始密码"
          required
          type="password"
          variant="outlined"
        />
        <v-select
          v-model="vm.form.roleIds"
          chips
          clearable
          item-title="title"
          item-value="value"
          :items="vm.roleOptions"
          label="角色"
          multiple
          variant="outlined"
        />
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
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>
</template>
