import { vouEntities, type VouEntity } from '@zerp/model'
import {
  FieldContractError,
  normalizeFilters,
  validateFields,
  validateRows,
  type ColumnField,
  type FilterField,
} from '../dynamic-fields/index.ts'
import type { FieldRange } from '../dynamic-fields/types.ts'

export type VouIdentity = {
  vouType: VouEntity
  documentId: string
  documentNo: string
  handlerName: string | null
  revision: string
}
export type VouFilters = {
  businessDate: FieldRange<string>
  documentNo: string
}
type TextColumn<K extends string> = { key: K; type: 'text'; caption: string }
export type VouColumns<Row extends VouIdentity> = readonly [
  TextColumn<'documentNo'>,
  TextColumn<'handlerName'>,
  ...Exclude<
    ColumnField<Omit<Row, 'documentNo' | 'handlerName'>>,
    { key: '$actions' }
  >[],
  { key: '$actions'; type: 'actions'; caption: string },
]
export type VouFilterFields<Filters extends VouFilters> = readonly [
  { key: 'businessDate'; type: 'date'; range: true; caption: string },
  TextColumn<'documentNo'>,
  ...FilterField<Omit<Filters, 'businessDate' | 'documentNo'>>[],
]
export type VouPageDefinition<
  Row extends VouIdentity,
  Filters extends VouFilters,
> = {
  vouType: VouEntity
  title: string
  columns: VouColumns<Row>
  filters: VouFilterFields<Filters>
  validateRows: (rows: readonly Row[]) => void
  normalizeFilters: (input: Filters) => Filters
}
export function defineVouPage<
  Row extends VouIdentity = VouIdentity,
  Filters extends VouFilters = VouFilters,
>(
  input: Pick<
    VouPageDefinition<Row, Filters>,
    'vouType' | 'title' | 'columns' | 'filters'
  >,
): VouPageDefinition<Row, Filters> {
  if (!vouEntities.includes(input.vouType))
    throw new FieldContractError('未登记的单据类型。')
  const columns = input.columns as unknown as readonly ColumnField<Row>[]
  const filters = input.filters as unknown as readonly FilterField<Filters>[]
  validateFields(columns, { usage: 'column' })
  validateFields(filters, { usage: 'filter' })
  if (
    columns[0]?.key !== 'documentNo' ||
    columns[0]?.type !== 'text' ||
    columns[1]?.key !== 'handlerName' ||
    columns[1]?.type !== 'text' ||
    columns.at(-1)?.key !== '$actions' ||
    columns.at(-1)?.type !== 'actions'
  )
    throw new FieldContractError('单据页必需列顺序或类型错误。')
  if (
    filters[0]?.key !== 'businessDate' ||
    filters[0]?.type !== 'date' ||
    filters[0]?.range !== true ||
    filters[1]?.key !== 'documentNo' ||
    filters[1]?.type !== 'text'
  )
    throw new FieldContractError('单据页必须登记期间范围和单号筛选。')
  return {
    ...input,
    validateRows(rows) {
      const ids = new Set<string>()
      for (const row of rows) {
        if (
          !row ||
          row.vouType !== input.vouType ||
          typeof row.documentId !== 'string' ||
          !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(row.documentId) ||
          ids.has(row.documentId) ||
          typeof row.documentNo !== 'string' ||
          !row.documentNo.trim() ||
          (row.handlerName !== null && typeof row.handlerName !== 'string') ||
          typeof row.revision !== 'string' ||
          !/^[1-9]\d*$/.test(row.revision)
        )
          throw new FieldContractError('单据行身份或必需字段无效。')
        ids.add(row.documentId)
      }
      validateRows(columns, rows)
    },
    normalizeFilters: (value) => normalizeFilters(filters, value),
  }
}

export function naturalMonth(now = new Date()): FieldRange<string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const year = parts.find((p) => p.type === 'year')!.value
  const month = parts.find((p) => p.type === 'month')!.value
  const last = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  return { from: `${year}-${month}-01`, to: `${year}-${month}-${last}` }
}
