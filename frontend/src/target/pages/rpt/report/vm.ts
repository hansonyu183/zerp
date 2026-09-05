import { computed, reactive, ref } from 'vue'

import type { RptColumn, RptParameter } from '@zerp/model'

import {
  exportTargetRpt,
  queryTargetRpt,
  queryTargetRptDirectory,
  queryTargetRptReference,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'

export interface RptDirectoryItem {
  subjectId: string
  approvalEntryId: string
  code: string
  name: string
  parameters: readonly RptParameter[]
  columns: readonly RptColumn[]
}

export interface RptQueryInput {
  parameters: Record<string, unknown>
  page: number
  pageSize: 20
}

export interface RptQueryResult {
  approvalEntryId: string
  columns: readonly RptColumn[]
  rows: Record<string, unknown>[]
  page: number
  pageSize: number
  hasMore: boolean
}

export interface RptReferenceQueryInput {
  parameterKey: string
  keyword?: string
  selectedId?: string
  page: 1
  pageSize: 20
}

export interface RptReferencePage {
  items: Record<string, string>[]
  total: number
  page: number
  pageSize: number
}

export interface RptReportContext {
  csrfToken: string
  permissions: readonly string[]
  reportCode: string
}

export interface RptReportPorts {
  directory(csrfToken: string): Promise<RptDirectoryItem[]>
  query(
    csrfToken: string,
    code: string,
    input: RptQueryInput,
  ): Promise<RptQueryResult>
  export(
    csrfToken: string,
    code: string,
    input: { parameters: Record<string, unknown> },
  ): Promise<Omit<RptQueryResult, 'page' | 'pageSize' | 'hasMore'>>
  reference(
    csrfToken: string,
    code: string,
    input: RptReferenceQueryInput,
  ): Promise<RptReferencePage>
  download(fileName: string, content: string): void
}

export function createRptReportViewModel(
  context: RptReportContext,
  ports: RptReportPorts,
) {
  const reportCode = ref(context.reportCode)
  const definition = ref<RptDirectoryItem | null>(null)
  const parameterValues = reactive<Record<string, unknown>>({})
  const referenceOptions = reactive<Record<string, Record<string, string>[]>>(
    {},
  )
  const columns = ref<RptColumn[]>([])
  const rows = ref<Record<string, unknown>[]>([])
  const page = ref(1)
  const hasMore = ref(false)
  const directoryLoading = ref(false)
  const queryLoading = ref(false)
  const loading = computed(() => directoryLoading.value || queryLoading.value)
  const exporting = ref(false)
  const error = ref<string | null>(null)
  let successfulQueryParameters: Record<string, unknown> | null = null
  let directorySequence = 0
  let querySequence = 0
  let referenceEpoch = 0
  let exportSequence = 0
  const referenceSequences = new Map<string, number>()

  const canQuery = computed(() =>
    context.permissions.includes(`/rpt/${reportCode.value}/query`),
  )
  const canExport = computed(() =>
    context.permissions.includes(`/rpt/${reportCode.value}/export`),
  )
  const visibleColumns = computed(() =>
    columns.value
      .filter((column) => column.visible)
      .slice()
      .sort((left, right) => left.order - right.order),
  )

  async function load(): Promise<void> {
    if (!canQuery.value && !canExport.value) {
      error.value = '没有权限使用该报表。'
      return
    }
    const sequence = ++directorySequence
    const code = reportCode.value
    directoryLoading.value = true
    try {
      const directory = await ports.directory(context.csrfToken)
      if (sequence !== directorySequence || code !== reportCode.value) return
      const current = directory.find((item) => item.code === code)
      if (!current) throw new Error('报表不可用或已失效。')
      definition.value = current
      columns.value = [...current.columns]
      rows.value = []
      page.value = 1
      hasMore.value = false
      successfulQueryParameters = null
      for (const key of Object.keys(parameterValues))
        delete parameterValues[key]
      for (const parameter of current.parameters)
        parameterValues[parameter.key] = initialParameterValue(parameter)
      error.value = null
    } catch (cause) {
      if (sequence === directorySequence && code === reportCode.value)
        error.value = errorMessage(cause, '报表定义加载失败。')
    } finally {
      if (sequence === directorySequence && code === reportCode.value)
        directoryLoading.value = false
    }
  }

  async function switchReport(code: string): Promise<void> {
    if (code === reportCode.value) return
    reportCode.value = code
    directorySequence += 1
    querySequence += 1
    referenceEpoch += 1
    exportSequence += 1
    directoryLoading.value = false
    queryLoading.value = false
    exporting.value = false
    definition.value = null
    columns.value = []
    rows.value = []
    page.value = 1
    hasMore.value = false
    successfulQueryParameters = null
    for (const key of Object.keys(parameterValues)) delete parameterValues[key]
    for (const key of Object.keys(referenceOptions))
      delete referenceOptions[key]
    error.value = null
    await load()
  }

  function executeParameters(): Record<string, unknown> {
    const current = definition.value
    if (!current) return {}
    return Object.fromEntries(
      current.parameters.map((parameter) => {
        const value = parameterValues[parameter.key]
        if (!parameter.required && isEmpty(parameter, value))
          return [parameter.key, null]
        if (parameter.type === 'INTEGER' && value !== '' && value !== null)
          return [parameter.key, Number(value)]
        if (parameter.type === 'DATE_RANGE')
          return [
            parameter.key,
            Array.isArray(value) ? value.slice(0, 2) : ['', ''],
          ]
        return [parameter.key, value]
      }),
    )
  }

  function validationError(): string | null {
    const current = definition.value
    if (!current) return '报表定义尚未加载。'
    for (const parameter of current.parameters) {
      const value = parameterValues[parameter.key]
      if (parameter.required && isEmpty(parameter, value))
        return `请填写${parameter.name}。`
      if (
        parameter.type === 'INTEGER' &&
        value !== '' &&
        !Number.isSafeInteger(Number(value))
      )
        return `${parameter.name}必须是整数。`
    }
    return null
  }

  async function query(nextPage = page.value): Promise<void> {
    if (!canQuery.value) return
    const sequence = ++querySequence
    const code = reportCode.value
    const priorParameters = successfulQueryParameters
    const startsNewQuery = nextPage === 1 || priorParameters === null
    if (startsNewQuery) {
      const invalid = validationError()
      if (invalid) {
        error.value = invalid
        return
      }
    }
    const parameters = startsNewQuery
      ? executeParameters()
      : copyParameters(priorParameters)
    queryLoading.value = true
    try {
      const result = await ports.query(context.csrfToken, code, {
        parameters,
        page: nextPage,
        pageSize: 20,
      })
      if (sequence !== querySequence || code !== reportCode.value) return
      if (nextPage > page.value && result.rows.length === 0) {
        hasMore.value = false
        error.value = null
        return
      }
      columns.value = [...result.columns]
      rows.value = result.rows
      page.value = result.page
      hasMore.value = result.hasMore
      if (startsNewQuery) successfulQueryParameters = copyParameters(parameters)
      error.value = null
    } catch (cause) {
      if (sequence === querySequence && code === reportCode.value)
        error.value = errorMessage(cause, '报表查询失败。')
    } finally {
      if (sequence === querySequence && code === reportCode.value)
        queryLoading.value = false
    }
  }

  async function loadReference(
    parameter: RptParameter,
    keyword = '',
    selectedId?: string,
  ): Promise<void> {
    if (parameter.type !== 'REFERENCE') return
    const search = keyword.trim()
    const sequence = (referenceSequences.get(parameter.key) ?? 0) + 1
    referenceSequences.set(parameter.key, sequence)
    const epoch = referenceEpoch
    const code = reportCode.value
    try {
      const result = await ports.reference(context.csrfToken, code, {
        parameterKey: parameter.key,
        ...(search ? { keyword: search } : {}),
        ...(selectedId ? { selectedId } : {}),
        page: 1,
        pageSize: 20,
      })
      if (
        epoch !== referenceEpoch ||
        sequence !== referenceSequences.get(parameter.key) ||
        code !== reportCode.value
      )
        return
      referenceOptions[parameter.key] = result.items
    } catch (cause) {
      if (
        epoch === referenceEpoch &&
        sequence === referenceSequences.get(parameter.key) &&
        code === reportCode.value
      )
        error.value = errorMessage(cause, `${parameter.name}选项加载失败。`)
    }
  }

  async function exportRows(): Promise<void> {
    if (!canExport.value) return
    const invalid = validationError()
    if (invalid) {
      error.value = invalid
      return
    }
    const sequence = ++exportSequence
    const code = reportCode.value
    exporting.value = true
    try {
      const result = await ports.export(context.csrfToken, code, {
        parameters: executeParameters(),
      })
      if (sequence !== exportSequence || code !== reportCode.value) return
      ports.download(`${code}.csv`, csv(result.columns, result.rows))
      error.value = null
    } catch (cause) {
      if (sequence === exportSequence && code === reportCode.value)
        error.value = errorMessage(cause, '报表导出失败。')
    } finally {
      if (sequence === exportSequence && code === reportCode.value)
        exporting.value = false
    }
  }

  return {
    reportCode,
    definition,
    parameterValues,
    referenceOptions,
    columns,
    rows,
    page,
    hasMore,
    loading,
    exporting,
    error,
    canQuery,
    canExport,
    visibleColumns,
    load,
    switchReport,
    validationError,
    query,
    loadReference,
    exportRows,
  }
}

export function useRptReportViewModel(reportCode: string) {
  const session = useTargetSession()
  if (!session.csrfToken)
    throw new Error('RPT page requires an authenticated session.')
  return createRptReportViewModel(
    {
      csrfToken: session.csrfToken,
      permissions: session.permissions,
      reportCode,
    },
    {
      directory: queryTargetRptDirectory,
      query: queryTargetRpt,
      export: exportTargetRpt,
      reference: queryTargetRptReference,
      download: downloadCsv,
    },
  )
}

function copyParameters(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(parameters).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  )
}

function initialParameterValue(parameter: RptParameter): unknown {
  if (parameter.defaultValue !== undefined) return parameter.defaultValue
  if (parameter.type === 'BOOLEAN') return false
  if (parameter.type === 'DATE_RANGE') return ['', '']
  return ''
}

function isEmpty(parameter: RptParameter, value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  return (
    parameter.type === 'DATE_RANGE' &&
    (!Array.isArray(value) || value.length !== 2 || value.some((item) => !item))
  )
}

function csv(
  columns: readonly RptColumn[],
  rows: readonly Record<string, unknown>[],
): string {
  const visible = columns
    .filter((column) => column.visible)
    .slice()
    .sort((left, right) => left.order - right.order)
  return `\uFEFF${[
    visible.map((column) => csvCell(column.name)).join(','),
    ...rows.map((row) =>
      visible.map((column) => csvCell(row[column.alias])).join(','),
    ),
  ].join('\r\n')}`
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function downloadCsv(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
