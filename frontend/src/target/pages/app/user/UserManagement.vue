<script setup lang="ts">
import { onMounted, reactive } from 'vue'

import { useTargetSession } from '../../../session/vm.ts'
import { useUserManagementViewModel } from './vm.ts'

const session = useTargetSession()
const vm = reactive(useUserManagementViewModel())

onMounted(() => void vm.query(1))
</script>

<template>
  <v-container fluid class="page-shell">
    <v-card>
      <v-card-title class="d-flex align-center">
        用户管理
        <v-spacer />
        <v-btn
          v-if="session.can('/app/user/create')"
          color="primary"
          prepend-icon="mdi-plus"
          @click="vm.openCreate"
        >
          新增用户
        </v-btn>
      </v-card-title>
      <v-card-text>
        <v-alert v-if="vm.error" type="error" class="mb-4">
          {{ vm.error }}
        </v-alert>
        <v-form class="filters" @submit.prevent="vm.query(1)">
          <v-text-field
            v-model="vm.filters.search"
            label="用户名或显示名称"
            hide-details
            clearable
            variant="outlined"
          />
          <v-select
            v-model="vm.filters.status"
            :items="[
              { title: '全部状态', value: '' },
              { title: '启用', value: 'ENABLED' },
              { title: '停用', value: 'DISABLED' },
            ]"
            label="状态"
            hide-details
            variant="outlined"
          />
          <v-btn color="primary" type="submit">查询</v-btn>
        </v-form>
        <v-data-table
          :headers="[
            { title: '用户名', key: 'username' },
            { title: '显示名称', key: 'displayName' },
            { title: '状态', key: 'status' },
            { title: '更新时间', key: 'updatedAt' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="vm.items"
          :loading="vm.loading"
          :items-per-page="20"
          hide-default-footer
        >
          <template #item.status="{ item }">
            <v-chip :color="item.status === 'ENABLED' ? 'success' : 'default'">
              {{ item.status === 'ENABLED' ? '启用' : '停用' }}
            </v-chip>
          </template>
          <template #item.actions="{ item }">
            <v-btn
              v-if="session.can('/app/user/get')"
              size="small"
              variant="text"
              @click="vm.openEdit(item.id)"
            >
              {{ item.manageable ? '维护' : '查看' }}
            </v-btn>
          </template>
          <template #no-data>暂无用户。</template>
        </v-data-table>
        <div class="pager">
          <span>共 {{ vm.total }} 项</span>
          <v-pagination
            v-if="vm.total > 20"
            :model-value="vm.page"
            :length="Math.ceil(vm.total / 20)"
            @update:model-value="vm.query"
          />
        </div>
      </v-card-text>
    </v-card>

    <v-dialog v-model="vm.editorOpen" max-width="720" persistent>
      <v-card :title="vm.editorMode === 'create' ? '新增用户' : '用户详情'">
        <v-card-text>
          <v-alert v-if="vm.error" type="error" class="mb-4">
            {{ vm.error }}
          </v-alert>
          <v-alert
            v-if="vm.temporaryPassword"
            type="warning"
            class="mb-4"
            title="一次性临时密码"
          >
            {{ vm.temporaryPassword }}。请立即安全交给用户，关闭后不再显示。
          </v-alert>
          <v-text-field
            v-model="vm.editor.username"
            label="用户名"
            :disabled="vm.editorMode === 'edit'"
            variant="outlined"
          />
          <v-text-field
            v-model="vm.editor.displayName"
            label="显示名称"
            :disabled="vm.editorMode === 'edit' && !vm.detail?.manageable"
            variant="outlined"
          />
          <v-text-field
            v-if="vm.editorMode === 'create'"
            v-model="vm.editor.password"
            label="初始密码"
            type="password"
            variant="outlined"
          />
          <v-select
            v-model="vm.editor.roleIds"
            :items="vm.roleOptions"
            label="角色"
            multiple
            chips
            :disabled="
              vm.editorMode === 'edit' && !vm.detail?.roleAssignmentEditable
            "
            variant="outlined"
          />
          <div v-if="vm.detail" class="detail-facts">
            <span
              >状态：{{
                vm.detail.status === 'ENABLED' ? '启用' : '停用'
              }}</span
            >
            <span>版本：{{ vm.detail.revision }}</span>
            <span>密码更新：{{ vm.detail.passwordChangedAt }}</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="
              vm.editorMode === 'edit' &&
              vm.detail?.manageable &&
              vm.detail.status === 'ENABLED' &&
              session.can('/app/user/disable')
            "
            color="warning"
            @click="vm.setEnabled(false)"
          >
            停用
          </v-btn>
          <v-btn
            v-if="
              vm.editorMode === 'edit' &&
              vm.detail?.manageable &&
              vm.detail.status === 'DISABLED' &&
              session.can('/app/user/enable')
            "
            color="success"
            @click="vm.setEnabled(true)"
          >
            启用
          </v-btn>
          <v-btn
            v-if="
              vm.editorMode === 'edit' &&
              vm.detail?.manageable &&
              vm.detail.status === 'ENABLED' &&
              session.can('/app/user/reset-password')
            "
            color="warning"
            variant="text"
            @click="vm.resetPassword"
          >
            重置密码
          </v-btn>
          <v-spacer />
          <v-btn @click="vm.closeEditor">关闭</v-btn>
          <v-btn
            v-if="
              vm.editorMode === 'create' ||
              (vm.detail?.manageable && session.can('/app/user/save'))
            "
            color="primary"
            :loading="vm.saving"
            @click="vm.save"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.page-shell {
  padding: 24px;
}
.filters {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(160px, 0.4fr) auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}
.pager,
.detail-facts {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-top: 12px;
}
@media (max-width: 800px) {
  .filters {
    grid-template-columns: 1fr;
  }
  .detail-facts {
    flex-direction: column;
  }
}
</style>
