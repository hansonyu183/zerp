<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { usePermissionManagementViewModel } from './vm.ts'

const vm = reactive(usePermissionManagementViewModel())
onMounted(() => void vm.query(1))
</script>

<template>
  <v-container fluid class="page-shell">
    <v-card title="权限目录">
      <v-card-text>
        <v-alert v-if="vm.error" type="error" class="mb-4">{{
          vm.error
        }}</v-alert>
        <v-form class="filters" @submit.prevent="vm.query(1)">
          <v-text-field
            v-model="vm.filters.domain"
            label="领域"
            hide-details
            variant="outlined"
          />
          <v-text-field
            v-model="vm.filters.entity"
            label="实体"
            hide-details
            variant="outlined"
          />
          <v-text-field
            v-model="vm.filters.action"
            label="动作"
            hide-details
            variant="outlined"
          />
          <v-select
            v-model="vm.filters.status"
            :items="[
              { title: '全部', value: '' },
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
            { title: '路径', key: 'path' },
            { title: '领域', key: 'domain' },
            { title: '实体', key: 'entity' },
            { title: '动作', key: 'action' },
            { title: '角色数', key: 'directRoleCount' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="vm.items"
          :loading="vm.loading"
          :items-per-page="20"
          hide-default-footer
        >
          <template #item.actions="{ item }"
            ><v-btn size="small" variant="text" @click="vm.openDetail(item.id)"
              >查看</v-btn
            ></template
          >
          <template #no-data>暂无权限。</template>
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
    <v-dialog v-model="vm.detailOpen" max-width="620"
      ><v-card title="权限详情"
        ><v-card-text v-if="vm.detail"
          ><v-list
            ><v-list-item title="路径" :subtitle="vm.detail.path" /><v-list-item
              title="领域 / 实体 / 动作"
              :subtitle="`${vm.detail.domain} / ${vm.detail.entity} / ${vm.detail.action}`" /><v-list-item
              title="说明"
              :subtitle="vm.detail.description || '—'" /><v-list-item
              title="直接关联角色数"
              :subtitle="
                String(vm.detail.directRoleCount)
              " /></v-list></v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn @click="vm.detailOpen = false"
            >关闭</v-btn
          ></v-card-actions
        ></v-card
      ></v-dialog
    >
  </v-container>
</template>

<style scoped>
.page-shell {
  padding: 24px;
}
.filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(130px, 1fr)) auto;
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
@media (max-width: 900px) {
  .filters {
    grid-template-columns: 1fr;
  }
}
</style>
