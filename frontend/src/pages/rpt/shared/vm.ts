import type { components } from '@/api/generated/schema'
import { voucherEntityConfigs } from '@/pages/vou/shared/config'

export type RptParameter = components['schemas']['RptParameter']
export type RptResultColumn = components['schemas']['RptResultColumn']

export interface ReportPermissionSet {
  query: boolean
  export: boolean
}

export function initialParameters(
  parameters: readonly RptParameter[],
): Record<string, unknown> {
  return Object.fromEntries(
    parameters.map((parameter) => {
      if (parameter.type === 'DATE_RANGE') {
        const value = parameter.defaultValue
        return [
          parameter.key,
          Array.isArray(value) && value.length === 2 ? value : ['', ''],
        ]
      }
      if (parameter.defaultValue !== undefined)
        return [parameter.key, parameter.defaultValue]
      if (parameter.type === 'BOOLEAN') return [parameter.key, false]
      return [parameter.key, '']
    }),
  )
}

/** Converts Vuetify form values to the exact RPT execution value shapes. */
export function executeParameters(
  definitions: readonly RptParameter[],
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    definitions.map((parameter) => {
      const value = values[parameter.key]
      if (parameter.type === 'DATE_RANGE') {
        return [
          parameter.key,
          Array.isArray(value) ? value.slice(0, 2) : ['', ''],
        ]
      }
      if (parameter.type === 'INTEGER') {
        return [
          parameter.key,
          value === '' || value === undefined ? value : Number(value),
        ]
      }
      return [parameter.key, value]
    }),
  )
}

export function visibleColumns(
  columns: readonly RptResultColumn[],
): RptResultColumn[] {
  return columns
    .filter((column) => column.visible)
    .slice()
    .sort((left, right) => left.order - right.order)
}

export function reportActions(permissions: ReportPermissionSet): {
  canQuery: boolean
  canExport: boolean
  showResults: boolean
} {
  return {
    canQuery: permissions.query,
    canExport: permissions.export,
    // Export permission intentionally does not disclose the result set.
    showResults: permissions.query,
  }
}

export function formatResultValue(
  value: unknown,
  column: RptResultColumn,
): string {
  if (value === null || value === undefined) return ''
  if (column.type === 'BOOLEAN') return value ? '是' : '否'
  if (column.type === 'DATE') return String(value).slice(0, 10)
  if (column.type === 'DATETIME') {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleString('zh-CN')
  }
  if (column.type === 'DECIMAL' || column.type === 'INTEGER') {
    const number = Number(value)
    if (!Number.isFinite(number)) return String(value)
    if (column.format === 'money') {
      return new Intl.NumberFormat('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(number)
    }
    if (column.format === 'quantity') {
      return new Intl.NumberFormat('zh-CN', {
        maximumFractionDigits: 6,
      }).format(number)
    }
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 20 }).format(
      number,
    )
  }
  return String(value)
}

export interface RptDrilldownTarget {
  path: string
  query: { documentId: string }
}

const STABLE_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i

export function vouDrilldown(
  row: Readonly<Record<string, unknown>>,
  column: RptResultColumn,
  can: (permission: string) => boolean,
): RptDrilldownTarget | null {
  if (column.drilldownEntity !== 'VOU') return null
  const documentId = row[column.alias]
  const entity = row.source_entity
  if (
    typeof documentId !== 'string' ||
    !STABLE_ID_PATTERN.test(documentId) ||
    typeof entity !== 'string' ||
    !Object.prototype.hasOwnProperty.call(voucherEntityConfigs, entity) ||
    !can(`/vou/${entity}/get`)
  ) {
    return null
  }
  return { path: `/vou/${entity}`, query: { documentId } }
}
