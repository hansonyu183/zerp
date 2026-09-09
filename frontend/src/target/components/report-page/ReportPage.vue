<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onUnmounted } from 'vue'
import {
  queryTargetReportDirectory,
  queryTargetReport,
  exportTargetReport,
  queryTargetReportReference,
} from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'
import ManagementPageFrame from '../ManagementPageFrame.vue'
import {
  type Definition,
  type ReferenceItem,
  normalize,
  reportCell,
  csv,
  copy,
  message,
} from './report-data.ts'
import type { ReportDefinition } from './definition.ts'
const props = defineProps<{ definition: ReportDefinition }>()
const code = props.definition.code
const session = useTargetSession()
const canQuery = computed(() => session.apiPaths.includes(`/rpt/${code}/query`))
const canExport = computed(() =>
  session.apiPaths.includes(`/rpt/${code}/export`),
)
const report = shallowRef<Definition | null>(null),
  parameterInput = ref<Record<string, unknown>>({}),
  appliedParameters = ref<Record<string, unknown> | null>(null)
const rows = ref<Record<string, unknown>[]>([]),
  columns = ref<Definition['columns']>([]),
  page = ref(1),
  hasMore = ref(false)
const loading = ref(false),
  exporting = ref(false),
  error = ref('')
const references = ref<
  Record<
    string,
    {
      items: ReferenceItem[]
      loading: boolean
      error: string
      page: number
      total: number
      keyword: string
    }
  >
>({})
const displayRows = computed(() =>
  rows.value.map((row) =>
    columns.value
      .filter((column) => column.visible)
      .map((column) => reportCell(column, row[column.alias])),
  ),
)
let disposed = false,
  request = 0,
  exportRequest = 0
