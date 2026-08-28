<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BusinessObjectList } from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { BusinessObjectColumn } from '@/components/business-object'
import { useSupplierViewModel, type SupplierListItem } from './vm'

const vm = reactive(useSupplierViewModel())
const route = useRoute()
const router = useRouter()
const columns: readonly BusinessObjectColumn<SupplierListItem>[] = [
  { key: 'code', label: '编码', value: (row) => row.code, sizing: 'compact' },
  {
    key: 'party',
    label: '主体',
    value: (row) => row.relationship?.partyDisplayName ?? '—',
    sizing: 'fluid',
  },
  {
    key: 'operatingEntity',
    label: '经营主体',
    value: (row) => row.relationship
      ? `${row.relationship.operatingEntityCode} · ${row.relationship.operatingEntityName}`
      : '—',
  },
  {
    key: 'purchaser',
    label: '默认采购员',
    value: (row) => {
      const value = row.data.defaultPurchaserName
      return value
        ? `${row.data.defaultPurchaserCode ?? ''} · ${value}`
        : '—'
    },
  },
  {
    key: 'enabled',
    label: '启停状态',
    value: (row) => (row.enabled ? '启用' : '禁用'),
    sizing: 'compact',
  },
]
const view = computed(() => vm.currentView ?? null)
void vm.query()
watch(
  () => route.query.objectId,
  (objectId) => {
    if (typeof objectId === 'string') void vm.openById(objectId)
  },
  { immediate: true },
)
watch(
  () => vm.drawerOpen,
  (open, wasOpen) => {
    if (open || !wasOpen || typeof route.query.objectId !== 'string') return
    const { objectId: _id, mode: _mode, ...query } = route.query
    void router.replace({ query })
  },
)
</script>
<template>
  <v-container fluid class="bob-supplier-page pa-5 pa-md-8">
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
      search-label="供应商关键字"
      :sort="vm.sort"
      :total="vm.total"
      @apply-filters="vm.search"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
      @update:sort="vm.changeSort"
    >
      <template #filters
        ><v-select
          v-model="vm.enabled"
          clearable
          density="comfortable"
          :items="[
            { title: '启用', value: true },
            { title: '禁用', value: false },
          ]"
          label="启停状态"
          variant="outlined"
      /></template>
      <template #actions="{ row }"
        ><ListRowActions
          :actions="
            vm.canView
              ? [
                  {
                    key: 'view',
                    label: `查看 ${row.code}`,
                    icon: 'mdi-eye-outline',
                  },
                ]
              : []
          "
          :label="`操作 ${row.code}`"
          :more-label="`更多操作 ${row.code}`"
          @select="vm.openView(row)"
      /></template>
    </BusinessObjectList>
  </v-container>
  <v-navigation-drawer
    v-model="vm.drawerOpen"
    location="end"
    temporary
    width="640"
    ><v-card flat
      ><v-card-title>供应商（当前档案）</v-card-title
      ><v-card-text v-if="vm.currentView"
        ><v-list density="compact"
          ><v-list-item
            title="编码"
            :subtitle="vm.currentView.code" /><v-list-item
            title="主体"
            :subtitle="vm.currentView.relationship?.partyDisplayName ?? '—'" /><v-list-item
            title="经营主体"
            :subtitle="vm.currentView.relationship ? `${vm.currentView.relationship.operatingEntityCode} · ${vm.currentView.relationship.operatingEntityName}` : '—'" /><v-list-item
            title="联系人"
            :subtitle="view?.data.contactName ?? '—'" /><v-list-item
            title="联系电话"
            :subtitle="view?.data.contactPhone ?? '—'" /><v-list-item
            title="结算方式"
            :subtitle="view?.data.settlementMethodName ?? '—'" /><v-list-item
            title="默认采购员"
            :subtitle="
              view?.data.defaultPurchaserName ?? '—'
            " /></v-list></v-card-text
      ><v-card-actions
        ><v-spacer /><v-btn variant="text" @click="vm.closeEditor"
          >关闭</v-btn
        ></v-card-actions
      ></v-card
    ></v-navigation-drawer
  >
</template>
