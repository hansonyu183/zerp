<script setup lang="ts">
import { reactive } from 'vue'
import { useCustomerViewModel } from './vm'

const vm = reactive(useCustomerViewModel())
void vm.query()
</script>

<template>
  <v-container fluid class="customer-page pa-5 pa-md-8">
    <div class="customer-toolbar">
      <v-text-field
        v-model="vm.keyword"
        clearable
        density="comfortable"
        hide-details
        label="客户关键字"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        @keyup.enter="vm.query"
      />
      <v-btn color="primary" prepend-icon="mdi-refresh" :loading="vm.loading" @click="vm.query">
        查询
      </v-btn>
    </div>

    <v-alert
      v-if="vm.errorMessage"
      class="mb-4"
      icon="mdi-alert-circle-outline"
      type="error"
      variant="tonal"
    >
      {{ vm.errorMessage }}
    </v-alert>

    <v-table class="customer-table">
      <thead>
        <tr>
          <th>客户编码</th>
          <th>客户名称</th>
          <th>状态</th>
          <th>更新时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in vm.rows" :key="row.id">
          <td>{{ row.code || row.id }}</td>
          <td>{{ row.name || '未命名客户' }}</td>
          <td>
            <v-chip density="comfortable" size="small" variant="tonal">
              {{ vm.getStatusText(row.status) }}
            </v-chip>
          </td>
          <td>{{ row.updatedAt || '-' }}</td>
        </tr>
        <tr v-if="!vm.loading && !vm.hasRows">
          <td class="empty-cell" colspan="4">暂无客户数据</td>
        </tr>
      </tbody>
    </v-table>

    <div class="customer-footer">
      <span>共 {{ vm.total }} 条</span>
      <v-btn
        icon="mdi-chevron-left"
        :disabled="vm.page <= 1 || vm.loading"
        variant="text"
        @click="vm.page--; vm.query()"
      />
      <span>第 {{ vm.page }} 页</span>
      <v-btn
        icon="mdi-chevron-right"
        :disabled="vm.rows.length < vm.pageSize || vm.loading"
        variant="text"
        @click="vm.page++; vm.query()"
      />
    </div>
  </v-container>
</template>

<style scoped>
.customer-page { color: rgb(var(--v-theme-on-background)); }
.customer-toolbar { display: grid; grid-template-columns: minmax(220px, 420px) auto; gap: 12px; align-items: center; margin-bottom: 18px; }
.customer-table { overflow: hidden; background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 8px; }
.customer-table th { color: rgb(var(--v-theme-on-surface-variant)); font-size: 12px; font-weight: 700; }
.empty-cell { height: 112px; color: rgb(var(--v-theme-on-surface-variant)); text-align: center; }
.customer-footer { display: flex; gap: 10px; align-items: center; justify-content: flex-end; padding: 16px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: 13px; }
@media (max-width: 640px) {
  .customer-toolbar { grid-template-columns: 1fr; }
  .customer-toolbar .v-btn { width: 100%; }
}
</style>
