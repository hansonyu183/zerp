import type { ReferenceSource } from './types.ts'

export class FieldContractError extends Error {
  readonly name = 'FieldContractError'
}

type UnknownField = Record<string, unknown>

const referenceSources = new Set<ReferenceSource>([
  'app/role',
  'bob/customer-subunit',
  'bob/supplier',
])

const commonKeys = new Set(['key', 'type', 'caption', 'required'])
const rangeKeys = new Set([...commonKeys, 'range'])
const keysByType: Readonly<Record<string, ReadonlySet<string>>> = {
  text: new Set([...commonKeys, 'emptyCaption']),
  integer: rangeKeys,
  decimal: new Set([...rangeKeys, 'scale']),
  date: rangeKeys,
  boolean: new Set([...commonKeys, 'trueCaption', 'falseCaption']),
  enum: new Set([...commonKeys, 'options']),
  reference: new Set([...commonKeys, 'source']),
  actions: new Set(['key', 'type', 'caption']),
}

function fail(message: string): never {
  throw new FieldContractError(message)
}

function assertNonEmptyString(value: unknown, description: string): void {
  if (typeof value !== 'string' || value.trim() === '')
    fail(`${description}必须是非空字符串`)
}

function validateField(
  field: unknown,
  usage: 'column' | 'filter',
): UnknownField {
  if (field === null || typeof field !== 'object' || Array.isArray(field))
    fail('字段配置必须是对象')
  const candidate = field as UnknownField
  assertNonEmptyString(candidate.key, '字段 key')
  if (
    candidate.key !== '$actions' &&
    (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate.key as string) ||
      ['__proto__', 'constructor', 'prototype'].includes(
        candidate.key as string,
      ))
  )
    fail('字段 key 必须是安全的顶层键')
  assertNonEmptyString(candidate.caption, '字段 caption')
  assertNonEmptyString(candidate.type, '字段 type')

  const allowedKeys = keysByType[candidate.type as string]
  if (!allowedKeys) fail(`未知字段类型 ${String(candidate.type)}`)
  for (const key of Object.keys(candidate))
    if (!allowedKeys.has(key) && !(usage === 'column' && key === 'width')) {
      if (key === 'range') fail(`字段 ${String(candidate.key)} 不支持 range`)
      fail(`字段 ${String(candidate.key)} 不允许配置 ${key}`)
    }

  if (
    candidate.required !== undefined &&
    typeof candidate.required !== 'boolean'
  )
    fail(`字段 ${String(candidate.key)} 的 required 必须是布尔值`)

  if (
    candidate.width !== undefined &&
    (typeof candidate.width !== 'number' ||
      !Number.isFinite(candidate.width) ||
      candidate.width <= 0)
  )
    fail('列宽必须是正数')
  if (
    candidate.emptyCaption !== undefined &&
    (usage !== 'column' || typeof candidate.emptyCaption !== 'string')
  )
    fail('空文本提示只允许用于文本列')
  const range = candidate.range
  if (range !== undefined && typeof range !== 'boolean')
    fail(`字段 ${String(candidate.key)} 的 range 必须是布尔值`)
  if (
    range === true &&
    !['integer', 'decimal', 'date'].includes(candidate.type as string)
  )
    fail(`字段 ${String(candidate.key)} 不支持 range`)
  if (usage === 'column' && range === true)
    fail(`列 ${String(candidate.key)} 不支持 range`)

  if (candidate.type === 'decimal') {
    if (
      !Number.isSafeInteger(candidate.scale) ||
      (candidate.scale as number) < 0 ||
      (candidate.scale as number) > 18
    )
      fail(`字段 ${String(candidate.key)} 的 scale 必须是 0 到 18 的安全整数`)
  }
  if (candidate.type === 'boolean') {
    if (
      candidate.trueCaption !== undefined &&
      typeof candidate.trueCaption !== 'string'
    )
      fail(`字段 ${String(candidate.key)} 的 trueCaption 必须是字符串`)
    if (
      candidate.falseCaption !== undefined &&
      typeof candidate.falseCaption !== 'string'
    )
      fail(`字段 ${String(candidate.key)} 的 falseCaption 必须是字符串`)
  }
  if (candidate.type === 'enum') {
    if (!Array.isArray(candidate.options) || candidate.options.length === 0)
      fail(`字段 ${String(candidate.key)} 必须登记 enum options`)
    const values = new Set<string>()
    for (const option of candidate.options as unknown[]) {
      if (
        option === null ||
        typeof option !== 'object' ||
        Array.isArray(option)
      )
        fail(`字段 ${String(candidate.key)} 的 enum option 非法`)
      const entry = option as UnknownField
      if (Object.keys(entry).some((key) => !['value', 'caption'].includes(key)))
        fail(`字段 ${String(candidate.key)} 的 enum option 含未允许配置`)
      assertNonEmptyString(entry.value, 'enum value')
      assertNonEmptyString(entry.caption, 'enum caption')
      if (values.has(entry.value as string))
        fail(`字段 ${String(candidate.key)} 的 enum value 重复`)
      values.add(entry.value as string)
    }
  }
  if (candidate.type === 'reference') {
    if (!referenceSources.has(candidate.source as ReferenceSource))
      fail(`字段 ${String(candidate.key)} 使用未登记的引用源`)
  }
  if (candidate.type === 'actions') {
    if (usage !== 'column') fail('actions 只允许用于列')
    if (candidate.key !== '$actions') fail('actions 列必须使用 $actions key')
  } else if (candidate.key === '$actions') {
    fail('$actions key 只允许 actions 类型')
  }
  return candidate
}

export function validateFields<const Fields extends readonly unknown[]>(
  fields: Fields,
  options: { usage: 'column' | 'filter'; requireActions?: boolean },
): Fields {
  if (!Array.isArray(fields)) fail('字段配置必须是数组')
  const keys = new Set<string>()
  let actionIndex = -1
  for (const [index, field] of fields.entries()) {
    const candidate = validateField(field, options.usage)
    const key = candidate.key as string
    if (keys.has(key)) fail(`字段 key ${key} 重复`)
    keys.add(key)
    if (candidate.type === 'actions') actionIndex = index
  }
  if (options.usage === 'column') {
    if (actionIndex < 0 && options.requireActions !== false)
      fail('列配置必须包含一个 actions 列')
    if (actionIndex >= 0 && actionIndex !== fields.length - 1)
      fail('操作列必须位于最后')
  }
  return fields
}
