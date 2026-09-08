import {
  FieldContractError,
  normalizeFilters,
  validateFields,
  validateRows,
  type ColumnField,
  type FilterField,
} from '../dynamic-fields/index.ts'
import type { EnabledListItem } from './vm.ts'

type TextColumn<Key extends string> = {
  key: Key
  type: 'text'
  caption: string
}
type EnabledColumn = {
  key: 'enabled'
  type: 'boolean'
  caption: string
  trueCaption?: string
  falseCaption?: string
}
type ActionsColumn = { key: '$actions'; type: 'actions'; caption: string }
export type ListColumns<Row extends EnabledListItem> = readonly [
  TextColumn<'code'>,
  TextColumn<'name'>,
  EnabledColumn,
  ...Exclude<
    ColumnField<Omit<Row, 'code' | 'name' | 'enabled'>>,
    { key: '$actions' }
  >[],
  ActionsColumn,
]
export type ListFilters<Filters extends { keyword: string }> = readonly [
  TextColumn<'keyword'>,
  ...FilterField<Omit<Filters, 'keyword'>>[],
]
export type ListPageDefinition<
  Row extends EnabledListItem,
  Filters extends { keyword: string },
> = {
  title: string
  createLabel: string
  columns: ListColumns<Row>
  filters: ListFilters<Filters>
  validateRows: (rows: readonly Row[]) => void
  normalizeFilters: (input: Filters) => Filters
}

export function defineListPage<
  Row extends EnabledListItem,
  Filters extends { keyword: string } = { keyword: string },
>(
  input: Pick<
    ListPageDefinition<Row, Filters>,
    'title' | 'createLabel' | 'columns' | 'filters'
  >,
): ListPageDefinition<Row, Filters> {
  // The tuple fixes base keys; generic keyof cannot reduce those literals.
  const columns = input.columns as unknown as readonly ColumnField<Row>[]
  const filters = input.filters as unknown as readonly FilterField<Filters>[]
  validateFields(columns, { usage: 'column' })
  validateFields(filters, { usage: 'filter' })
  const required = [
    ['code', 'text'],
    ['name', 'text'],
    ['enabled', 'boolean'],
  ] as const
  for (const [index, [key, type]] of required.entries()) {
    if (columns[index]?.key !== key || columns[index]?.type !== type)
      throw new FieldContractError('资料页必需列顺序或类型错误。')
  }
  if (columns.at(-1)?.key !== '$actions' || columns.at(-1)?.type !== 'actions')
    throw new FieldContractError('操作列必须唯一且位于末尾。')
  if (filters[0]?.key !== 'keyword' || filters[0]?.type !== 'text')
    throw new FieldContractError('资料页必须登记文本关键词筛选。')
  return {
    ...input,
    validateRows(rows) {
      const ids = new Set<string>()
      for (const row of rows) {
        if (
          !row ||
          ['id', 'code', 'py', 'name'].some(
            (key) => typeof row[key as keyof EnabledListItem] !== 'string',
          ) ||
          !row.id.trim() ||
          typeof row.enabled !== 'boolean' ||
          ids.has(row.id)
        )
          throw new FieldContractError('资料行身份或必需字段无效。')
        ids.add(row.id)
      }
      validateRows(columns, rows)
    },
    normalizeFilters(value) {
      return normalizeFilters(filters, value)
    },
  }
}
