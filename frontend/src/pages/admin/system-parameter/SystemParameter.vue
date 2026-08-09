<script setup lang="ts">
import { reactive } from 'vue'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { SystemParameter } from '../shared/api'
import { createSystemParameterViewModel } from './vm'

const vm = reactive(createSystemParameterViewModel())
const columns: readonly BusinessObjectColumn<SystemParameter>[] = [
  { key: 'key', label: '参数键', value: (item) => item.key },
  { key: 'name', label: '名称', value: (item) => item.name },
  { key: 'valueType', label: '类型', value: (item) => item.valueType },
  { key: 'value', label: '当前值', value: (item) => item.value },
  { key: 'defaultValue', label: '默认值', value: (item) => item.defaultValue },
  { key: 'editable', label: '可编辑', value: (item) => item.editable },
]

void vm.query()
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8">
    <AppSnackbar :message="vm.errorMessage" @dismiss="vm.errorMessage = null" />
    <AppSnackbar
      :message="vm.successMessage"
      type="success"
      @dismiss="vm.successMessage = null"
    />
    <v-alert class="mb-4" type="info" variant="tonal">
      参数键、类型和默认值由代码或迁移注册。密码、密钥、Token
      和连接信息不在此维护。
    </v-alert>
    <BusinessObjectList
      :columns="columns"
      :deletable="vm.canReset"
      :editable="vm.canEdit"
      :keyword="vm.keyword"
      :loading="vm.loading"
      :page="vm.page"
      :page-size="vm.pageSize"
      :row-key="(item) => item.key"
      :rows="vm.rows"
      search-label="参数键或名称"
      :total="vm.total"
      @apply-filters="vm.search"
      @query="vm.search"
      @reset-filters="vm.resetFilters"
      @update:keyword="vm.keyword = $event"
      @update:page="vm.changePage"
    >
      <template #filters>
        <v-select
          v-model="vm.valueType"
          clearable
          :items="['STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN']"
          label="值类型"
          variant="outlined"
        />
        <v-select
          v-model="vm.editable"
          clearable
          item-title="title"
          item-value="value"
          :items="[
            { title: '可编辑', value: true },
            { title: '只读', value: false },
          ]"
          label="编辑状态"
          variant="outlined"
        />
      </template>
      <template #cell-editable="{ row }">
        <v-chip
          :color="row.editable ? 'success' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ row.editable ? '可编辑' : '只读' }}
        </v-chip>
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :label="`操作 ${row.key}`"
          :more="
            row.editable && vm.canReset
              ? [
                  {
                    key: 'reset',
                    label: '恢复默认值',
                    icon: 'mdi-restore',
                  },
                ]
              : []
          "
          :primary="
            row.editable && vm.canEdit
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
          @select="$event === 'edit' ? vm.openEdit(row) : vm.requestReset(row)"
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    v-model="vm.editorOpen"
    location="end"
    temporary
    width="620"
  >
    <v-card v-if="vm.editing" class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        编辑系统参数
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.closeEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-list density="compact" class="mb-4">
          <v-list-item title="参数键" :subtitle="vm.editing.key" />
          <v-list-item title="名称" :subtitle="vm.editing.name" />
          <v-list-item title="类型" :subtitle="vm.editing.valueType" />
          <v-list-item title="默认值" :subtitle="vm.editing.defaultValue" />
        </v-list>
        <v-select
          v-if="vm.editing.valueType === 'BOOLEAN'"
          v-model="vm.inputValue"
          item-title="title"
          item-value="value"
          :items="[
            { title: '是', value: 'true' },
            { title: '否', value: 'false' },
          ]"
          label="当前值"
          variant="outlined"
        />
        <v-text-field
          v-else
          v-model="vm.inputValue"
          label="当前值"
          variant="outlined"
        />
        <v-alert
          v-if="vm.validationError"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ vm.validationError }}
        </v-alert>
      </v-card-text>
      <v-card-actions class="px-6 pb-6">
        <v-spacer />
        <v-btn variant="text" @click="vm.closeEditor">取消</v-btn>
        <v-btn
          color="primary"
          :disabled="!vm.canSubmit"
          :loading="vm.saving"
          @click="vm.save"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-navigation-drawer>

  <v-dialog :model-value="Boolean(vm.resetTarget)" max-width="480">
    <v-card rounded="xl" title="恢复默认值">
      <v-card-text>
        确认将“{{ vm.resetTarget?.name }}”恢复为注册的默认值吗？
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="vm.resetTarget = null">取消</v-btn>
        <v-btn color="primary" :loading="vm.saving" @click="vm.confirmReset">
          确认恢复
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
