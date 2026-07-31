<script setup lang="ts">
import { computed, reactive } from 'vue'
import { BusinessObjectEditor } from '@/components/business-object'
import EntityListControls from '@/components/common/EntityListControls.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import MobileSortControl from '@/components/common/MobileSortControl.vue'
import SortableTableHeader from '@/components/common/SortableTableHeader.vue'
import type { AuxEntityViewModel } from './vm'

const props = defineProps<{ model: AuxEntityViewModel }>()
const vm = reactive(props.model)
const pageCount = computed(() => Math.max(1, Math.ceil(vm.total / vm.pageSize)))

function changeSort(field: 'code'): void {
  void vm.changeSort({
    field,
    order:
      vm.sort.field === field && vm.sort.order === 'asc' ? 'desc' : 'asc',
  })
}

function selectAction(action: string, item: (typeof vm.rows)[number]): void {
  if (action === 'edit') vm.openEdit(item)
  else if (action === 'toggle') void vm.changeEnabled(item)
  else void vm.deleteObject(item)
}

void vm.query()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <v-alert
      v-if="vm.errorMessage"
      class="mb-4"
      closable
      type="error"
      variant="tonal"
      @click:close="vm.errorMessage = null"
    >
      {{ vm.errorMessage }}
    </v-alert>

    <EntityListControls
      :creatable="vm.canCreate"
      filterable
      :keyword="vm.keyword"
      :loading="vm.loading"
      :search-label="`${vm.config.title}关键字`"
      @apply-filters="vm.search"
      @create="vm.openCreate"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
    >
      <template #filters>
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
    </EntityListControls>

    <MobileSortControl
      :field="vm.sort.field"
      :options="[{ title: '编码', value: 'code' }]"
      :order="vm.sort.order"
      @change="
        vm.changeSort({
          field: $event.field as 'code',
          order: $event.order,
        })
      "
    />

    <v-card variant="outlined">
      <v-progress-linear v-if="vm.loading" indeterminate />
      <v-table class="responsive-table">
        <thead>
          <tr>
            <SortableTableHeader
              :active="vm.sort.field === 'code'"
              :direction="vm.sort.order"
              label="编码"
              @sort="changeSort('code')"
            />
            <th>名称</th>
            <th>状态</th>
            <th class="text-end">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in vm.rows" :key="item.objectId">
            <td data-label="编码">{{ item.code }}</td>
            <td data-label="名称">{{ item.currentVersion.data.name }}</td>
            <td data-label="状态">
              <v-chip
                :color="item.enabled ? 'success' : 'default'"
                size="small"
                variant="tonal"
              >
                {{ item.enabled ? '启用' : '停用' }}
              </v-chip>
            </td>
            <td class="responsive-table__actions" data-label="操作">
              <ListRowActions
                :label="`操作 ${item.code}`"
                :more="[
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
                ]"
                :primary="
                  vm.canSave
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
                @select="selectAction($event, item)"
              />
            </td>
          </tr>
          <tr
            v-if="!vm.loading && vm.rows.length === 0"
            class="responsive-table__empty-row"
          >
            <td colspan="4" class="text-center py-12">暂无数据</td>
          </tr>
        </tbody>
      </v-table>
      <v-pagination
        :model-value="vm.page"
        class="my-3"
        :length="pageCount"
        @update:model-value="vm.changePage"
      />
    </v-card>
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
