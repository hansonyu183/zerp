<script setup lang="ts">
import { reactive } from 'vue'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { AdminPermission } from '../shared/api'
import {
  adminStatusOptions,
  formatAdminStatus,
} from '../shared/labels'
import { createPermissionManagementViewModel } from './vm'

const vm = reactive(createPermissionManagementViewModel())
const columns: readonly BusinessObjectColumn<AdminPermission>[] = [
  { key: 'path', label: '路径', value: (item) => item.path },
  { key: 'domain', label: '领域', value: (item) => item.domain },
  { key: 'entity', label: '实体', value: (item) => item.entity },
  { key: 'action', label: '动作', value: (item) => item.action },
  {
    key: 'status',
    label: '状态',
    value: (item) => formatAdminStatus(item.status),
  },
]

void vm.query()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <v-alert class="mb-4" type="info" variant="tonal">
      权限由代码和数据库迁移注册，本页面只读。角色授权请在“角色管理”中维护。
    </v-alert>
    <BusinessObjectList
      :columns="columns"
      :editable="vm.canGet"
      keyword=""
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(item) => item.id"
      :rows="vm.rows"
      :searchable="false"
      :total="vm.total"
      @apply-filters="vm.search"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-select
          v-model="vm.status"
          clearable
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
          :actions="
            vm.canGet
              ? [
                  {
                    key: 'view',
                    label: '查看',
                    icon: 'mdi-eye-outline',
                    color: 'primary',
                  },
                ]
              : []
          "
          :label="`查看 ${row.path}`"
          @select="vm.openDetail(row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-dialog v-model="vm.detailOpen" max-width="620">
    <v-card rounded="xl" title="权限详情">
      <v-card-text v-if="vm.detail">
        <v-list density="compact">
          <v-list-item title="路径" :subtitle="vm.detail.path" />
          <v-list-item title="领域" :subtitle="vm.detail.domain" />
          <v-list-item title="实体" :subtitle="vm.detail.entity" />
          <v-list-item title="动作" :subtitle="vm.detail.action" />
          <v-list-item title="说明" :subtitle="vm.detail.description || '—'" />
          <v-list-item
            title="状态"
            :subtitle="formatAdminStatus(vm.detail.status)"
          />
          <v-list-item
            title="直接关联角色数"
            :subtitle="String(vm.detail.roleCount ?? 0)"
          />
        </v-list>
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="vm.detailOpen = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