const referenceRequests = new Map<string, number>()
function parameters() {
  if (!report.value) throw new Error('rpt_definition_not_executable')
  return Object.fromEntries(
    report.value.parameters.map((parameter) => [
      parameter.key,
      normalize(parameter, parameterInput.value[parameter.key]),
    ]),
  )
}
async function query(targetPage: number, values: Record<string, unknown>) {
  if (disposed || !canQuery.value || !session.csrfToken) return
  const generation = ++request
  loading.value = true
  error.value = ''
  try {
    const result = await queryTargetReport(session.csrfToken, code, {
      parameters: copy(values),
      page: targetPage,
      pageSize: 20,
    })
    if (disposed || generation !== request) return
    // Validate display values before replacing a successful result with a malformed response.
    for (const row of result.rows)
      for (const column of result.columns) reportCell(column, row[column.alias])
    rows.value = result.rows
    columns.value = result.columns
    page.value = result.page
    hasMore.value = result.hasMore
  } catch (caught) {
    if (!disposed && generation === request) error.value = message(caught)
  } finally {
    if (!disposed && generation === request) loading.value = false
  }
}
async function search() {
  if (disposed || !canQuery.value || loading.value) return
  try {
    const values = parameters()
    appliedParameters.value = copy(values)
    await query(1, values)
  } catch (caught) {
    error.value = message(caught)
  }
}
async function goToPage(targetPage: number) {
  if (!disposed && !loading.value && targetPage > 0 && appliedParameters.value)
    await query(targetPage, copy(appliedParameters.value))
}
async function loadReference(key: string, keyword = '', targetPage = 1) {
  if (disposed || (!canQuery.value && !canExport.value) || !session.csrfToken)
    return
  if (
    !report.value?.parameters.some(
      (parameter) => parameter.key === key && parameter.type === 'REFERENCE',
    )
  )
    return
  const generation = (referenceRequests.get(key) ?? 0) + 1
  referenceRequests.set(key, generation)
  references.value[key] = {
    items: references.value[key]?.items ?? [],
    loading: true,
    error: '',
    page: targetPage,
    total: 0,
    keyword,
  }
  try {
    const result = await queryTargetReportReference(session.csrfToken, code, {
      parameterKey: key,
      keyword,
      page: targetPage,
      pageSize: 20,
    })
    if (disposed || referenceRequests.get(key) !== generation) return
    references.value[key] = { ...result, loading: false, error: '', keyword }
  } catch (caught) {
    if (!disposed && referenceRequests.get(key) === generation)
      references.value[key] = {
        items: [],
        loading: false,
        error: message(caught),
        page: targetPage,
        total: 0,
        keyword,
      }
  }
}
async function initialize() {
  if (disposed || (!canQuery.value && !canExport.value) || !session.csrfToken)
    return
  const generation = ++request
  loading.value = true
  try {
    const directory = await queryTargetReportDirectory(session.csrfToken)
    if (disposed || generation !== request) return
    report.value = directory.find((item) => item.code === code) ?? null
    if (!report.value) throw new Error('rpt_definition_not_executable')
    columns.value = report.value.columns
    parameterInput.value = Object.fromEntries(
      report.value.parameters.map((parameter) => [
        parameter.key,
        parameter.defaultValue === undefined
          ? null
          : copy(parameter.defaultValue),
      ]),
    )
    loading.value = false
    await Promise.all(
      report.value.parameters
        .filter((parameter) => parameter.type === 'REFERENCE')
        .map((parameter) => loadReference(parameter.key)),
    )
    if (
      canQuery.value &&
      report.value.parameters.every(
        (parameter) =>
          !parameter.required || parameterInput.value[parameter.key] !== null,
      )
    )
      await search()
  } catch (caught) {
    if (!disposed && generation === request) error.value = message(caught)
  } finally {
    if (!disposed && generation === request) loading.value = false
  }
}
async function exportReport(): Promise<string | null> {
  if (disposed || !canExport.value || exporting.value || !session.csrfToken)
    return null
  const generation = ++exportRequest
  exporting.value = true
  error.value = ''
  try {
    const result = await exportTargetReport(
      session.csrfToken,
      code,
      parameters(),
    )
    if (disposed || generation !== exportRequest) return null
    return csv(result.columns, result.rows)
  } catch (caught) {
    if (!disposed && generation === exportRequest) error.value = message(caught)
    return null
  } finally {
    if (!disposed && generation === exportRequest) exporting.value = false
  }
}
const stop = watch(
  () => session.generation,
  () => dispose(),
  { flush: 'sync' },
)
function dispose() {
  disposed = true
  request++
  exportRequest++
  referenceRequests.clear()
  parameterInput.value = {}
  appliedParameters.value = null
  report.value = null
  rows.value = []
  columns.value = []
  references.value = {}
  stop()
}
function setValue(key: string, value: unknown) {
  parameterInput.value[key] = value
}
function setRange(key: string, index: 0 | 1, value: unknown) {
  const existing = parameterInput.value[key]
  const range = Array.isArray(existing) ? [...existing] : ['', '']
  range[index] = value
  setValue(key, range)
}
function rangeValue(key: string, index: 0 | 1) {
  const value = parameterInput.value[key]
  return Array.isArray(value) ? String(value[index] ?? '') : ''
}
const referenceOptions = (key: string) =>
  (references.value[key]?.items ?? []).map((item) => ({
    value: item.id ?? item.objectId,
    title: [item.customerCode, item.customerName, item.code, item.name]
      .filter(Boolean)
      .join(' · '),
  }))
