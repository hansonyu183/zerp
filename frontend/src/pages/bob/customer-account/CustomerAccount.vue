<script setup lang="ts">
import { reactive } from 'vue'
import { BusinessObjectList } from '@/components/business-object'
import type { BusinessObjectColumn } from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import {
  type BobCustomerAccountListItem,
  useBobCustomerAccountViewModel,
} from './vm'

const vm = reactive(useBobCustomerAccountViewModel())
const columns: readonly BusinessObjectColumn<BobCustomerAccountListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  { key: 'name', label: '账户名称', value: (row) => row.name },
  {
    key: 'customer',
    label: '客户关系',
    value: (row) => row.customerRelationshipCode,
  },
  { key: 'type', label: '客户类型', value: (row) => row.customerTypeId },
  { key: 'entity', label: '经营主体', value: (row) => row.operatingEntityCode },
  {
    key: 'enabled',
    label: '状态',
    value: (row) => (row.enabled ? '启用' : '禁用'),
  },
]
void vm.query()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
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
      search-label="结算子账户编码或名称"
      :total="vm.total"
      @apply-filters="vm.search"
      @query="vm.search"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-text-field
          v-model="vm.customerRelationshipId"
          clearable
          label="客户关系 ID"
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
    width="720"
  >
    <v-card v-if="vm.currentView" flat>
      <v-card-title>客户结算子账户（当前有效资料）</v-card-title>
      <v-list density="compact">
        <v-list-item title="编码" :subtitle="vm.currentView.code" />
        <v-list-item title="账户名称" :subtitle="vm.currentView.data.name" />
        <v-list-item
          title="客户类型"
          :subtitle="vm.currentView.data.customerTypeId"
        />
        <v-list-item
          title="联系人"
          :subtitle="vm.currentView.data.contactName ?? '—'"
        />
        <v-list-item
          title="联系电话"
          :subtitle="vm.currentView.data.contactPhone ?? '—'"
        />
        <v-list-item
          title="业务归属"
          :subtitle="vm.currentView.data.primarySalesAttribution.subjectName"
        />
        <v-list-item
          title="信用额度"
          :subtitle="vm.currentView.data.creditLimits[0]?.amount ?? '—'"
        />
        <v-list-item
          title="附件数"
          :subtitle="String(vm.currentView.attachments.length)"
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
