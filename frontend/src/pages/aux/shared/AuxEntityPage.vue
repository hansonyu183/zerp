<script setup lang="ts">
import { computed, reactive } from 'vue'
import { BusinessObjectEditor } from '@/components/business-object'
import EntityListControls from '@/components/common/EntityListControls.vue'
import type { AuxEntityViewModel } from './vm'

const props = defineProps<{ model: AuxEntityViewModel }>()
const vm = reactive(props.model)
const pageCount = computed(() => Math.max(1, Math.ceil(vm.total / vm.pageSize)))

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

    <v-card variant="outlined">
      <v-data-table
        :headers="[
          { title: '编码', key: 'code' },
          { title: '名称', key: 'name', sortable: false },
          { title: '状态', key: 'enabled', sortable: false },
          { title: '版本', key: 'version', sortable: false },
          { title: '操作', key: 'actions', sortable: false },
        ]"
        :items="vm.rows"
        :loading="vm.loading"
        hide-default-footer
      >
        <template #[`item.name`]="{ item }">
          {{ item.currentVersion.data.name }}
        </template>
        <template #[`item.enabled`]="{ item }">
          <v-chip
            :color="item.enabled ? 'success' : 'default'"
            size="small"
            variant="tonal"
          >
            {{ item.enabled ? '启用' : '停用' }}
          </v-chip>
        </template>
        <template #[`item.version`]="{ item }">
          V{{ item.currentVersion.version }}
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            v-if="vm.canSave"
            icon="mdi-pencil-outline"
            size="small"
            variant="text"
            @click="vm.openEdit(item)"
          />
          <v-btn
            v-if="item.enabled ? vm.canDisable : vm.canEnable"
            :icon="
              item.enabled
                ? 'mdi-pause-circle-outline'
                : 'mdi-play-circle-outline'
            "
            size="small"
            variant="text"
            @click="vm.changeEnabled(item)"
          />
          <v-btn
            v-if="vm.canDelete"
            icon="mdi-delete-outline"
            size="small"
            variant="text"
            @click="vm.deleteObject(item)"
          />
        </template>
      </v-data-table>
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
      :title="
        vm.editing ? `编辑${vm.config.title}` : `新增${vm.config.title}`
      "
      @cancel="vm.closeEditor"
      @reference-search="vm.searchEditorReference"
      @save="vm.save"
    />
  </v-navigation-drawer>
</template>
