<script setup lang="ts">
import { reactive, watch } from 'vue'

import type { RptParameter } from '@zerp/model'

import { type createRptReportViewModel, useRptReportViewModel } from './vm.ts'

const props = defineProps<{
  reportCode: string
  viewModel?: ReturnType<typeof createRptReportViewModel>
}>()
const vm = reactive(props.viewModel ?? useRptReportViewModel(props.reportCode))
void vm.load()
watch(
  () => props.reportCode,
  (reportCode) => void vm.switchReport(reportCode),
)

function optionTitle(item: Record<string, string>): string {
  return [item.code, item.name].filter(Boolean).join(' · ') || item.id || ''
}

function referenceSearch(parameter: RptParameter, keyword: string): void {
  void vm.loadReference(parameter, keyword)
}

function textValue(parameter: RptParameter): string | null {
  const value = vm.parameterValues[parameter.key]
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null
}

function booleanValue(parameter: RptParameter): boolean {
  return vm.parameterValues[parameter.key] === true
}

function rangeValue(parameter: RptParameter, index: 0 | 1): string {
  const value = vm.parameterValues[parameter.key]
  return Array.isArray(value) && typeof value[index] === 'string'
    ? value[index]
    : ''
}

function setRangeValue(
  parameter: RptParameter,
  index: 0 | 1,
  value: string,
): void {
  const current = [rangeValue(parameter, 0), rangeValue(parameter, 1)]
  current[index] = value
  vm.parameterValues[parameter.key] = current
}
</script>

<template>
  <v-container fluid class="pa-5 pa-md-8" data-testid="rpt-report-page">
    <v-alert v-if="vm.error" type="error" class="mb-4">{{ vm.error }}</v-alert>
    <v-card>
      <v-card-title class="d-flex flex-wrap align-center ga-3 pa-5">
        <span>{{ vm.definition?.name || reportCode }}</span
        ><v-spacer />
        <v-btn
          v-if="vm.canExport"
          variant="outlined"
          :loading="vm.exporting"
          @click="vm.exportRows"
          >导出 CSV</v-btn
        >
        <v-btn
          v-if="vm.canQuery"
          color="primary"
          :loading="vm.loading"
          @click="vm.query(1)"
          >查询</v-btn
        >
      </v-card-title>
      <v-divider />
      <v-card-text v-if="vm.definition" class="pa-5">
        <v-row>
          <v-col
            v-for="parameter in vm.definition.parameters"
            :key="parameter.key"
            cols="12"
            md="4"
          >
            <v-autocomplete
              v-if="parameter.type === 'REFERENCE'"
              v-model="vm.parameterValues[parameter.key]"
              :label="parameter.name"
              :items="vm.referenceOptions[parameter.key] || []"
              :item-title="optionTitle"
              item-value="id"
              variant="outlined"
              clearable
              @update:search="referenceSearch(parameter, $event)"
            />
            <v-select
              v-else-if="parameter.type === 'ENUM'"
              :model-value="textValue(parameter)"
              :label="parameter.name"
              :items="parameter.enumValues || []"
              variant="outlined"
              clearable
              @update:model-value="vm.parameterValues[parameter.key] = $event"
            />
            <v-switch
              v-else-if="parameter.type === 'BOOLEAN'"
              :model-value="booleanValue(parameter)"
              :label="parameter.name"
              color="primary"
              @update:model-value="vm.parameterValues[parameter.key] = $event"
            />
            <div v-else-if="parameter.type === 'DATE_RANGE'">
              <div class="text-caption mb-1">{{ parameter.name }}</div>
              <div class="d-flex ga-2">
                <v-text-field
                  :model-value="rangeValue(parameter, 0)"
                  label="开始日期"
                  type="date"
                  variant="outlined"
                  @update:model-value="setRangeValue(parameter, 0, $event)"
                />
                <v-text-field
                  :model-value="rangeValue(parameter, 1)"
                  label="结束日期"
                  type="date"
                  variant="outlined"
                  @update:model-value="setRangeValue(parameter, 1, $event)"
                />
              </div>
            </div>
            <v-text-field
              v-else
              :model-value="textValue(parameter)"
              :label="parameter.name"
              :type="
                parameter.type === 'DATE'
                  ? 'date'
                  : parameter.type === 'INTEGER' || parameter.type === 'DECIMAL'
                    ? 'number'
                    : 'text'
              "
              variant="outlined"
              @update:model-value="vm.parameterValues[parameter.key] = $event"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-data-table
        v-if="vm.canQuery"
        :headers="
          vm.visibleColumns.map((column) => ({
            title: column.name,
            key: column.alias,
            width: column.width,
          }))
        "
        :items="vm.rows"
        :loading="vm.loading"
        :items-per-page="20"
      >
        <template #bottom>
          <div class="d-flex justify-center pa-3">
            <v-pagination
              :model-value="vm.page"
              :length="vm.hasMore ? vm.page + 1 : vm.page"
              @update:model-value="vm.query"
            />
          </div>
        </template>
        <template #no-data>暂无报表结果。</template>
      </v-data-table>
    </v-card>
  </v-container>
</template>
