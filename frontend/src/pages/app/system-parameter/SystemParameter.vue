<script setup lang="ts">
import { reactive } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import {
  BusinessObjectList,
  type BusinessObjectColumn,
} from '@/components/business-object'
import AppSnackbar from '@/components/common/AppSnackbar.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { SystemParameter } from '../shared/api'
import {
  formatSystemParameterEffectMode,
  formatSystemParameterValueType,
  systemParameterValueTypeOptions,
} from '../shared/system-parameter-labels'
import { createSystemParameterViewModel } from './vm'

const vm = reactive(createSystemParameterViewModel())
const router = useRouter()
let pendingRoute: string | null = null
const columns: readonly BusinessObjectColumn<SystemParameter>[] = [
  { key: 'key', label: '参数键', value: (item) => item.key },
  { key: 'name', label: '名称', value: (item) => item.name },
  {
    key: 'description',
    label: '说明',
    value: (item) => item.description,
  },
  {
    key: 'valueType',
    label: '类型',
    value: (item) => formatSystemParameterValueType(item.valueType),
  },
  {
    key: 'configuredValue',
    label: '配置值',
    value: (item) => item.configuredValue,
  },
  { key: 'defaultValue', label: '默认值', value: (item) => item.defaultValue },
  {
    key: 'effectMode',
    label: '生效方式',
    value: (item) => formatSystemParameterEffectMode(item.effectMode),
  },
  {
    key: 'runningValue',
    label: '运行值',
    value: (item) =>
      item.effectMode === 'RESTART_REQUIRED' ? item.runningValue : null,
  },
  {
    key: 'restartPending',
    label: '待重启',
    value: (item) =>
      item.effectMode === 'RESTART_REQUIRED'
        ? item.restartPending
          ? '待重启'
          : '已采用'
        : null,
  },
  { key: 'editable', label: '可编辑', value: (item) => item.editable },
]

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}

async function confirmDiscard(): Promise<void> {
  vm.confirmDiscard()
  const target = pendingRoute
  pendingRoute = null
  if (target) await router.push(target)
}

function cancelDiscard(): void {
  pendingRoute = null
  vm.cancelDiscard()
}

