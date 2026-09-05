<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { useTargetSession } from '../../../session/vm.ts'
import { useRoleManagementViewModel } from './vm.ts'

const session = useTargetSession()
const vm = reactive(useRoleManagementViewModel())
onMounted(() => void vm.query(1))
</script>

<template>
  <v-container fluid class="page-shell">
    <v-card>
      <v-card-title class="d-flex align-center"
        >角色管理<v-spacer /><v-btn
          v-if="session.can('/app/role/create')"
          color="primary"
          prepend-icon="mdi-plus"
          @click="vm.openCreate"
          >新增角色</v-btn
        ></v-card-title
      >
      <v-card-text>
        <v-alert v-if="vm.error" type="error" class="mb-4">{{
          vm.error
        }}</v-alert>
        <v-form class="filters" @submit.prevent="vm.query(1)">
          <v-text-field
            v-model="vm.filters.search"
            label="编码或名称"
            clearable
            hide-details
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
            { title: '编码', key: 'code' },
            { title: '名称', key: 'name' },
            { title: '类型', key: 'type' },
            { title: '状态', key: 'status' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="vm.items"
          :loading="vm.loading"
          :items-per-page="20"
          hide-default-footer
        >
          <template #item.status="{ item }">{{
            item.status === 'ENABLED' ? '启用' : '停用'
          }}</template>
          <template #item.actions="{ item }"
            ><v-btn
              v-if="item.availableActions.includes('VIEW')"
              size="small"
              variant="text"
              @click="vm.openEdit(item.id)"
              >{{ item.manageable ? '维护' : '查看' }}</v-btn
            ></template
          >
          <template #no-data>暂无角色。</template>
        </v-data-table>
        <div class="pager">
          <span>共 {{ vm.total }} 项</span
          ><v-pagination
            v-if="vm.total > 20"
            :model-value="vm.page"
            :length="Math.ceil(vm.total / 20)"
            @update:model-value="vm.query"
          />
        </div>
      </v-card-text>
    </v-card>
    <v-dialog v-model="vm.editorOpen" max-width="860" persistent>
      <v-card :title="vm.editorMode === 'create' ? '新增角色' : '角色详情'">
        <v-card-text>
          <v-alert v-if="vm.error" type="error" class="mb-4">{{
            vm.error
          }}</v-alert>
          <v-text-field
            v-if="vm.detail"
            :model-value="vm.detail.code"
            label="角色编码"
            disabled
            variant="outlined"
          />
          <v-text-field
            v-model="vm.editor.name"
            label="角色名称"
            :disabled="vm.editorMode === 'edit' && !vm.detail?.manageable"
            variant="outlined"
          />
          <v-textarea
            v-model="vm.editor.description"
            label="说明"
            :disabled="vm.editorMode === 'edit' && !vm.detail?.manageable"
            variant="outlined"
          />
          <v-select
            v-model="vm.editor.permissionIds"
            :items="vm.permissionOptions"
            label="权限"
            multiple
            chips
            :disabled="vm.editorMode === 'edit' && !vm.detail?.manageable"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="
              vm.detail?.manageable &&
              vm.detail.status === 'ENABLED' &&
              session.can('/app/role/disable')
            "
            color="warning"
            @click="vm.setEnabled(false)"
            >停用</v-btn
          >
          <v-btn
            v-if="
              vm.detail?.manageable &&
              vm.detail.status === 'DISABLED' &&
              session.can('/app/role/enable')
            "
            color="success"
            @click="vm.setEnabled(true)"
            >启用</v-btn
          >
          <v-spacer /><v-btn @click="vm.editorOpen = false">关闭</v-btn
          ><v-btn
            v-if="vm.editorMode === 'create' || vm.detail?.manageable"
            color="primary"
            :loading="vm.saving"
            @click="vm.save"
            >保存</v-btn
          >
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
  grid-template-columns: minmax(220px, 1fr) 180px auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}
.pager {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
}
@media (max-width: 800px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
