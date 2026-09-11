import type {
  ColumnField,
  FieldRange,
  FilterField,
  ReferenceSummary,
} from './types.ts'

interface TypeTestRow {
  name: string
  quantityScale: number
  enabled: boolean
  role: ReferenceSummary | null
}

interface TypeTestFilters {
  keyword: string
  quantityScale: number | null
  amount: FieldRange<string>
  roleId: string | null
}

export const validColumnTypeProof = [
  { key: 'name', type: 'text', caption: '名称' },
  { key: 'quantityScale', type: 'integer', caption: '精度' },
  { key: 'enabled', type: 'boolean', caption: '状态' },
  { key: 'role', type: 'reference', caption: '角色', source: 'app/role' },
  { key: '$actions', type: 'actions', caption: '操作' },
] as const satisfies readonly ColumnField<TypeTestRow>[]

export const validFilterTypeProof = [
  { key: 'keyword', type: 'text', caption: '关键词' },
  { key: 'quantityScale', type: 'integer', caption: '精度' },
  { key: 'amount', type: 'decimal', caption: '金额', scale: 2, range: true },
  { key: 'roleId', type: 'reference', caption: '角色', source: 'app/role' },
] as const satisfies readonly FilterField<TypeTestFilters>[]

// @ts-expect-error a numeric row value cannot be rendered as text
export const invalidNumericText: ColumnField<TypeTestRow> = {
  key: 'quantityScale',
  type: 'text',
  caption: '精度',
}

// @ts-expect-error a string column is not a reference summary
export const invalidStringReference: ColumnField<TypeTestRow> = {
  key: 'name',
  type: 'reference',
  caption: '角色',
  source: 'app/role',
}

// @ts-expect-error range shape requires range: true
export const invalidScalarRange: FilterField<TypeTestFilters> = {
  key: 'amount',
  type: 'decimal',
  caption: '金额',
  scale: 2,
}

// @ts-expect-error decimal fields always declare scale
export const invalidDecimalWithoutScale: FilterField<TypeTestFilters> = {
  key: 'amount',
  type: 'decimal',
  caption: '金额',
  range: true,
}

export const invalidFilterEmptyCaption: FilterField = {
  key: 'keyword',
  type: 'text',
  caption: '关键词',
  // @ts-expect-error Empty text presentation belongs to columns, not filters.
  emptyCaption: '',
}
