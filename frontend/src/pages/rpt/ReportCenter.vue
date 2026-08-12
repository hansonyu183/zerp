<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  initialParameters,
  executeParameters,
  formatResultValue,
  reportActions,
  reportDefinitionActions,
  reportPageCount,
  visibleColumns,
  vouDrilldown,
  type RptParameter,
  type RptResultColumn,
  type ReportDefinitionAction,
} from './shared/vm'

type Definition = {
  code: string
  name: string
  description?: string
  enabled?: boolean
  revision?: number
  versionId?: string
  versionRevision?: number
  canQuery?: boolean
  canExport?: boolean
  parameters?: RptParameter[]
  columns?: RptResultColumn[]
  data?: components['schemas']['RptVersionData']
}

type ResultRow = Record<string, unknown>
type ReferenceItem = { title: string; value: string }

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const definitions = ref<Definition[]>([])
const selectedCode = ref('')
const selected = ref<Definition | null>(null)
const parameters = ref<Record<string, unknown>>({})
const rows = ref<ResultRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 50
const executedColumns = ref<RptResultColumn[]>([])
const loading = ref(false)
const exporting = ref(false)
const errorMessage = ref('')
const notice = ref('')
const referenceOptions = ref<Record<string, ReferenceItem[]>>({})
const referenceRequestIds = ref<Record<string, number>>({})
const managementData = ref('')
const managementCode = ref('')
const managementVersionId = ref('')
const managementRevision = ref(0)

const reportPermissions = computed(() =>
  reportActions({
    query:
      selected.value?.canQuery ??
      (Boolean(selectedCode.value) &&
        session.can(`/rpt/${selectedCode.value}/query`)),
    export:
      selected.value?.canExport ??
      (Boolean(selectedCode.value) &&
        session.can(`/rpt/${selectedCode.value}/export`)),
  }),
)
const resultColumns = computed(() => visibleColumns(executedColumns.value))
const managementPermissions = computed(
  () =>
    Object.fromEntries(
      reportDefinitionActions.map((action) => [
        action,
        session.can(`/rpt/definition/${action}`),
      ]),
    ) as Record<ReportDefinitionAction, boolean>,
)
const managementAllowed = computed(() =>
  reportDefinitionActions.some((action) => managementPermissions.value[action]),
)
const pageCount = computed(() => reportPageCount(total.value, pageSize))
const definitionOptions = computed(() =>
  definitions.value.map((definition) => ({
    title: `${definition.name}（${definition.code}）`,
    value: definition.code,
  })),
)

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

function asDefinitions(data: unknown): Definition[] {
  const root = record(data)
  const candidates = [
    root.items,
    root.records,
    root.definitions,
    root.list,
    data,
  ]
  const values = candidates.find(Array.isArray)
  if (!Array.isArray(values)) return []
  return values.flatMap((item) => {
    const definition = record(item)
    const code = typeof definition.code === 'string' ? definition.code : ''
    const name = typeof definition.name === 'string' ? definition.name : code
    if (!code) return []
    const version = record(definition.currentVersion ?? definition.version)
    const data = record(definition.data ?? version.data)
    return [
      {
        code,
        name,
        description:
          typeof definition.description === 'string'
            ? definition.description
            : undefined,
        enabled: definition.enabled === true,
        revision:
          typeof definition.revision === 'number' ? definition.revision : 0,
        versionId:
          typeof version.id === 'string'
            ? version.id
            : typeof definition.versionId === 'string'
              ? definition.versionId
              : '',
        versionRevision:
          typeof definition.versionRevision === 'number'
            ? definition.versionRevision
            : 0,
        canQuery: definition.canQuery === true,
        canExport: definition.canExport === true,
        parameters: Array.isArray(data.parameters)
          ? (data.parameters as RptParameter[])
          : [],
        columns: Array.isArray(data.columns)
          ? (data.columns as RptResultColumn[])
          : [],
        data:
          data.sql !== undefined
            ? (data as components['schemas']['RptVersionData'])
            : undefined,
      },
    ]
  })
}

function setSelected(code: string): void {
  selectedCode.value = code
  selected.value =
    definitions.value.find((definition) => definition.code === code) ?? null
  parameters.value = initialParameters(selected.value?.parameters ?? [])
  rows.value = []
  total.value = 0
  page.value = 1
  executedColumns.value = selected.value?.columns ?? []
  referenceOptions.value = {}
  void router.replace({ params: { ...route.params, code } })
}

