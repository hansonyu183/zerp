<script setup lang="ts">
import AppSnackbar from '../AppSnackbar.vue'
import ManagementPageFrame from '../ManagementPageFrame.vue'
import type { EnabledListItem, ListIdentity } from './vm.ts'

type ShellItem = ListIdentity | EnabledListItem

withDefaults(
  defineProps<{
    title: string
    createLabel?: string
    items: readonly ShellItem[]
    total: number
    page: number
    keyword: string
    loading?: boolean
    queryError?: string | null
    notice?: string | null
    feedback?: string | null
    showEnabled?: boolean
    canSearch?: boolean
    canCreate?: boolean
    actionPending?: boolean
    actionBlocked?: boolean
    canEdit?: (item: ShellItem) => boolean
    canEnable?: (item: ShellItem) => boolean
    canDisable?: (item: ShellItem) => boolean
    isRowPending?: (id: string) => boolean
    isRowBlocked?: (id: string) => boolean
  }>(),
  {
    loading: false,
    createLabel: '新增',
    queryError: null,
    notice: null,
    feedback: null,
    showEnabled: false,
    canSearch: false,
    canCreate: false,
    actionPending: false,
    actionBlocked: false,
    canEdit: () => false,
    canEnable: () => false,
    canDisable: () => false,
    isRowPending: () => false,
    isRowBlocked: () => false,
  },
)

const emit = defineEmits<{
  'update:keyword': [value: string]
  search: []
  create: []
  edit: [item: ShellItem]
  enable: [item: ShellItem]
  disable: [item: ShellItem]
  page: [page: number]
  dismissFeedback: []
}>()

function isEnabledItem(item: ShellItem): item is EnabledListItem {
  return 'enabled' in item && typeof item.enabled === 'boolean'
}

function submitSearch(): void {
  emit('search')
}

function onKeywordKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || !event.isComposing) return
  event.preventDefault()
  event.stopPropagation()
}

const identityHeaders = [
  { title: '编码', key: 'code' },
  { title: '名称', key: 'name' },
]
</script>

<template>
  <ManagementPageFrame :title="title" data-testid="list-page-shell">
    <template #actions>
      <v-btn
        v-if="canCreate"
        data-testid="list-create"
        color="primary"
        prepend-icon="mdi-plus"
        :loading="actionPending"
        :disabled="actionPending || actionBlocked"
        @click="emit('create')"
      >
        {{ createLabel }}
      </v-btn>
    </template>
    <template #alerts>
      <v-alert v-if="queryError" type="error" class="mb-4">
        {{ queryError }}
      </v-alert>
      <v-alert v-if="notice" type="info" class="mb-4">
        {{ notice }}
      </v-alert>
      <v-alert v-if="!canSearch" type="info" class="mb-4">
        当前账号没有查询权限，仅显示已授权操作。
      </v-alert>
    </template>
    <template #filters>
      <v-form class="list-filters" @submit.prevent="submitSearch">
        <v-text-field
          :model-value="keyword"
          data-testid="list-keyword"
          label="编码、拼音或名称"
          hide-details
          clearable
          variant="outlined"
          :disabled="!canSearch"
          @keydown.enter="onKeywordKeydown"
          @update:model-value="emit('update:keyword', $event ?? '')"
        />
        <v-btn
          data-testid="list-search"
          color="primary"
          type="submit"
          :disabled="!canSearch"
        >
          查询
        </v-btn>
      </v-form>
    </template>
    <v-data-table
      :headers="[
        ...identityHeaders,
        ...(showEnabled ? [{ title: '状态', key: 'enabled' }] : []),
        { title: '操作', key: 'actions', sortable: false },
      ]"
      :items="items"
      :loading="loading"
      :items-per-page="20"
      disable-sort
      hide-default-footer
    >
      <template #item.enabled="{ item }">
        <v-chip
          v-if="isEnabledItem(item)"
          :color="item.enabled ? 'success' : 'default'"
        >
          {{ item.enabled ? '启用' : '停用' }}
        </v-chip>
      </template>
      <template #item.actions="{ item }">
        <div class="list-row-actions" :data-testid="`list-row-${item.id}`">
          <v-btn
            v-if="canEdit(item)"
            size="small"
            variant="text"
            :loading="isRowPending(item.id)"
            :disabled="isRowPending(item.id) || isRowBlocked(item.id)"
            @click="emit('edit', item)"
          >
            编辑
          </v-btn>
          <v-btn
            v-if="canEnable(item)"
            size="small"
            color="success"
            variant="text"
            :loading="isRowPending(item.id)"
            :disabled="isRowPending(item.id) || isRowBlocked(item.id)"
            @click="emit('enable', item)"
          >
            启用
          </v-btn>
          <v-btn
            v-if="canDisable(item)"
            size="small"
            color="warning"
            variant="text"
            :loading="isRowPending(item.id)"
            :disabled="isRowPending(item.id) || isRowBlocked(item.id)"
            @click="emit('disable', item)"
          >
            停用
          </v-btn>
        </div>
      </template>
      <template #no-data>{{
        canSearch ? '暂无数据。' : '无查询权限。'
      }}</template>
    </v-data-table>
    <template #footer>
      <span>共 {{ total }} 项</span>
      <v-pagination
        v-if="canSearch && total > 20"
        :model-value="page"
        :length="Math.ceil(total / 20)"
        @update:model-value="emit('page', $event)"
      />
    </template>
  </ManagementPageFrame>
  <AppSnackbar :message="feedback" @dismiss="emit('dismissFeedback')" />
</template>

<style scoped>
.list-filters {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(220px, 1fr) auto;
  gap: 12px;
  align-items: center;
  width: 100%;
}
.list-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
@media (max-width: 600px) {
  .list-filters {
    grid-template-columns: 1fr;
  }
  .list-filters :deep(.v-btn) {
    width: 100%;
  }
}
</style>
