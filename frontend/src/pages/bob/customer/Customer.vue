<script setup lang="ts">
import { reactive } from 'vue'
import { BusinessObjectList } from '@/components/business-object'
import type { BusinessObjectColumn } from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import { type BobCustomerListItem, useBobCustomerViewModel } from './vm'

const vm = reactive(useBobCustomerViewModel())
const columns: readonly BusinessObjectColumn<BobCustomerListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  { key: 'party', label: '主体', value: (row) => row.partyDisplayName },
  {
    key: 'operatingEntity',
    label: '经营主体',
    value: (row) => `${row.operatingEntityCode} · ${row.operatingEntityName}`,
  },
  {
    key: 'enabled',
    label: '状态',
    value: (row) => (row.enabled ? '启用' : '禁用'),
    sizing: 'compact',
  },
]
void vm.query()
</script>

<template>
  <v-container fluid class="bob-customer-current pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <BusinessObjectList
      :columns="columns"
      :creatable="false"
      :deletable="false"
      :editable="() => vm.canView"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(row) => row.objectId"
      :rows="vm.rows"
      search-label="客户关系编码或主体"
      :total="vm.total"
      @apply-filters="vm.search"
      @query="vm.search"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-select
          v-model="vm.enabled"
          clearable
          :items="[
            { title: '启用', value: true },
            { title: '禁用', value: false },
          ]"
          label="启停状态"
          variant="outlined"
        />
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :actions="
            vm.canView
              ? [{ key: 'view', label: '查看', icon: 'mdi-eye-outline' }]
              : []
          "
          :label="`操作 ${row.code}`"
          :more-label="`更多操作 ${row.code}`"
          @select="vm.openById(row.objectId)"
        />
      </template>
    </BusinessObjectList>
  </v-container>
  <v-navigation-drawer
    v-model="vm.drawerOpen"
    location="end"
    temporary
    width="620"
  >
    <v-card v-if="vm.currentView" flat>
      <v-card-title>客户关系（当前档案）</v-card-title>
      <v-list density="compact">
        <v-list-item title="编码" :subtitle="vm.currentView.code" />
        <v-list-item title="主体" :subtitle="vm.currentView.partyDisplayName" />
        <v-list-item
          title="经营主体"
          :subtitle="`${vm.currentView.operatingEntityCode} · ${vm.currentView.operatingEntityName}`"
        />
        <v-list-item
          title="状态"
          :subtitle="vm.currentView.enabled ? '启用' : '禁用'"
        />
      </v-list>
      <v-card-actions
        ><v-spacer /><v-btn @click="vm.drawerOpen = false"
          >关闭</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-navigation-drawer>
</template>