const visibleColumns = computed(() =>
  columns.value.filter((column) => column.visible),
)
const booleanOptions = [
  { title: '是', value: true },
  { title: '否', value: false },
]
onMounted(() => void initialize())
onUnmounted(() => dispose())
async function download() {
  const content = await exportReport()
  if (content === null) return
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${report.value?.name ?? '报表'}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
function enter(event: KeyboardEvent) {
  if (!event.isComposing) {
    event.preventDefault()
    void search()
  }
}
</script>
<template>
  <ManagementPageFrame
    :title="report?.name ?? '报表'"
    data-testid="report-page"
  >
    <template #actions>
      <v-btn
        v-if="canExport"
        :loading="exporting"
        :disabled="!report"
        @click="download"
        >导出 CSV</v-btn
      >
    </template>
    <template #alerts
      ><v-alert v-if="error" type="error" class="mb-4">{{
        error
      }}</v-alert></template
    >
    <form
      v-if="report"
      class="report-parameters"
      @submit.prevent="search()"
      @keydown.enter="enter"
    >
      <div v-for="parameter in report.parameters" :key="parameter.key">
        <template v-if="parameter.type === 'DATE_RANGE'">
          <label
            >{{ parameter.name }}{{ parameter.required ? ' *' : '' }}</label
          >
          <div class="d-flex ga-2">
            <v-text-field
              :model-value="rangeValue(parameter.key, 0)"
              :label="`${parameter.name}起始日`"
              type="date"
              @update:model-value="setRange(parameter.key, 0, $event)"
            />
            <v-text-field
              :model-value="rangeValue(parameter.key, 1)"
              :label="`${parameter.name}截止日`"
              type="date"
              @update:model-value="setRange(parameter.key, 1, $event)"
            />
          </div>
        </template>
        <v-select
          v-else-if="parameter.type === 'BOOLEAN'"
          :model-value="parameterInput[parameter.key]"
          :items="booleanOptions"
          :label="parameter.name"
          clearable
          @update:model-value="setValue(parameter.key, $event)"
        />
        <v-select
          v-else-if="parameter.type === 'ENUM'"
          :model-value="parameterInput[parameter.key]"
          :items="
            parameter.enumValues?.map((value) => ({
              value,
              title: parameter.enumCaptions?.[value],
            }))
          "
          :label="parameter.name"
          clearable
          @update:model-value="setValue(parameter.key, $event)"
        />
        <template v-else-if="parameter.type === 'REFERENCE'">
          <v-autocomplete
            :model-value="parameterInput[parameter.key]"
            :items="referenceOptions(parameter.key)"
            :label="parameter.name"
            :loading="references[parameter.key]?.loading"
            :error-messages="references[parameter.key]?.error"
            no-filter
            clearable
            @update:model-value="setValue(parameter.key, $event)"
            @update:search="loadReference(parameter.key, $event)"
          />
          <div class="d-flex ga-2">
            <v-btn
              size="small"
              :disabled="
                (references[parameter.key]?.page ?? 1) <= 1 ||
                references[parameter.key]?.loading
              "
              @click="
                loadReference(
                  parameter.key,
                  references[parameter.key]?.keyword,
                  (references[parameter.key]?.page ?? 1) - 1,
                )
              "
              >上一组</v-btn
            >
            <v-btn
              size="small"
              :disabled="
                (references[parameter.key]?.page ?? 1) * 20 >=
                  (references[parameter.key]?.total ?? 0) ||
                references[parameter.key]?.loading
              "
              @click="
                loadReference(
                  parameter.key,
                  references[parameter.key]?.keyword,
                  (references[parameter.key]?.page ?? 1) + 1,
                )
              "
              >下一组</v-btn
            >
          </div>
        </template>
        <v-text-field
          v-else
          :model-value="parameterInput[parameter.key]"
          :label="`${parameter.name}${parameter.required ? ' *' : ''}`"
          :type="parameter.type === 'DATE' ? 'date' : 'text'"
          :inputmode="
            parameter.type === 'INTEGER'
              ? 'numeric'
              : parameter.type === 'DECIMAL'
                ? 'decimal'
                : undefined
          "
          clearable
          @update:model-value="setValue(parameter.key, $event)"
        />
      </div>
      <v-btn v-if="canQuery" type="submit" color="primary" :loading="loading"
        >查询</v-btn
      >
    </form>
    <v-progress-linear v-if="loading" indeterminate class="my-4" />
    <v-alert v-if="!canQuery && canExport" type="info" class="my-4"
      >你可以填写参数并导出此报表。</v-alert
    >
    <v-table v-if="canQuery" class="mt-4">
      <thead>
        <tr>
          <th
            v-for="column in visibleColumns"
            :key="column.alias"
            :style="{ minWidth: `${column.width}px` }"
          >
            {{ column.name }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in displayRows" :key="index">
          <td v-for="(cell, columnIndex) in row" :key="columnIndex">
            {{ cell }}
          </td>
        </tr>
      </tbody>
    </v-table>
    <p v-if="canQuery && !loading && displayRows.length === 0" class="my-4">
      暂无结果，请填写参数后查询。
    </p>
    <template v-if="canQuery" #footer>
      <v-btn :disabled="page <= 1 || loading" @click="goToPage(page - 1)"
        >上一页</v-btn
      >
      <span>第 {{ page }} 页</span>
      <v-btn :disabled="!hasMore || loading" @click="goToPage(page + 1)"
        >下一页</v-btn
      >
    </template>
  </ManagementPageFrame>
</template>
<style scoped>
.report-parameters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  align-items: start;
}
</style>
