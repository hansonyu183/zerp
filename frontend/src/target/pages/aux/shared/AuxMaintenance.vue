<script setup lang="ts">
import { onMounted, reactive } from 'vue'

import type { TargetAuxEntity } from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import type { AuxFieldConfig } from './config.ts'
import { useAuxMaintenanceViewModel } from './vm.ts'

const props = defineProps<{ entity: TargetAuxEntity }>()
const session = useTargetSession()
const vm = reactive(useAuxMaintenanceViewModel(props.entity))

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'short',
  timeStyle: 'medium',
})

function displayDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date)
}

function relationItems(field: AuxFieldConfig) {
  if (!field.relationEntity) return []
  return [
    { title: '无上级', value: '' },
    ...(vm.relationOptions[field.relationEntity] ?? []),
  ]
}

function fieldType(field: AuxFieldConfig): string {
  return field.kind === 'integer' ? 'number' : 'text'
}

async function remove(): Promise<void> {
  if (
    !window.confirm(
      `确认删除当前${vm.config.title}？已被引用的对象会被服务端拒绝。`,
    )
  )
    return
  await vm.remove()
}

onMounted(() => void vm.query(1))
</script>

<template>
  <v-container fluid class="page-shell">
    <v-card>
      <v-card-title class="d-flex align-center">
        {{ vm.config.title }}
        <v-spacer />
        <v-btn
          v-if="vm.canCreate"
          color="primary"
          prepend-icon="mdi-plus"
          @click="vm.openCreate"
          >新增</v-btn
        >
      </v-card-title>
      <v-card-text>
        <v-alert v-if="vm.error" type="error" class="mb-4">{{
          vm.error
        }}</v-alert>
        <v-form class="filters" @submit.prevent="vm.query(1)">
          <v-text-field
            v-model="vm.filters.keyword"
            label="编码或名称"
            clearable
            hide-details
            variant="outlined"
          />
          <v-select
            v-model="vm.filters.enabled"
            :items="[
              { title: '全部状态', value: '' },
              { title: '启用', value: 'true' },
              { title: '停用', value: 'false' },
            ]"
            label="状态"
            hide-details
            variant="outlined"
          />
          <v-btn color="primary" type="submit">查询</v-btn>
        </v-form>
        <v-data-table
          :headers="[
            { title: '编码', key: 'code' },
            { title: '名称', key: 'name' },
            { title: '状态', key: 'enabled' },
            { title: '更新时间', key: 'updatedAt' },
            { title: '操作', key: 'actions', sortable: false },
          ]"
          :items="
            vm.items.map((item) => ({
              ...item,
              name: String(item.data.name ?? ''),
            }))
          "
          :loading="vm.loading"
          :items-per-page="20"
          hide-default-footer
        >
          <template #item.enabled="{ item }"
            ><v-chip :color="item.enabled ? 'success' : 'default'">{{
              item.enabled ? '启用' : '停用'
            }}</v-chip></template
          >
          <template #item.updatedAt="{ item }">
            {{ displayDateTime(item.updatedAt) }}
          </template>
          <template #item.actions="{ item }"
            ><v-btn
              v-if="session.can(`/aux/${entity}/get`)"
              size="small"
              variant="text"
              @click="vm.openEdit(item.objectId)"
              >维护</v-btn
            ></template
          >
          <template #no-data>暂无{{ vm.config.title }}。</template>
        </v-data-table>
        <div class="pager">
          <span>共 {{ vm.total }} 项</span
          ><v-pagination
            v-if="vm.total > 20"
            :model-value="vm.page"
            :length="Math.ceil(vm.total / 20)"
            @update:model-value="vm.query"
          />
        </div>
      </v-card-text>
    </v-card>

    <v-dialog v-model="vm.editorOpen" max-width="760" persistent>
      <v-card
        :title="
          vm.editorMode === 'create'
            ? `新增${vm.config.title}`
            : `${vm.config.title}详情`
        "
      >
        <v-card-text>
          <v-alert v-if="vm.error" type="error" class="mb-4">{{
            vm.error
          }}</v-alert>
          <v-text-field
            v-if="vm.detail"
            :model-value="vm.detail.code"
            label="编码"
            disabled
            variant="outlined"
          />
          <template v-for="field in vm.config.fields" :key="field.key">
            <v-select
              v-if="field.kind === 'select'"
              v-model="vm.editorData[field.key]"
              :items="field.options"
              :label="field.label"
              :disabled="vm.editorMode === 'edit' && field.readonlyOnEdit"
              variant="outlined"
            />
            <v-select
              v-else-if="field.kind === 'relation'"
              v-model="vm.editorData[field.key]"
              :items="relationItems(field)"
              :label="field.label"
              clearable
              variant="outlined"
            />
            <v-textarea
              v-else-if="field.kind === 'textarea'"
              v-model="vm.editorData[field.key]"
              :label="field.label"
              variant="outlined"
            />
            <v-text-field
              v-else
              v-model="vm.editorData[field.key]"
              :label="field.label"
              :type="fieldType(field)"
              :disabled="vm.editorMode === 'edit' && field.readonlyOnEdit"
              variant="outlined"
            />
          </template>
          <div v-if="vm.detail" class="detail-facts">
            <span>状态：{{ vm.detail.enabled ? '启用' : '停用' }}</span
            ><span>修订版本：{{ vm.detail.objectRevision }}</span
            ><span>更新人：{{ vm.detail.updatedBy }}</span>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-btn
            v-if="vm.detail?.enabled && session.can(`/aux/${entity}/disable`)"
            color="warning"
            @click="vm.setEnabled(false)"
            >停用</v-btn
          >
          <v-btn
            v-if="
              vm.detail &&
              !vm.detail.enabled &&
              session.can(`/aux/${entity}/enable`)
            "
            color="success"
            @click="vm.setEnabled(true)"
            >启用</v-btn
          >
          <v-btn
            v-if="vm.detail && vm.canDelete"
            color="error"
            variant="text"
            @click="remove"
            >删除</v-btn
          >
          <v-spacer /><v-btn @click="vm.editorOpen = false">关闭</v-btn
          ><v-btn
            v-if="
              session.can(
                `/aux/${entity}/${vm.editorMode === 'create' ? 'create' : 'save'}`,
              )
            "
            color="primary"
            :loading="vm.saving"
            @click="vm.save"
            >保存</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.page-shell {
  padding: 24px;
}
.filters {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 180px auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 18px;
}
.pager,
.detail-facts {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  padding-top: 12px;
}
@media (max-width: 800px) {
  .filters {
    grid-template-columns: 1fr;
  }
  .detail-facts {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
