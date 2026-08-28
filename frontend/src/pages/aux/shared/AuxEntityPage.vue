<script setup lang="ts">
import { reactive } from 'vue'
import {
  BusinessObjectEditor,
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { ListRowAction } from '@/components/common/list-row-actions'
import type { AuxEntityViewModel, AuxListItem } from './vm'

const props = defineProps<{ model: AuxEntityViewModel }>()
const vm = reactive(props.model)
const columns: readonly BusinessObjectColumn<AuxListItem>[] = [
  { key: 'code', label: '编码', value: (item) => item.code },
  {
    key: 'displayName',
    label: '名称',
    value: (item) => item.data.name ?? '—',
  },
  ...(vm.config.listFields ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    value: (item: AuxListItem) =>
      item.data[field.key] ?? '—',
    format: field.format,
  })),
  { key: 'enabled', label: '状态', value: (item) => item.enabled },
]

function rowActions(item: AuxListItem): ListRowAction[] {
  return [
    ...(vm.canSave
      ? [
          {
            key: 'edit',
            label: '查看 / 编辑',
            icon: 'mdi-pencil-outline',
            color: 'primary',
          },
        ]
      : []),
    ...((item.enabled ? vm.canDisable : vm.canEnable)
      ? [
          {
            key: 'toggle',
            label: item.enabled ? '停用' : '启用',
            icon: item.enabled
              ? 'mdi-pause-circle-outline'
              : 'mdi-play-circle-outline',
          },
        ]
      : []),
    ...(vm.canDelete
      ? [
          {
            key: 'delete',
            label: '删除',
            icon: 'mdi-delete-outline',
            color: 'error',
          },
        ]
      : []),
  ]
}

function selectAction(action: string, item: (typeof vm.rows)[number]): void {
  if (action === 'edit') vm.openEdit(item)
  else if (action === 'toggle') void vm.changeEnabled(item)
  else if (action === 'delete') void vm.deleteObject(item)
}

void vm.query()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />

    <BusinessObjectList
      :columns="columns"
      :creatable="vm.canCreate"
      :deletable="vm.canDelete || vm.canEnable || vm.canDisable"
      :editable="vm.canSave"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(item) => item.objectId"
      :rows="vm.rows"
      :search-label="`${vm.config.title}关键字`"
      :sort="vm.sort"
      :total="vm.total"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
      @update:sort="vm.changeSort({ field: 'code', order: $event.order })"
    >
      <template #filters>
        <v-select
          v-for="field in vm.config.filters ?? []"
          :key="field.key"
          v-model="vm.filterValues[field.key]"
          clearable
          density="comfortable"
          item-title="title"
          item-value="value"
          :items="field.options"
          :label="field.label"
          variant="outlined"
        />
        <v-select
          v-model="vm.enabled"
          clearable
          density="comfortable"
          item-title="title"
          item-value="value"
          :items="[
            { title: '启用', value: true },
            { title: '停用', value: false },
          ]"
          label="状态"
          variant="outlined"
        />
      </template>
      <template #cell-enabled="{ row: item }">
        <v-chip
          :color="item.enabled ? 'success' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ item.enabled ? '启用' : '停用' }}
        </v-chip>
      </template>
      <template #actions="{ row: item }">
        <ListRowActions
          :actions="rowActions(item)"
          :label="`操作 ${item.code}`"
          @select="selectAction($event, item)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    class="aux-entity-drawer"
    location="end"
    temporary
    width="720"
  >
    <BusinessObjectEditor
      :editable="false"
      editing
      :fields="vm.editorFields"
      :model-value="vm.editorModel"
      :reset-key="vm.editorResetKey"
      :saving="vm.saving"
      :title="vm.editing ? `编辑${vm.config.title}` : `新增${vm.config.title}`"
      @cancel="vm.closeEditor"
      @reference-search="vm.searchEditorReference"
      @save="vm.save"
    />
  </v-navigation-drawer>

</template>
