import { toRaw } from 'vue'
import {
  queryTargetReportDirectory,
  queryTargetReportReference,
  TargetApiError,
} from '../../api.ts'
export type Definition = Awaited<
  ReturnType<typeof queryTargetReportDirectory>
>[number]
type Parameter = Definition['parameters'][number]
type Column = Definition['columns'][number]
export type ReferenceItem = Awaited<
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
export function message(error: unknown) {
  return error instanceof TargetApiError
    ? (errors[error.errorKey] ?? '报表请求失败。')
    : error instanceof Error && error.message.startsWith('rpt_')
      ? (errors[error.message] ?? '报表请求失败。')
      : '连接失败，请重试。'
}
export function copy<Value>(value: Value): Value {
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
export function normalize(parameter: Parameter, value: unknown): unknown {
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
export function csv(
  columns: Column[],
  rows: Record<string, unknown>[],
): string {
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