async function loadDefinitions(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await apiClient.postContract(
      'rpt/definition/query' as never,
      { page: 1, pageSize: 200, includeDisabled: false } as never,
    )
    definitions.value = asDefinitions(response.data as unknown)
    const routeCode =
      typeof route.params.code === 'string' ? route.params.code : ''
    const deepLinkedCode = routeCode === 'report-center' ? '' : routeCode
    setSelected(deepLinkedCode || definitions.value[0]?.code || '')
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

function resultRows(data: unknown): ResultRow[] {
  const root = record(data)
  const values = root.items ?? root.rows ?? root.records ?? data
  return Array.isArray(values)
    ? values.filter(
        (row): row is ResultRow => row !== null && typeof row === 'object',
      )
    : []
}

async function query(): Promise<void> {
  if (!reportPermissions.value.canQuery || !selectedCode.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await apiClient.postContract(
      `rpt/${selectedCode.value}/query` as never,
      {
        parameters: executeParameters(
          selected.value?.parameters ?? [],
          parameters.value,
        ),
        page: page.value,
        pageSize,
      } as never,
    )
    rows.value = resultRows(response.data as unknown)
    const result = record(response.data)
    total.value =
      typeof result.total === 'number' ? result.total : rows.value.length
    executedColumns.value = Array.isArray(result.columns)
      ? (result.columns as RptResultColumn[])
      : (selected.value?.columns ?? [])
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    loading.value = false
  }
}

function queryFirstPage(): void {
  page.value = 1
  void query()
}

async function loadReference(
  parameter: RptParameter,
  keyword = '',
): Promise<void> {
  if (!selectedCode.value || parameter.type !== 'REFERENCE') return
  const requestId = (referenceRequestIds.value[parameter.key] ?? 0) + 1
  referenceRequestIds.value[parameter.key] = requestId
  try {
    const selectedId = parameters.value[parameter.key]
    const response = await apiClient.postContract(
      `rpt/${selectedCode.value}/reference-query` as never,
      {
        parameterKey: parameter.key,
        keyword: keyword.trim(),
        page: 1,
        pageSize: 50,
        ...(typeof selectedId === 'string' && selectedId ? { selectedId } : {}),
      } as never,
    )
    if (referenceRequestIds.value[parameter.key] !== requestId) return
    const result = record(response.data)
    const values = result.items ?? result.records ?? response.data
    referenceOptions.value[parameter.key] = Array.isArray(values)
      ? values.flatMap((item) => {
          const value = record(item)
          const id = value.id ?? value.code ?? value.value
          if (typeof id !== 'string') return []
          const label = value.name ?? value.label ?? id
          return [{ value: id, title: typeof label === 'string' ? label : id }]
        })
      : []
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  }
}

function drilldownTarget(row: ResultRow, column: RptResultColumn) {
  return vouDrilldown(row, column, session.can)
}

function openDrilldown(row: ResultRow, column: RptResultColumn): void {
  const target = drilldownTarget(row, column)
  if (target) void router.push(target)
}

async function exportReport(): Promise<void> {
  if (!reportPermissions.value.canExport || !selectedCode.value) return
  exporting.value = true
  errorMessage.value = ''
  try {
    // Export is deliberately independent from query: this never requests rows.
    const { blob, filename } = await apiClient.exportReportCsv(
      selectedCode.value,
      {
        parameters: executeParameters(
          selected.value?.parameters ?? [],
          parameters.value,
        ),
        page: 1,
        pageSize: 50,
      },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
    notice.value = '导出已完成。'
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    exporting.value = false
  }
}

function parseManagementData(): components['schemas']['RptVersionData'] | null {
  try {
    const data = JSON.parse(
      managementData.value,
    ) as components['schemas']['RptVersionData']
    if (
      !data ||
      typeof data.sql !== 'string' ||
      !Array.isArray(data.parameters) ||
      !Array.isArray(data.columns)
    ) {
      throw new Error('invalid')
    }
    return data
  } catch {
    errorMessage.value = '版本数据必须是包含 sql、parameters、columns 的 JSON。'
    return null
  }
}

async function manage(action: ReportDefinitionAction): Promise<void> {
  if (!managementPermissions.value[action]) return
  const code = managementCode.value.trim()
  if (!code) {
    errorMessage.value = '请填写报表编码。'
    return
  }
  const data = ['create', 'create-version', 'save'].includes(action)
    ? parseManagementData()
    : null
  if (['create', 'create-version', 'save'].includes(action) && !data) return
  const versionBody = {
    code,
    versionId: managementVersionId.value,
    revision: managementRevision.value,
  }
  const body =
    action === 'create'
      ? { code, name: code, data }
      : action === 'create-version'
        ? { code, data }
        : action === 'save'
          ? { ...versionBody, data }
          : action === 'enable' || action === 'disable' || action === 'delete'
            ? { code, revision: managementRevision.value }
            : versionBody
  try {
    await apiClient.postContract(
      `rpt/definition/${action}` as never,
      body as never,
    )
    notice.value = '管理操作已完成。'
    await loadDefinitions()
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  }
}

function editDefinition(definition: Definition): void {
  managementCode.value = definition.code
  managementVersionId.value = definition.versionId ?? ''
  managementRevision.value =
    definition.versionRevision ?? definition.revision ?? 0
  managementData.value = JSON.stringify(
    definition.data ?? {
      sql: '',
      parameters: definition.parameters ?? [],
      columns: definition.columns ?? [],
    },
    null,
    2,
  )
}

function selectManagementDefinition(code: string): void {
  const definition = definitions.value.find((item) => item.code === code)
  if (definition) editDefinition(definition)
}

watch(selected, (definition) => {
  if (definition) editDefinition(definition)
})
onMounted(loadDefinitions)
</script>

<template>
  <v-container class="rpt-center pa-4" fluid>
    <div class="d-flex align-center mb-4 ga-3">
      <h1 class="text-h5">报表中心</h1>
      <v-spacer />
      <v-btn v-if="managementAllowed" variant="text" @click="loadDefinitions"
        >刷新报表</v-btn
      >
    </div>

    <v-alert
      v-if="errorMessage"
      type="error"
      class="mb-3"
      closable
      @click:close="errorMessage = ''"
      >{{ errorMessage }}</v-alert
    >
    <v-alert
      v-if="notice"
      type="success"
      class="mb-3"
      closable
      @click:close="notice = ''"
      >{{ notice }}</v-alert
    >

    <v-row>
      <v-col cols="12" md="3">
        <v-card max-width="700">
          <v-card-title>可用报表</v-card-title>
          <v-list density="compact">
            <v-list-item
              v-for="definition in definitions"
              :key="definition.code"
              :active="definition.code === selectedCode"
              @click="setSelected(definition.code)"
            >
              <v-list-item-title>{{ definition.name }}</v-list-item-title>
              <v-list-item-subtitle>{{ definition.code }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>
      <v-col cols="12" md="9">
        <v-card max-width="700">
          <v-card-title>{{ selected?.name || '选择报表' }}</v-card-title>
          <v-card-subtitle v-if="selected"
            >{{ selected.code }} · {{ selected.description }}</v-card-subtitle
          >
          <v-card-text v-if="selected">
            <v-row>
              <v-col
                v-for="parameter in selected.parameters"
                :key="parameter.key"
                cols="12"
                sm="6"
              >
                <v-switch
                  v-if="parameter.type === 'BOOLEAN'"
                  v-model="parameters[parameter.key]"
                  :label="parameter.name"
                  color="primary"
                  hide-details
                />
                <v-select
                  v-else-if="parameter.type === 'ENUM'"
                  v-model="parameters[parameter.key] as string"
                  :label="parameter.name"
                  :items="parameter.enumValues ?? []"
                  :required="parameter.required"
                />
                <v-autocomplete
                  v-else-if="parameter.type === 'REFERENCE'"
                  v-model="parameters[parameter.key] as string"
                  :label="parameter.name"
                  :items="referenceOptions[parameter.key] ?? []"
                  :required="parameter.required"
                  @focus="loadReference(parameter)"
                  @update:search="loadReference(parameter, $event ?? '')"
                />
                <div
                  v-else-if="parameter.type === 'DATE_RANGE'"
                  class="d-flex ga-2"
                >
                  <v-text-field
                    v-model="(parameters[parameter.key] as [string, string])[0]"
                    :label="`${parameter.name}（起）`"
                    type="date"
                  />
                  <v-text-field
                    v-model="(parameters[parameter.key] as [string, string])[1]"
                    :label="`${parameter.name}（止）`"
                    type="date"
                  />
                </div>
                <v-text-field
                  v-else
                  v-model="parameters[parameter.key]"
                  :label="parameter.name"
                  :required="parameter.required"
                  :type="
                    parameter.type === 'DATE'
                      ? 'date'
                      : parameter.type === 'INTEGER' ||
                          parameter.type === 'DECIMAL'
                        ? 'number'
                        : 'text'
                  "
                />
              </v-col>
            </v-row>
            <div class="d-flex ga-2">
              <v-btn
                v-if="reportPermissions.canQuery"
                color="primary"
                :loading="loading"
                @click="queryFirstPage"
                >查询</v-btn
              >
              <v-btn
                v-if="reportPermissions.canExport"
                variant="outlined"
                :loading="exporting"
                @click="exportReport"
                >导出 CSV</v-btn
              >
            </div>
          </v-card-text>
        </v-card>

        <v-card
          v-if="reportPermissions.showResults && selected"
          class="mt-4"
          max-width="700"
        >
          <v-card-title>查询结果（{{ total }}）</v-card-title>
          <v-table class="rpt-desktop-results" density="compact">
            <thead>
              <tr>
                <th
                  v-for="column in resultColumns"
                  :key="column.alias"
                  :style="{ width: `${column.width}px` }"
                >
                  {{ column.name }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in rows" :key="index">
                <td v-for="column in resultColumns" :key="column.alias">
                  <v-btn
                    v-if="drilldownTarget(row, column)"
                    size="small"
                    variant="text"
                    @click="openDrilldown(row, column)"
                    >查看来源</v-btn
                  >
                  <span v-else>{{
                    formatResultValue(row[column.alias], column)
                  }}</span>
                </td>
              </tr>
            </tbody>
          </v-table>
          <div class="rpt-mobile-results">
            <v-card
              v-for="(row, index) in rows"
              :key="index"
              class="mb-3"
              variant="outlined"
            >
              <v-list density="compact">
                <v-list-item
                  v-for="column in resultColumns"
                  :key="column.alias"
                >
                  <template #prepend
                    ><span class="rpt-field-label">{{
                      column.name
                    }}</span></template
                  >
                  <v-list-item-title class="text-right">
                    <v-btn
                      v-if="drilldownTarget(row, column)"
                      size="small"
                      variant="text"
                      @click="openDrilldown(row, column)"
                      >查看来源</v-btn
                    >
                    <span v-else>{{
                      formatResultValue(row[column.alias], column)
                    }}</span>
                  </v-list-item-title>
                </v-list-item>
              </v-list>
            </v-card>
          </div>
          <v-pagination
            v-if="total > pageSize"
            v-model="page"
            class="mt-3"
            :length="pageCount"
            :total-visible="5"
            aria-label="报表结果分页"
            @update:model-value="query"
          />
        </v-card>
      </v-col>
    </v-row>

    <v-expansion-panels v-if="managementAllowed" class="mt-6" max-width="700">
      <v-expansion-panel title="报表定义与版本管理">
        <v-expansion-panel-text>
          <v-select
            v-model="managementCode"
            label="已有报表"
            :items="definitionOptions"
            @update:model-value="selectManagementDefinition"
          />
          <v-text-field v-model="managementCode" label="报表编码" />
          <v-text-field v-model="managementVersionId" label="版本 ID" />
          <v-text-field
            v-model.number="managementRevision"
            label="修订号"
            type="number"
          />
          <v-textarea
            v-model="managementData"
            label="版本数据 JSON"
            auto-grow
          />
          <div class="d-flex flex-wrap ga-2">
            <v-btn
              v-if="managementPermissions.create"
              size="small"
              @click="manage('create')"
              >新建定义</v-btn
            ><v-btn
              v-if="managementPermissions['create-version']"
              size="small"
              @click="manage('create-version')"
              >新建版本</v-btn
            ><v-btn
              v-if="managementPermissions.save"
              size="small"
              @click="manage('save')"
              >保存版本</v-btn
            ><v-btn
              v-if="managementPermissions.approve"
              size="small"
              @click="manage('approve')"
              >批准</v-btn
            ><v-btn
              v-if="managementPermissions.unapprove"
              size="small"
              @click="manage('unapprove')"
              >反批准</v-btn
            ><v-btn
              v-if="managementPermissions.enable"
              size="small"
              @click="manage('enable')"
              >启用</v-btn
            ><v-btn
              v-if="managementPermissions.disable"
              size="small"
              @click="manage('disable')"
              >停用</v-btn
            ><v-btn
              v-if="managementPermissions.delete"
              size="small"
              color="error"
              @click="manage('delete')"
              >删除</v-btn
            >
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-container>
</template>

<style scoped>
.rpt-mobile-results {
  display: none;
}
.rpt-field-label {
  min-width: 8rem;
  color: rgb(var(--v-theme-on-surface-variant));
}
@media (max-width: 700px) {
  .rpt-desktop-results {
    display: none;
  }
  .rpt-mobile-results {
    display: block;
  }
}
</style>