onBeforeRouteLeave((to) => {
  if (!vm.formDirty) return true
  pendingRoute = to.fullPath
  vm.requestCloseEditor()
  return false
})

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
      参数键、类型、约束和生效方式由代码或迁移注册。密码、密钥、Token
      和连接信息不在此维护。
    </v-alert>
    <BusinessObjectList
      :columns="columns"
      :deletable="(row) => vm.canResetParameter(row)"
      :editable="(row) => vm.canEditParameter(row)"
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
          item-title="title"
          item-value="value"
          :items="systemParameterValueTypeOptions"
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
      <template #cell-restartPending="{ row }">
        <v-chip
          v-if="row.effectMode === 'RESTART_REQUIRED'"
          :color="row.restartPending ? 'warning' : 'success'"
          size="small"
          variant="tonal"
        >
          {{ row.restartPending ? '待重启' : '已采用' }}
        </v-chip>
        <span v-else>—</span>
      </template>
      <template #actions="{ row }">
        <ListRowActions
          :actions="[
            ...(vm.canGet
              ? [
                  {
                    key: 'detail',
                    label: vm.canEditParameter(row) ? '查看并编辑' : '查看',
                    icon: vm.canEditParameter(row)
                      ? 'mdi-pencil-outline'
                      : 'mdi-eye-outline',
                    color: 'primary',
                  },
                ]
              : []),
            ...(vm.canResetParameter(row)
              ? [
                  {
                    key: 'reset',
                    label: '恢复默认值',
                    icon: 'mdi-restore',
                  },
                ]
              : []),
          ]"
          :label="`操作 ${row.key}`"
          @select="
            $event === 'reset' ? vm.requestReset(row) : vm.openDetail(row)
          "
        />
      </template>
    </BusinessObjectList>
  </v-container>

  <v-navigation-drawer
    :model-value="vm.editorOpen"
    location="end"
    temporary
    width="620"
    @update:model-value="!$event && vm.requestCloseEditor()"
  >
    <v-card v-if="vm.editing" class="h-100" flat>
      <v-card-title class="d-flex align-center px-6 py-5">
        {{
          vm.editing && vm.canEditParameter(vm.editing)
            ? '编辑系统参数'
            : '系统参数详情'
        }}
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="vm.requestCloseEditor" />
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-6">
        <v-list density="compact" class="mb-4">
          <v-list-item title="参数键" :subtitle="vm.editing.key" />
          <v-list-item title="名称" :subtitle="vm.editing.name" />
          <v-list-item title="说明" :subtitle="vm.editing.description || '—'" />
          <v-list-item
            title="类型"
            :subtitle="formatSystemParameterValueType(vm.editing.valueType)"
          />
          <v-list-item title="默认值" :subtitle="vm.editing.defaultValue" />
          <v-list-item title="配置值" :subtitle="vm.editing.configuredValue" />
          <v-list-item title="编辑约束" :subtitle="vm.constraintHint || '无'" />
          <v-list-item
            title="生效方式"
            :subtitle="formatSystemParameterEffectMode(vm.editing.effectMode)"
          />
          <v-list-item
            v-if="vm.editing.effectMode === 'RESTART_REQUIRED'"
            title="运行值"
            :subtitle="vm.editing.runningValue || '—'"
          />
          <v-list-item
            v-if="vm.editing.effectMode === 'RESTART_REQUIRED'"
            title="待重启"
            :subtitle="vm.editing.restartPending ? '是' : '否'"
          />
          <v-list-item title="版本" :subtitle="String(vm.editing.revision)" />
          <v-list-item
            title="更新时间"
            :subtitle="formatTime(vm.editing.updatedAt)"
          />
          <v-list-item title="更新人" :subtitle="vm.editing.updatedBy || '—'" />
        </v-list>
        <v-select
          v-if="vm.canEditParameter(vm.editing) && vm.inputOptions.length > 0"
          v-model="vm.inputValue"
          item-title="title"
          item-value="value"
          :items="vm.inputOptions"
          label="配置值"
          variant="outlined"
        />
        <v-text-field
          v-else-if="vm.canEditParameter(vm.editing)"
          v-model="vm.inputValue"
          :hint="vm.constraintHint"
          label="配置值"
          persistent-hint
          variant="outlined"
        />
        <v-alert
          v-if="vm.canEditParameter(vm.editing) && vm.validationError"
          class="mt-3"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ vm.validationError }}
        </v-alert>
      </v-card-text>
      <v-card-actions class="px-6 pb-6">
        <v-spacer />
        <v-btn variant="text" @click="vm.requestCloseEditor">
          {{ vm.canEditParameter(vm.editing) ? '取消' : '关闭' }}
        </v-btn>
        <v-btn
          v-if="vm.canEditParameter(vm.editing)"
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
        确认将“{{ vm.resetTarget?.name }}”恢复为默认值“{{
          vm.resetTarget?.defaultValue
        }}”吗？该参数{{
          vm.resetTarget
            ? formatSystemParameterEffectMode(vm.resetTarget.effectMode)
            : ''
        }}。
      </v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="vm.cancelReset">取消</v-btn>
        <v-btn color="primary" :loading="vm.saving" @click="vm.confirmReset">
          确认恢复
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog :model-value="vm.discardConfirmationOpen" max-width="420">
    <v-card rounded="xl" title="放弃修改？">
      <v-card-text>未保存的配置值将被清除。</v-card-text>
      <v-card-actions class="px-6 pb-5">
        <v-spacer />
        <v-btn variant="text" @click="cancelDiscard">继续编辑</v-btn>
        <v-btn color="error" @click="confirmDiscard">放弃</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
