import { computed, ref, shallowRef, toRaw, watch } from 'vue'
import {
  queryTargetReportDirectory,
  queryTargetReport,
  exportTargetReport,
  queryTargetReportReference,
  TargetApiError,
} from '../../api.ts'
import { useTargetSession } from '../../session/vm.ts'

type Definition = Awaited<ReturnType<typeof queryTargetReportDirectory>>[number]
type Parameter = Definition['parameters'][number]
type Column = Definition['columns'][number]
type ReferenceItem = Awaited<
  ReturnType<typeof queryTargetReportReference>
>['items'][number]
const errors: Record<string, string> = {
  rpt_permission_denied: '没有此操作权限。',
  forbidden: '没有此操作权限。',
  rpt_definition_not_executable: '报表当前不可用，请联系维护人员修正定义。',
  rpt_parameter_required: '请填写所有必填参数。',
  rpt_parameter_invalid: '参数格式不正确，请检查输入。',
  rpt_parameter_unknown: '参数与当前报表不一致，请重新打开报表。',
  rpt_parameter_contract_mismatch: '报表参数定义不完整，请联系维护人员。',
  rpt_result_columns_mismatch: '报表结果列不匹配，请联系维护人员。',
  rpt_result_column_type_mismatch: '报表结果类型不匹配，请联系维护人员。',
  rpt_export_limit_exceeded: '导出结果超过十万条，请缩小查询范围。',
  rpt_reference_invalid: '所选引用已不可用，请重新选择。',
  rpt_reference_ambiguous: '引用身份不唯一，请联系维护人员。',
  rpt_reference_unavailable: '引用来源不可用。',
  rpt_reference_parameter_invalid: '引用参数不匹配，请重新打开报表。',
  rpt_reference_query_invalid: '引用查询条件不正确。',
  rpt_pagination_invalid: '分页条件不正确。',
  rpt_execution_failed: '报表执行失败，请稍后重试。',
  validation_failed: '输入格式不正确。',
}
function message(error: unknown) {
  return error instanceof TargetApiError
    ? (errors[error.errorKey] ?? '报表请求失败。')
    : error instanceof Error && error.message.startsWith('rpt_')
      ? (errors[error.message] ?? '报表请求失败。')
      : '连接失败，请重试。'
}
function copy<Value>(value: Value): Value {
  return structuredClone(toRaw(value))
}
function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
function normalize(parameter: Parameter, value: unknown): unknown {
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.every((item) => !item))
  ) {
    if (parameter.required) throw new Error('rpt_parameter_required')
    return null
  }
  switch (parameter.type) {
    case 'TEXT':
      if (typeof value === 'string') return value
      break
    case 'INTEGER': {
      if (typeof value === 'string' && !/^-?\d+$/.test(value)) break
      const number = Number(value)
      if (Number.isSafeInteger(number)) return number
      break
    }
    case 'DECIMAL':
      if (
        typeof value === 'string' &&
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
      )
        return value
      break
    case 'BOOLEAN':
      if (typeof value === 'boolean') return value
      break
    case 'DATE':
      if (validDate(value)) return value
      break
    case 'DATE_RANGE':
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        validDate(value[0]) &&
        validDate(value[1]) &&
        value[0] <= value[1]
      )
        return [...value]
      break
    case 'ENUM':
      if (typeof value === 'string' && parameter.enumValues?.includes(value))
        return value
      break
    case 'REFERENCE':
      if (typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value))
        return value
      break
  }
  throw new Error('rpt_parameter_invalid')
}
export function reportCell(column: Column, value: unknown): string {
  if (value === null) return '—'
  if (column.type === 'BOOLEAN' && typeof value === 'boolean')
    return value ? '是' : '否'
  if (
    column.type === 'INTEGER' &&
    ((typeof value === 'number' && Number.isSafeInteger(value)) ||
      (typeof value === 'string' && /^-?\d+$/.test(value)))
  )
    return String(value)
  if (
    column.type === 'DECIMAL' &&
    typeof value === 'string' &&
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
  )
    return value
  if (
    ['TEXT', 'ID', 'DATE', 'DATETIME'].includes(column.type) &&
    typeof value === 'string'
  )
    return value
  throw new Error('rpt_result_column_type_mismatch')
}
function csv(columns: Column[], rows: Record<string, unknown>[]): string {
  const visible = columns.filter((column) => column.visible)
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`
  const lines = [visible.map((column) => escape(column.name)).join(',')]
  for (const row of rows)
    lines.push(
      visible
        .map((column) => {
          const value = reportCell(column, row[column.alias])
          return escape(
            ['TEXT', 'ID'].includes(column.type) && /^[=+@-]/.test(value)
              ? `'${value}`
              : value,
          )
        })
        .join(','),
    )
  return '\ufeff' + lines.join('\r\n')
}
export function useReportViewModel(code: string) {
  const session = useTargetSession()
  const canQuery = computed(() =>
    session.apiPaths.includes(`/rpt/${code}/query`),
  )
  const canExport = computed(() =>
    session.apiPaths.includes(`/rpt/${code}/export`),
  )
  const definition = shallowRef<Definition | null>(null),
    parameterInput = ref<Record<string, unknown>>({}),
    appliedParameters = ref<Record<string, unknown> | null>(null)
  const rows = ref<Record<string, unknown>[]>([]),
    columns = ref<Column[]>([]),
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
    if (!definition.value) throw new Error('rpt_definition_not_executable')
    return Object.fromEntries(
      definition.value.parameters.map((parameter) => [
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
        for (const column of result.columns)
          reportCell(column, row[column.alias])
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
    if (
      !disposed &&
      !loading.value &&
      targetPage > 0 &&
      appliedParameters.value
    )
      await query(targetPage, copy(appliedParameters.value))
  }
  async function loadReference(key: string, keyword = '', targetPage = 1) {
    if (disposed || (!canQuery.value && !canExport.value) || !session.csrfToken)
      return
    if (
      !definition.value?.parameters.some(
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
      definition.value = directory.find((item) => item.code === code) ?? null
      if (!definition.value) throw new Error('rpt_definition_not_executable')
      columns.value = definition.value.columns
      parameterInput.value = Object.fromEntries(
        definition.value.parameters.map((parameter) => [
          parameter.key,
          parameter.defaultValue === undefined
            ? null
            : copy(parameter.defaultValue),
        ]),
      )
      loading.value = false
      await Promise.all(
        definition.value.parameters
          .filter((parameter) => parameter.type === 'REFERENCE')
          .map((parameter) => loadReference(parameter.key)),
      )
      if (
        canQuery.value &&
        definition.value.parameters.every(
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
      if (!disposed && generation === exportRequest)
        error.value = message(caught)
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
    definition.value = null
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
  return {
    definition,
    parameterInput,
    appliedParameters,
    rows,
    columns,
    displayRows,
    page,
    hasMore,
    loading,
    exporting,
    error,
    references,
    canQuery,
    canExport,
    initialize,
    search,
    goToPage,
    loadReference,
    exportReport,
    dispose,
    setValue,
    setRange,
    rangeValue,
    referenceOptions,
  }
}
