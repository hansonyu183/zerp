<script setup lang="ts">
import { computed } from 'vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import { formatLocalDateTime } from '@/utils/date'
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
      <div class="wfl-list__table-wrap">
        <v-table class="wfl-list__table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>日期</th>
              <th>客户</th>
              <th>状态</th>
              <th>阶段</th>
              <th class="text-end">金额</th>
              <th>更新</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.processId">
              <td>{{ row.documentNo }}</td>
              <td>{{ row.businessDate }}</td>
              <td>{{ row.partyName || '—' }}</td>
              <td>{{ statusText(row.status) }}</td>
              <td>{{ stageText(row.currentStage) }}</td>
              <td class="text-end">
                {{ row.amount
                }}<template v-if="row.currency"> {{ row.currency }}</template>
              </td>
              <td>{{ formatLocalDateTime(row.updatedAt) }}</td>
              <td class="text-end">
                <v-btn
                  v-if="canOpen"
                  :aria-label="`打开 ${row.documentNo}`"
                  icon="mdi-open-in-new"
                  variant="text"
                  @click="emit('open', row)"
                />
              </td>
            </tr>
            <tr v-if="!loading && rows.length === 0">
              <td colspan="8" class="text-center py-12">暂无流程</td>
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
