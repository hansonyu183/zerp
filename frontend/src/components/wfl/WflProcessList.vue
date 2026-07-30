<script setup lang="ts">
import { computed } from 'vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import ListRowActions from '@/components/common/ListRowActions.vue'
import type { WflProcessListRow } from './types'

const props = defineProps<{
  rows: readonly WflProcessListRow[]
  loading: boolean
  keyword: string
  statuses: readonly string[]
  statusOptions: readonly { title: string; value: string }[]
  total: number
  page: number
  pageSize: number
  canQuery: boolean
  canCreate: boolean
  canOpen: boolean
  statusText: (value?: string) => string
  stageText: (value?: string) => string
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:statuses': [value: string[]]
  'update:page': [value: number]
  query: []
  reset: []
  create: []
  open: [row: WflProcessListRow]
}>()

const lastPage = computed(() =>
  Math.max(1, Math.ceil(props.total / props.pageSize)),
)
</script>

<template>
  <div>
    <slot name="heading" />
    <EntityListControls
      :creatable="canCreate"
      filterable
      :keyword="keyword"
      :loading="loading"
      :queryable="canQuery"
      search-label="流程单号关键字"
      @apply-filters="emit('query')"
      @create="emit('create')"
      @query="emit('query')"
      @reset-filters="emit('reset')"
      @update:keyword="emit('update:keyword', $event)"
    >
      <template #filters>
        <v-select
          chips
          clearable
          label="流程状态"
          :items="statusOptions"
          :model-value="statuses"
          multiple
          variant="outlined"
          @update:model-value="emit('update:statuses', [...$event])"
        />
      </template>
    </EntityListControls>
    <v-card rounded="lg" variant="flat">
      <v-progress-linear v-if="loading" indeterminate />
      <div class="wfl-list__table-wrap responsive-table-wrap">
        <v-table class="wfl-list__table responsive-table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>日期</th>
              <th>客户</th>
              <th>状态</th>
              <th>阶段</th>
              <th class="text-end">金额</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.processId">
              <td data-label="订单号">{{ row.documentNo }}</td>
              <td data-label="日期">{{ row.businessDate }}</td>
              <td data-label="客户">{{ row.partyName || '—' }}</td>
              <td data-label="状态">{{ statusText(row.status) }}</td>
              <td data-label="阶段">{{ stageText(row.currentStage) }}</td>
              <td class="text-end" data-label="金额">{{ row.amount }}</td>
              <td class="text-end responsive-table__actions" data-label="操作">
                <ListRowActions
                  :label="`操作 ${row.documentNo}`"
                  :primary="
                    canOpen
                      ? [
                          {
                            key: 'open',
                            label: `打开 ${row.documentNo}`,
                            icon: 'mdi-open-in-new',
                          },
                        ]
                      : []
                  "
                  @select="emit('open', row)"
                />
              </td>
            </tr>
            <tr
              v-if="!loading && rows.length === 0"
              class="responsive-table__empty-row"
            >
              <td colspan="7" class="text-center py-12">暂无流程</td>
            </tr>
          </tbody>
        </v-table>
      </div>
      <v-card-actions class="justify-end">
        <span class="text-caption">
          共 {{ total }} 条，第 {{ page }}/{{ lastPage }} 页
        </span>
        <v-btn
          :disabled="page <= 1 || loading"
          icon="mdi-chevron-left"
          variant="text"
          @click="emit('update:page', page - 1)"
        />
        <v-btn
          :disabled="page >= lastPage || loading"
          icon="mdi-chevron-right"
          variant="text"
          @click="emit('update:page', page + 1)"
        />
      </v-card-actions>
    </v-card>
  </div>
</template>

<style scoped>
.wfl-list__table-wrap {
  overflow-x: auto;
}
.wfl-list__table {
  min-width: 1050px;
}
</style>
