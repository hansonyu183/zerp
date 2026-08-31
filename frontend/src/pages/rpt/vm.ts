import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiClient } from '@/api/client'
import { getDiagnosticErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'
import { downloadBlob } from '@/utils/download'
import {
  executeParameters,
  formatResultValue,
  initialParameters,
  reportActions,
  reportPageCount,
  validateReportParameterValues,
  visibleColumns,
  vouDrilldown,
  type RptParameter,
  type RptResultColumn,
} from './shared/vm'

type ResultRow = Record<string, unknown>
type ReferenceItem = { title: string; value: string }
export interface ReportDefinition {
  code: string
  name: string
  description: string
  parameters: RptParameter[]
  columns: RptResultColumn[]
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

export function parseReportMetadata(value: unknown): ReportDefinition {
  const source = object(value)
  if (!Array.isArray(source.parameters) || !Array.isArray(source.columns)) {
    throw contractError()
  }
  return {
    code: string(source.code),
    name: string(source.name),
    description: string(source.description),
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

export function useReportViewModel() {
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
  const referenceLoading = ref<Record<string, boolean>>({})
  const referenceErrors = ref<Record<string, string>>({})
  const referenceRequestIds = ref<Record<string, number>>({})
  // Keep the last label we saw for each selected reference ID so a failed
  // refresh can drop stale candidates without making the current value
  // impossible to render.
  const referenceItemsById = ref<Record<string, Record<string, ReferenceItem>>>(
    {},
  )
  let disposed = false
  let queryGeneration = 0

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
  const pageCount = computed(() => reportPageCount(total.value, pageSize))
  const definitionOptions = computed(() =>
    definitions.value.map((definition) => ({
      title: `${definition.name}（${definition.code}）`,
      value: definition.code,
    })),
  )

  function setSelected(code: string): void {
    queryGeneration += 1
    selectedCode.value = code
    selected.value =
      definitions.value.find((definition) => definition.code === code) ?? null
    parameters.value = initialParameters(selected.value?.parameters ?? [])
    rows.value = []
    total.value = 0
    page.value = 1
    executedColumns.value = selected.value?.columns ?? []
    referenceOptions.value = {}
    referenceLoading.value = {}
    referenceErrors.value = {}
    referenceItemsById.value = {}
    errorMessage.value = ''
    loading.value = false
    for (const parameter of selected.value?.parameters ?? []) {
      if (parameter.type === 'REFERENCE') void loadReference(parameter)
    }
  }

  async function loadDefinitions(preferredCode = ''): Promise<void> {
    loading.value = true
    errorMessage.value = ''
    try {
      const response = await apiClient.postContract('rpt/directory/query', {
        page: 1,
        pageSize: 200,
      })
      const directory = object(response.data)
      if (!Array.isArray(directory.items)) throw contractError()
      definitions.value = directory.items.map(parseReportMetadata)
      if (disposed) return
      const routeCode =
        typeof route.meta.reportCode === 'string' ? route.meta.reportCode : ''
      setSelected(
        preferredCode || routeCode || definitions.value[0]?.code || '',
      )
    } catch (error) {
      if (!disposed) errorMessage.value = getDiagnosticErrorMessage(error)
    } finally {
      if (!disposed) loading.value = false
    }
  }

  async function query(): Promise<void> {
    if (!reportPermissions.value.canQuery || !selectedCode.value) return
    const code = selectedCode.value
    const requestGeneration = ++queryGeneration
    const validation = validateReportParameterValues(
      code,
      selected.value?.parameters ?? [],
      parameters.value,
    )
    if (validation) {
      errorMessage.value = validation
      loading.value = false
      return
    }
    loading.value = true
    errorMessage.value = ''
    try {
      const response = await apiClient.postContract(`rpt/${code}/query`, {
        parameters: executeParameters(
          selected.value?.parameters ?? [],
          parameters.value,
        ),
        page: page.value,
        pageSize,
      })
      const result = parseQueryResult(response.data)
      if (
        disposed ||
        queryGeneration !== requestGeneration ||
        selectedCode.value !== code
      ) {
        return
      }
      rows.value = result.items
      total.value = result.total
      executedColumns.value = result.columns
    } catch (error) {
      if (
        !disposed &&
        queryGeneration === requestGeneration &&
        selectedCode.value === code
      ) {
        errorMessage.value = getDiagnosticErrorMessage(error)
      }
    } finally {
      if (
        !disposed &&
        queryGeneration === requestGeneration &&
        selectedCode.value === code
      ) {
        loading.value = false
      }
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
    referenceLoading.value[parameter.key] = true
    referenceErrors.value[parameter.key] = ''
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
      const items = parseReferenceItems(response.data)
      const itemCache = referenceItemsById.value[parameter.key] ?? {}
      for (const item of items) itemCache[item.value] = item
      referenceItemsById.value[parameter.key] = itemCache
      const currentSelectedId = parameters.value[parameter.key]
      const selectedItem =
        typeof currentSelectedId === 'string' && currentSelectedId
          ? itemCache[currentSelectedId]
          : undefined
      referenceOptions.value[parameter.key] = selectedItem
        ? [
            selectedItem,
            ...items.filter((item) => item.value !== selectedItem.value),
          ]
        : items
    } catch (error) {
      if (!disposed && referenceRequestIds.value[parameter.key] === requestId) {
        const selectedId = parameters.value[parameter.key]
        const selectedItem =
          typeof selectedId === 'string' && selectedId
            ? (referenceItemsById.value[parameter.key]?.[selectedId] ??
              referenceOptions.value[parameter.key]?.find(
                (item) => item.value === selectedId,
              ))
            : undefined
        referenceOptions.value[parameter.key] = selectedItem
          ? [selectedItem]
          : []
        referenceErrors.value[parameter.key] =
          `引用数据加载失败：${getDiagnosticErrorMessage(error)}`
      }
    } finally {
      if (!disposed && referenceRequestIds.value[parameter.key] === requestId) {
        referenceLoading.value[parameter.key] = false
      }
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
    const validation = validateReportParameterValues(
      selectedCode.value,
      selected.value?.parameters ?? [],
      parameters.value,
    )
    if (validation) {
      errorMessage.value = validation
      return
    }
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
      downloadBlob(blob, filename)
      notice.value = '导出已完成。'
    } catch (error) {
      errorMessage.value = getDiagnosticErrorMessage(error)
    } finally {
      exporting.value = false
    }
  }

  watch(
    () => route.meta.reportCode,
    (code) => {
      if (
        typeof code === 'string' &&
        definitions.value.some((definition) => definition.code === code)
      ) {
        setSelected(code)
      }
    },
  )
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
    notice,
    openDrilldown,
    page,
    pageCount,
    pageSize,
    parameters,
    query,
    queryFirstPage,
    referenceLoading,
    referenceErrors,
    referenceOptions,
    reportPermissions,
    resultColumns,
    rows,
    selected,
    selectedCode,
    setSelected,
    total,
  }
}
