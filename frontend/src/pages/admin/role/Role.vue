<script setup lang="ts">
import { reactive } from 'vue'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { AdminRole } from '../shared/api'
import { createRoleManagementViewModel } from './vm'

const vm = reactive(createRoleManagementViewModel())
const columns: readonly BusinessObjectColumn<AdminRole>[] = [
  { key: 'code', label: '编码', value: (item) => item.code },
  { key: 'name', label: '名称', value: (item) => item.name },
  { key: 'description', label: '说明', value: (item) => item.description },
  { key: 'status', label: '状态', value: (item) => item.status },
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
      :editable="vm.canEditRole"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(item) => item.id"
      :rows="vm.rows"
      search-label="角色编码或名称"
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
          :label="`操作 ${row.code}`"
          :more="
            vm.canChangeEnabled(row)
              ? [
                  {
                    key: 'toggle',
                    label: row.status === 'ENABLED' ? '停用' : '启用',
                    icon:
                      row.status === 'ENABLED'
                        ? 'mdi-pause-circle-outline'
                        : 'mdi-play-circle-outline',
                  },
                ]
              : []
          "
          :primary="
            vm.canEditRole(row)
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
    width="760"
  >
    <v-card class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        {{ vm.editing ? '编辑角色' : '新增角色' }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.closeEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-text-field
          v-model="vm.form.code"
          :disabled="Boolean(vm.editing)"
          label="角色编码"
          required
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
        <v-alert v-if="vm.superadmin" class="mb-4" type="info" variant="tonal">
          超级管理员权限由服务端动态展开为全部启用权限，不能逐项修改。
        </v-alert>
        <div class="text-subtitle-1 font-weight-medium mb-2">权限树</div>
        <v-expansion-panels multiple variant="accordion">
          <v-expansion-panel
            v-for="domain in vm.permissionGroups"
            :key="domain.domain"
            :title="domain.domain"
          >
            <v-expansion-panel-text>
              <div
                v-for="entity in domain.entities"
                :key="entity.entity"
                class="permission-entity"
              >
                <div class="font-weight-medium">{{ entity.entity }}</div>
                <v-checkbox
                  v-for="permission in entity.permissions"
                  :key="permission.id"
                  density="compact"
                  :disabled="vm.permissionDisabled(permission)"
                  hide-details
                  :label="vm.permissionLabel(permission)"
                  :model-value="vm.permissionChecked(permission.id)"
                  @update:model-value="
                    vm.togglePermission(permission.id, Boolean($event))
                  "
                />
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <v-alert
          v-if="vm.validationError"
          class="mt-4"
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

<style scoped>
.permission-entity {
  padding: 12px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
