<script setup lang="ts">
import { computed } from 'vue'
import { ledgerSourceEntityOptions } from './config'
import LedgerReferenceAutocomplete from './LedgerReferenceAutocomplete.vue'
import EntityListControls from '@/components/common/EntityListControls.vue'
import SortableTableHeader from '@/components/common/SortableTableHeader.vue'
import { useLedgerViewModel } from './vm'
import type { LedgerEntityConfig, LedgerMode, LedgerRecord } from './types'

defineOptions({ name: 'LedgerWorkspace' })

const props = defineProps<{ config: LedgerEntityConfig }>()
const vm = useLedgerViewModel(props.config)
const hasNextPage = computed(
  () => vm.page.value * vm.pageSize.value < vm.total.value,
)

function rowKey(row: LedgerRecord, index: number): string {
  const id = row.id
  if (typeof id === 'string' && id) return id
  return `${vm.mode.value}-${vm.page.value}-${index}`
}

function selectMode(value: unknown): void {
  if (value === 'entries' || value === 'balances') {
    vm.changeMode(value as LedgerMode)
  }
}

function sortableField(key: string) {
  return {
    effectiveDate: 'effectiveDate',
    occurredAt: 'occurredAt',
    sourceDocumentNo: 'documentNo',
  }[key] as 'effectiveDate' | 'occurredAt' | 'documentNo' | undefined
}

function changeSort(
  field: 'effectiveDate' | 'occurredAt' | 'documentNo',
): void {
  vm.sort.order =
    vm.sort.field === field && vm.sort.order === 'asc' ? 'desc' : 'asc'
  vm.sort.field = field
  vm.search()
}

void vm.load()
</script>

<template>
  <v-container fluid class="ledger-workspace pa-5 pa-md-8">
    <div
      v-if="vm.canQuery.value || vm.canBalance.value"
      class="ledger-workspace__controls"
    >
      <v-btn-toggle
        :model-value="vm.mode.value"
        color="primary"
        mandatory
        variant="outlined"
        @update:model-value="selectMode"
      >
        <v-btn v-if="vm.canQuery.value" value="entries">流水</v-btn>
        <v-btn v-if="vm.canBalance.value" value="balances">余额</v-btn>
      </v-btn-toggle>
    </div>

    <v-alert
      v-if="!vm.canQuery.value && !vm.canBalance.value"
      type="warning"
      variant="tonal"
    >
      当前账号没有此台账的查询权限。
    </v-alert>

    <template v-else>
      <v-alert
        v-if="vm.errorMessage.value"
        class="mb-4"
        closable
        type="error"
        variant="tonal"
        @click:close="vm.errorMessage.value = null"
      >
        {{ vm.errorMessage.value }}
      </v-alert>

      <EntityListControls
        filterable
        :loading="vm.loading.value"
        :searchable="false"
        @apply-filters="vm.search"
        @query="vm.search"
        @reset-filters="vm.resetFilters"
      >
        <template #filters>
          <template v-if="vm.mode.value === 'entries'">
            <v-text-field
              v-model="vm.queryFilters.dateFrom"
              density="comfortable"
              label="开始日期"
              type="date"
              variant="outlined"
            />
            <v-text-field
              v-model="vm.queryFilters.dateTo"
              density="comfortable"
              label="结束日期"
              type="date"
              variant="outlined"
            />
            <LedgerReferenceAutocomplete
              v-model="vm.queryFilters.object"
              :error-message="vm.references.errorMessage"
              :label="config.objectLabel"
              :loading="vm.references.loading"
              :options="vm.references.options"
              @search="vm.references.search"
            />
            <v-select
              v-model="vm.queryFilters.sourceEntity"
              clearable
              density="comfortable"
              item-title="title"
              item-value="value"
              :items="ledgerSourceEntityOptions"
              label="来源单据"
              variant="outlined"
            />
            <v-text-field
              v-model="vm.queryFilters.documentNo"
              clearable
              density="comfortable"
              label="来源单号"
              variant="outlined"
            />
            <v-select
              v-if="config.directions.length > 0"
              v-model="vm.queryFilters.direction"
              chips
              clearable
              density="comfortable"
              item-title="title"
              item-value="value"
              :items="config.directions"
              label="方向"
              multiple
              variant="outlined"
            />
          </template>
          <template v-else>
            <v-text-field
              v-model="vm.balanceFilters.asOfDate"
              density="comfortable"
              label="截止日期"
              type="date"
              variant="outlined"
            />
            <LedgerReferenceAutocomplete
              v-model="vm.balanceFilters.object"
              :error-message="vm.references.errorMessage"
              :label="config.objectLabel"
              :loading="vm.references.loading"
              :options="vm.references.options"
              @search="vm.references.search"
            />
          </template>
        </template>
      </EntityListControls>

      <v-card rounded="lg" variant="flat">
        <div class="ledger-workspace__table">
          <v-table>
            <thead>
              <tr>
                <template v-for="column in vm.columns.value" :key="column.key">
                  <SortableTableHeader
                    v-if="
                      vm.mode.value === 'entries' && sortableField(column.key)
                    "
                    :active="vm.sort.field === sortableField(column.key)"
                    :align="column.align"
                    :direction="vm.sort.order"
                    :label="column.label"
                    :width="column.width"
                    @sort="changeSort(sortableField(column.key)!)"
                  />
                  <th
                    v-else
                    :class="`text-${column.align ?? 'start'}`"
                    :style="{ width: column.width }"
                  >
                    {{ column.label }}
                  </th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in vm.rows.value"
                :key="rowKey(row, index)"
              >
                <td
                  v-for="column in vm.columns.value"
                  :key="column.key"
                  :class="`text-${column.align ?? 'start'}`"
                >
                  {{ column.value(row) }}
                </td>
              </tr>
              <tr v-if="!vm.loading.value && vm.rows.value.length === 0">
                <td
                  class="ledger-workspace__empty"
                  :colspan="vm.columns.value.length"
                >
                  暂无{{ vm.mode.value === 'entries' ? '流水' : '余额' }}数据
                </td>
              </tr>
            </tbody>
          </v-table>
          <v-progress-linear
            v-if="vm.loading.value"
            color="primary"
            indeterminate
          />
        </div>
        <v-card-actions class="ledger-workspace__pagination">
          <span>共 {{ vm.total.value }} 条</span>
          <v-btn
            aria-label="上一页"
            icon="mdi-chevron-left"
            :disabled="vm.page.value <= 1 || vm.loading.value"
            variant="text"
            @click="vm.changePage(vm.page.value - 1)"
          />
          <span>第 {{ vm.page.value }} / {{ vm.pageCount.value }} 页</span>
          <v-btn
            aria-label="下一页"
            icon="mdi-chevron-right"
            :disabled="!hasNextPage || vm.loading.value"
            variant="text"
            @click="vm.changePage(vm.page.value + 1)"
          />
        </v-card-actions>
      </v-card>
    </template>
  </v-container>
</template>

<style scoped>
.ledger-workspace__controls {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 24px;
}

.ledger-workspace__pagination {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;
}

.ledger-workspace__table {
  overflow-x: auto;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}

.ledger-workspace__table th,
.ledger-workspace__table td {
  white-space: nowrap;
}

.ledger-workspace__empty {
  height: 112px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}
</style>
