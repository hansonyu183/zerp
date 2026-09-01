<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BusinessObjectList } from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import {
  archiveOperatingSnapshots,
  useTypedBusinessArchiveViewModel,
  type TypedBusinessArchiveEntity,
} from './typed-business-archive'

const props = defineProps<{
  entity: TypedBusinessArchiveEntity
  title: string
  codeLabel: string
}>()

const vm = reactive(useTypedBusinessArchiveViewModel(props.entity))
const route = useRoute()
const router = useRouter()
const view = computed(() => vm.currentView)
const columns = computed(() => [
  {
    key: 'code',
    label: '编码',
    value: (row: (typeof vm.rows)[number]) => row.code,
    sizing: 'compact' as const,
  },
  {
    key: 'name',
    label: '名称',
    value: (row: (typeof vm.rows)[number]) => row.displayName,
    sizing: 'fluid' as const,
  },
  {
    key: 'enabled',
    label: '启停状态',
    value: (row: (typeof vm.rows)[number]) => (row.enabled ? '启用' : '禁用'),
    sizing: 'compact' as const,
  },
])

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
    const { objectId: _id, ...query } = route.query
    void router.replace({ query })
  },
)
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
      :search-label="`${props.codeLabel}或名称`"
      :sort="vm.sort"
      :total="vm.total"
      @apply-filters="vm.search"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
      @update:sort="vm.changeSort"
    >
      <template #filters>
        <v-autocomplete
          v-if="vm.supportsOperatingEntityFilter"
          v-model="vm.operatingEntityId"
          clearable
          :error-messages="vm.operatingEntityErrorMessage ?? undefined"
          item-title="title"
          item-value="value"
          :items="vm.operatingEntityOptions"
          label="经营主体"
          :loading="vm.operatingEntityLoading"
          no-filter
          variant="outlined"
          @update:search="vm.searchOperatingEntities($event ?? '')"
        />
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
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.drawerOpen"
    location="end"
    temporary
    width="640"
  >
    <v-card flat>
      <v-card-title>{{ props.title }}</v-card-title>
      <v-card-text v-if="view">
        <v-list density="compact">
          <v-list-item title="编码" :subtitle="view.code" />
          <v-list-item title="法定名称" :subtitle="view.data.legalName" />
          <v-list-item
            title="显示名称"
            :subtitle="view.data.displayName ?? '—'"
          />
          <v-list-item title="税号" :subtitle="view.data.taxNumber ?? '—'" />
          <v-list-item
            title="经营主体"
            :subtitle="archiveOperatingSnapshots(view)"
          />
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="vm.closeEditor">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>
</template>
