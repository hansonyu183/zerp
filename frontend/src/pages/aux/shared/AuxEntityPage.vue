<script setup lang="ts">
import { computed, reactive } from 'vue'
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

    <v-card variant="outlined">
      <v-card-title class="d-flex align-center">
        <span>数据列表</span>
        <v-spacer />
        <v-btn
          v-if="vm.canCreate"
          color="primary"
          prepend-icon="mdi-plus"
          variant="tonal"
          @click="vm.openCreate"
        >
          新增
        </v-btn>
      </v-card-title>
      <v-card-text class="d-flex flex-wrap ga-3">
        <v-text-field
          v-model="vm.keyword"
          clearable
          density="compact"
          hide-details
          label="编码或名称"
          style="max-width: 320px"
          @keyup.enter="vm.query"
        />
        <v-select
          v-model="vm.enabled"
          :items="[
            { title: '全部', value: null },
            { title: '启用', value: true },
            { title: '停用', value: false },
          ]"
          density="compact"
          hide-details
          label="状态"
          style="max-width: 160px"
        />
        <v-btn variant="tonal" @click="vm.query">查询</v-btn>
      </v-card-text>

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
            icon="mdi-pencil-outline"
            size="small"
            variant="text"
            @click="vm.openEdit(item)"
          />
          <v-btn
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
            icon="mdi-delete-outline"
            size="small"
            variant="text"
            @click="vm.deleteObject(item)"
          />
        </template>
      </v-data-table>
      <v-pagination
        v-model="vm.page"
        class="my-3"
        :length="pageCount"
        @update:model-value="vm.query"
      />
    </v-card>

    <v-dialog v-model="vm.editorOpen" max-width="720">
      <v-card>
        <v-card-title>
          {{ vm.editing ? `编辑${vm.config.title}` : `新增${vm.config.title}` }}
        </v-card-title>
        <v-card-text>
          <v-text-field v-model="vm.code" label="编码" required />
          <template v-for="field in vm.config.fields" :key="field.key">
            <v-select
              v-if="
                field.type === 'select' &&
                (!field.visible || field.visible(vm.form))
              "
              v-model="vm.form[field.key]"
              :items="field.options"
              :label="field.label"
              :required="field.required"
            />
            <v-autocomplete
              v-else-if="
                field.type === 'reference' &&
                (!field.visible || field.visible(vm.form))
              "
              v-model="vm.form[field.key]"
              :clearable="!field.required"
              :items="vm.referenceOptions[field.key] ?? []"
              :label="field.label"
              :loading="vm.referenceLoading"
              :required="field.required"
            />
            <v-textarea
              v-else-if="
                field.type === 'textarea' &&
                (!field.visible || field.visible(vm.form))
              "
              v-model="vm.form[field.key]"
              :label="field.label"
              rows="3"
            />
            <v-text-field
              v-else-if="!field.visible || field.visible(vm.form)"
              v-model="vm.form[field.key]"
              :label="field.label"
              :required="field.required"
              :type="field.type === 'number' ? 'number' : 'text'"
            />
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="vm.editorOpen = false">取消</v-btn>
          <v-btn color="primary" :loading="vm.saving" @click="vm.save">
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
