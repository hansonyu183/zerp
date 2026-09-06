<script setup lang="ts">
import AppSnackbar from '../../../components/AppSnackbar.vue'
import ManagementPageFrame from '../../../components/ManagementPageFrame.vue'

// Presentation-only extraction retained for the #381 app/user vertical slice.
// It intentionally has no Session, API, registry, or list-state dependency.
export type UserListPresentationItem = {
  id: string
  code: string
  name: string
  enabled: boolean
  actionLabel?: string | null
}

defineProps<{
  items: readonly UserListPresentationItem[]
  total: number
  page: number
  keyword: string
  loading?: boolean
  queryError?: string | null
  feedback?: string | null
  canCreate?: boolean
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  search: []
  create: []
  open: [id: string]
  page: [page: number]
  dismissFeedback: []
}>()

const headers = [
  { title: '用户编码', key: 'code' },
  { title: '名称', key: 'name' },
  { title: '状态', key: 'enabled' },
  { title: '操作', key: 'actions', sortable: false },
]
</script>

<template>
  <ManagementPageFrame title="用户管理">
    <template #actions>
      <v-btn
        v-if="canCreate"
        color="primary"
        prepend-icon="mdi-plus"
        @click="emit('create')"
      >
        新增用户
      </v-btn>
    </template>
    <template #alerts>
      <v-alert v-if="queryError" type="error" class="mb-4">
        {{ queryError }}
      </v-alert>
    </template>
    <template #filters>
      <v-text-field
        :model-value="keyword"
        label="用户编码、拼音或名称"
        hide-details
        clearable
        variant="outlined"
        @update:model-value="emit('update:keyword', $event ?? '')"
      />
      <v-btn color="primary" @click="emit('search')">查询</v-btn>
    </template>
    <v-data-table
      :headers="headers"
      :items="items"
      :loading="loading"
      :items-per-page="20"
      hide-default-footer
    >
      <template #item.enabled="{ item }">
        <v-chip :color="item.enabled ? 'success' : 'default'">
          {{ item.enabled ? '启用' : '停用' }}
        </v-chip>
      </template>
      <template #item.actions="{ item }">
        <v-btn
          v-if="item.actionLabel"
          size="small"
          variant="text"
          @click="emit('open', item.id)"
        >
          {{ item.actionLabel }}
        </v-btn>
      </template>
      <template #no-data>暂无用户。</template>
    </v-data-table>
    <template #footer>
      <span>共 {{ total }} 项</span>
      <v-pagination
        v-if="total > 20"
        :model-value="page"
        :length="Math.ceil(total / 20)"
        @update:model-value="emit('page', $event)"
      />
    </template>
  </ManagementPageFrame>
  <AppSnackbar :message="feedback ?? null" @dismiss="emit('dismissFeedback')" />
</template>
