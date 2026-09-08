import { FieldContractError, validateFields } from './contract.ts'
import { compareDecimal, formatDecimal } from './decimal.ts'
import type {
  ColumnField,
  DataField,
  FieldRange,
  FilterField,
  ReferenceSummary,
} from './types.ts'

function fail(message: string): never {
  throw new FieldContractError(message)
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]!
}

function isReferenceSummary(value: unknown): value is ReferenceSummary {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const candidate = value as Record<string, unknown>
  return (
    Object.keys(candidate).every((key) => key === 'id' || key === 'name') &&
    typeof candidate.id === 'string' &&
    candidate.id !== '' &&
    typeof candidate.name === 'string' &&
    candidate.name !== ''
  )
}

function validateScalar(
  field: DataField,
  value: unknown,
  usage: 'column' | 'filter',
): void {
  if (isEmpty(value)) {
    if (field.required) fail(`字段 ${field.key} 必需值缺失`)
    return
  }
  switch (field.type) {
    case 'text':
      if (typeof value !== 'string') fail(`字段 ${field.key} 必须是字符串`)
      return
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value))
        fail(`字段 ${field.key} 必须是安全整数`)
      return
    case 'decimal':
      if (typeof value !== 'string')
        fail(`字段 ${field.key} 必须是十进制字符串`)
      formatDecimal(value as string, field.scale)
      return
    case 'date':
      if (!isCalendarDate(value))
        fail(`字段 ${field.key} 必须是有效 YYYY-MM-DD 日期`)
      return
    case 'boolean':
      if (typeof value !== 'boolean') fail(`字段 ${field.key} 必须是布尔值`)
      return
    case 'enum':
      if (
        typeof value !== 'string' ||
        !field.options.some((option) => option.value === value)
      )
        fail(`字段 ${field.key} 包含未知 enum value`)
      return
    case 'reference':
      if (
        usage === 'filter'
          ? typeof value !== 'string'
          : !isReferenceSummary(value)
      )
        fail(`字段 ${field.key} 引用值非法`)
      return
  }
}

function validateRange(field: DataField, value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(`字段 ${field.key} 范围必须是 from/to 对象`)
  const range = value as Record<string, unknown>
  if (
    !Object.keys(range).every((key) => key === 'from' || key === 'to') ||
    !('from' in range) ||
    !('to' in range)
  )
    fail(`字段 ${field.key} 范围必须仅包含 from/to`)
  validateScalar({ ...field, range: false } as DataField, range.from, 'filter')
  validateScalar({ ...field, range: false } as DataField, range.to, 'filter')
  if (isEmpty(range.from) || isEmpty(range.to)) return

  let comparison: number
  if (field.type === 'decimal')
    comparison = compareDecimal(range.from as string, range.to as string)
  else if (field.type === 'integer')
    comparison = (range.from as number) - (range.to as number)
  else comparison = (range.from as string).localeCompare(range.to as string)
  if (comparison > 0) fail(`字段 ${field.key} 范围起点不能大于终点`)
}

export function validateRows<
  Row extends object,
  const Fields extends readonly unknown[],
>(fields: Fields, rows: readonly Row[]): readonly Row[] {
  validateFields(fields, { usage: 'column' })
  if (!Array.isArray(rows)) fail('列数据必须是数组')
  const identities = new Set<string>()
  for (const [index, row] of rows.entries()) {
    if (row === null || typeof row !== 'object' || Array.isArray(row))
      fail(`第 ${index + 1} 行必须是对象`)
    const candidate = row as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(candidate, 'id')) {
      if (typeof candidate.id !== 'string' || candidate.id === '')
        fail(`第 ${index + 1} 行身份非法`)
      if (identities.has(candidate.id)) fail(`重复行身份 ${candidate.id}`)
      identities.add(candidate.id)
    }
    for (const rawField of fields) {
      const field = rawField as ColumnField<Row>
      if (field.type === 'actions') continue
      validateScalar(field as DataField, candidate[field.key], 'column')
    }
  }
  return rows
}

function emptyValue(field: FilterField): unknown {
  if (field.range === true) return { from: null, to: null }
  if (
    field.type === 'integer' ||
    field.type === 'boolean' ||
    field.type === 'reference'
  )
    return null
  return ''
}

function normalizeScalar(field: FilterField, value: unknown): unknown {
  if (isEmpty(value))
    return emptyValue({ ...field, range: false } as FilterField)
  validateScalar(field as DataField, value, 'filter')
  return value
}

function normalizeRangeEndpoint(field: FilterField, value: unknown): unknown {
  if (isEmpty(value)) return null
  validateScalar({ ...field, range: false } as DataField, value, 'filter')
  return value
}

export function normalizeFilters<Filters extends object>(
  fields: readonly FilterField<Filters>[],
  input: Readonly<Filters>,
): Filters {
  validateFields(fields, { usage: 'filter' })
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    fail('筛选值必须是对象')
  const source = input as Record<string, unknown>
  const registeredKeys = new Set(
    fields.map((field) => (field as FilterField).key),
  )
  const unknownKey = Object.keys(source).find((key) => !registeredKeys.has(key))
  if (unknownKey) fail(`未登记筛选键 ${unknownKey}`)
  const result: Record<string, unknown> = {}
  for (const rawField of fields) {
    const field = rawField as FilterField<Filters>
    const value = source[field.key]
    if (field.range === true) {
      const rawRange = isEmpty(value) ? {} : value
      if (
        rawRange === null ||
        typeof rawRange !== 'object' ||
        Array.isArray(rawRange)
      )
        fail(`字段 ${field.key} 范围必须是 from/to 对象`)
      const candidate = rawRange as Record<string, unknown>
      if (
        !Object.keys(candidate).every((key) => key === 'from' || key === 'to')
      )
        fail(`字段 ${field.key} 范围必须仅包含 from/to`)
      result[field.key] = {
        from: normalizeRangeEndpoint(field, candidate.from),
        to: normalizeRangeEndpoint(field, candidate.to),
      } satisfies FieldRange<unknown>
      validateRange(field as DataField, result[field.key])
    } else {
      result[field.key] = normalizeScalar(field, value)
    }
  }
  return result as Filters
}

export function assertFieldValue(
  field: DataField,
  value: unknown,
  usage: 'column' | 'filter' = 'column',
): void {
  if (field.range === true) validateRange(field, value)
  else validateScalar(field, value, usage)
}
