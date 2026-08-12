import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import {
  executeParameters,
  formatResultValue,
  initialParameters,
  reportActions,
  reportDefinitionActions,
  reportPageCount,
  visibleColumns,
  vouDrilldown,
  type ReportDefinitionAction,
  type RptParameter,
  type RptResultColumn,
} from './shared/vm'

type ResultRow = Record<string, unknown>
type ReferenceItem = { title: string; value: string }
type VersionData = components['schemas']['RptVersionData']

export interface ReportDefinition {
  code: string
  name: string
  description: string
  enabled: boolean
  revision: number
  versionId: string
  versionRevision: number
  parameters: RptParameter[]
  columns: RptResultColumn[]
  data?: VersionData
}

function contractError(): Error {
  return new Error('报表接口返回格式错误。')
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError()
  }
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw contractError()
  return value
}

function number(value: unknown): number {
  if (typeof value !== 'number') throw contractError()
  return value
}

function optionalString(value: unknown): string {
  if (value === undefined) return ''
  return string(value)
}

function optionalNumber(value: unknown): number {
  if (value === undefined) return 0
  return number(value)
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw contractError()
  return value
}

function versionData(value: unknown): VersionData {
  const data = object(value)
  if (
    typeof data.sql !== 'string' ||
    !Array.isArray(data.parameters) ||
    !Array.isArray(data.columns)
  ) {
    throw contractError()
  }
  return data as unknown as VersionData
}

export function parseDefinitionPage(value: unknown): ReportDefinition[] {
  const page = object(value)
  if (!Array.isArray(page.items)) throw contractError()
  return page.items.map((item) => {
    const source = object(item)
    const data = versionData(source.data)
    return {
      code: string(source.code),
      name: string(source.name),
      description: string(source.description),
      enabled: boolean(source.enabled),
      revision: number(source.revision),
      versionId: optionalString(source.versionId),
      versionRevision: optionalNumber(source.versionRevision),
      parameters: data.parameters,
      columns: data.columns,
      data,
    }
  })
}

export function parseReportMetadata(value: unknown): ReportDefinition {
  const source = object(value)
  if (!Array.isArray(source.parameters) || !Array.isArray(source.columns)) {
    throw contractError()
  }
  return {
    code: string(source.code),
    name: string(source.name),
    description: string(source.description),
    enabled: true,
    revision: 0,
    versionId: '',
    versionRevision: 0,
    parameters: source.parameters as RptParameter[],
    columns: source.columns as RptResultColumn[],
  }
}

export function parseQueryResult(value: unknown): {
  items: ResultRow[]
  total: number
  columns: RptResultColumn[]
} {
  const source = object(value)
  if (
    !Array.isArray(source.items) ||
    !source.items.every(
      (item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item),
    ) ||
    !Array.isArray(source.columns)
  ) {
    throw contractError()
  }
  return {
    items: source.items as ResultRow[],
    total: number(source.total),
    columns: source.columns as RptResultColumn[],
  }
}

export function parseReferenceItems(value: unknown): ReferenceItem[] {
  const page = object(value)
  if (!Array.isArray(page.items)) throw contractError()
  return page.items.map((item) => {
    const source = object(item)
    const id = string(source.id)
    const code = string(source.code)
    const name = string(source.name)
    return { value: id, title: `${code} · ${name}` }
  })
}

