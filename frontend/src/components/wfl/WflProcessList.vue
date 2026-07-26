<script setup lang="ts">
import { computed } from 'vue'
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
    <div class="wfl-list__heading">
      <slot name="heading" />
      <v-btn
        v-if="canCreate"
        color="primary"
        :disabled="loading"
        prepend-icon="mdi-plus"
        @click="emit('create')"
      >
        新建流程
      </v-btn>
    </div>
    <v-expansion-panels class="mb-4" variant="accordion">
      <v-expansion-panel>
        <v-expansion-panel-title>筛选条件</v-expansion-panel-title>
        <v-expansion-panel-text>
          <div class="wfl-list__filters">
            <v-text-field
              clearable
              label="流程单号关键字"
              :model-value="keyword"
              variant="outlined"
              @update:model-value="emit('update:keyword', $event ?? '')"
            />
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
          </div>
          <div class="wfl-list__filter-actions">
            <v-btn variant="text" @click="emit('reset')">重置</v-btn>
            <v-btn
              color="primary"
              :disabled="!canQuery"
              :loading="loading"
              @click="emit('query')"
            >
              查询
            </v-btn>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
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
                {{ row.amount }}<template v-if="row.currency"> {{ row.currency }}</template>
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
.wfl-list__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}
.wfl-list__filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.wfl-list__filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.wfl-list__table-wrap { overflow-x: auto; }
.wfl-list__table { min-width: 1050px; }
@media (max-width: 900px) {
  .wfl-list__heading {
    align-items: stretch;
    flex-direction: column;
  }
  .wfl-list__filters { grid-template-columns: 1fr; }
}
</style>