export function useReportCenterViewModel() {
  const route = useRoute()
  const router = useRouter()
  const session = useSessionStore()
  const definitions = ref<ReportDefinition[]>([])
  const selectedCode = ref('')
  const selected = ref<ReportDefinition | null>(null)
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
  let disposed = false

  const reportPermissions = computed(() =>
    reportActions({
      query:
        Boolean(selectedCode.value) &&
        session.can(`/rpt/${selectedCode.value}/query`),
      export:
        Boolean(selectedCode.value) &&
        session.can(`/rpt/${selectedCode.value}/export`),
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
    reportDefinitionActions.some(
      (action) => managementPermissions.value[action],
    ),
  )
  const pageCount = computed(() => reportPageCount(total.value, pageSize))
  const definitionOptions = computed(() =>
    definitions.value.map((definition) => ({
      title: `${definition.name}（${definition.code}）`,
      value: definition.code,
    })),
  )

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
      if (session.can('/rpt/definition/query')) {
        const response = await apiClient.postContract('rpt/definition/query', {
          page: 1,
          pageSize: 200,
          includeDisabled: true,
        })
        definitions.value = parseDefinitionPage(response.data)
      } else {
        const response = await apiClient.postContract('rpt/directory/query', {
          page: 1,
          pageSize: 200,
        })
        const directory = object(response.data)
        if (!Array.isArray(directory.items)) throw contractError()
        definitions.value = directory.items.map(parseReportMetadata)
      }
      if (disposed) return
      const routeCode =
        typeof route.params.code === 'string' ? route.params.code : ''
      const deepLinkedCode = routeCode === 'report-center' ? '' : routeCode
      setSelected(deepLinkedCode || definitions.value[0]?.code || '')
    } catch (error) {
      if (!disposed) errorMessage.value = getErrorMessage(error)
    } finally {
      if (!disposed) loading.value = false
    }
  }

  async function query(): Promise<void> {
    if (!reportPermissions.value.canQuery || !selectedCode.value) return
    loading.value = true
    errorMessage.value = ''
    try {
      const response = await apiClient.postContract(
        `rpt/${selectedCode.value}/query`,
        {
          parameters: executeParameters(
            selected.value?.parameters ?? [],
            parameters.value,
          ),
          page: page.value,
          pageSize,
        },
      )
      const result = parseQueryResult(response.data)
      rows.value = result.items
      total.value = result.total
      executedColumns.value = result.columns
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
        `rpt/${selectedCode.value}/reference-query`,
        {
          parameterKey: parameter.key,
          keyword: keyword.trim(),
          page: 1,
          pageSize: 50,
          ...(typeof selectedId === 'string' && selectedId
            ? { selectedId }
            : {}),
        },
      )
      if (disposed || referenceRequestIds.value[parameter.key] !== requestId) {
        return
      }
      referenceOptions.value[parameter.key] = parseReferenceItems(response.data)
    } catch (error) {
      if (!disposed) errorMessage.value = getErrorMessage(error)
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

  function parseManagementData(): VersionData | null {
    try {
      return versionData(JSON.parse(managementData.value))
    } catch {
      errorMessage.value =
        '版本数据必须是包含 sql、parameters、columns 的 JSON。'
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
    const needsData = ['create', 'create-version', 'save'].includes(action)
    const data = needsData ? parseManagementData() : null
    if (needsData && !data) return
    const versionBody = {
      code,
      versionId: managementVersionId.value,
      revision: managementRevision.value,
    }
    const body =
      action === 'create'
        ? { code, name: code, data: data! }
        : action === 'create-version'
          ? { code, data: data! }
          : action === 'save'
            ? { ...versionBody, data: data! }
            : action === 'enable' || action === 'disable' || action === 'delete'
              ? { code, revision: managementRevision.value }
              : versionBody
    try {
      await apiClient.postContract(`rpt/definition/${action}`, body)
      notice.value = '管理操作已完成。'
      await loadDefinitions()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  function editDefinition(definition: ReportDefinition): void {
    managementCode.value = definition.code
    managementVersionId.value = definition.versionId
    managementRevision.value = definition.versionRevision || definition.revision
    managementData.value = JSON.stringify(
      definition.data ?? {
        sql: '',
        parameters: definition.parameters,
        columns: definition.columns,
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
  onBeforeUnmount(() => {
    disposed = true
  })

  return {
    definitionOptions,
    definitions,
    drilldownTarget,
    errorMessage,
    executedColumns,
    exporting,
    exportReport,
    formatResultValue,
    loadDefinitions,
    loadReference,
    loading,
    managementAllowed,
    managementCode,
    managementData,
    managementPermissions,
    managementRevision,
    managementVersionId,
    manage,
    notice,
    openDrilldown,
    page,
    pageCount,
    pageSize,
    parameters,
    query,
    queryFirstPage,
    referenceOptions,
    reportPermissions,
    resultColumns,
    rows,
    selected,
    selectedCode,
    selectManagementDefinition,
    setSelected,
    total,
  }
}
