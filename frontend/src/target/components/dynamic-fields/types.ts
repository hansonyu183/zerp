export type FieldKey<T> = Extract<keyof T, string>

export interface FieldRange<T> {
  from: T | null
  to: T | null
}

export interface ReferenceSummary {
  id: string
  name: string
}

export type ReferenceSource =
  'app/role' | 'bob/customer-subunit' | 'bob/supplier'

interface FieldBase<K extends string, Type extends string> {
  key: K
  type: Type
  caption: string
  required?: boolean
}

export interface TextField<K extends string = string> extends FieldBase<
  K,
  'text'
> {
  emptyCaption?: string
  range?: never
}

export interface IntegerField<K extends string = string> extends FieldBase<
  K,
  'integer'
> {
  range?: false
}

export interface IntegerRangeField<K extends string = string> extends FieldBase<
  K,
  'integer'
> {
  range: true
}

export interface DecimalField<K extends string = string> extends FieldBase<
  K,
  'decimal'
> {
  scale: number
  range?: false
}

export interface DecimalRangeField<K extends string = string> extends FieldBase<
  K,
  'decimal'
> {
  scale: number
  range: true
}

export interface DateField<K extends string = string> extends FieldBase<
  K,
  'date'
> {
  range?: false
}

export interface DateRangeField<K extends string = string> extends FieldBase<
  K,
  'date'
> {
  range: true
}

export interface BooleanField<K extends string = string> extends FieldBase<
  K,
  'boolean'
> {
  trueCaption?: string
  falseCaption?: string
  range?: never
}

export interface EnumOption {
  value: string
  caption: string
}

export interface EnumField<K extends string = string> extends FieldBase<
  K,
  'enum'
> {
  options: readonly EnumOption[]
  range?: never
}

export interface ReferenceField<K extends string = string> extends FieldBase<
  K,
  'reference'
> {
  source: ReferenceSource
  range?: never
}

export interface ActionsField extends FieldBase<'$actions', 'actions'> {
  required?: never
  range?: never
}

export type AnyDataField =
  | TextField
  | IntegerField
  | IntegerRangeField
  | DecimalField
  | DecimalRangeField
  | DateField
  | DateRangeField
  | BooleanField
  | EnumField
  | ReferenceField

type StringColumnField<K extends string> =
  TextField<K> | DecimalField<K> | DateField<K> | EnumField<K>

type StringFilterField<K extends string> =
  | (Omit<TextField<K>, 'emptyCaption'> & { emptyCaption?: never })
  | Exclude<StringColumnField<K>, TextField<K>>
  | ReferenceField<K>

type ColumnFieldFor<K extends string, Value> =
  NonNullable<Value> extends string
    ? StringColumnField<K>
    : NonNullable<Value> extends number
      ? IntegerField<K>
      : NonNullable<Value> extends boolean
        ? BooleanField<K>
        : NonNullable<Value> extends ReferenceSummary
          ? ReferenceField<K>
          : never

type FilterFieldFor<K extends string, Value> =
  NonNullable<Value> extends {
    from: infer From
    to: infer To
  }
    ? NonNullable<From | To> extends number
      ? IntegerRangeField<K>
      : NonNullable<From | To> extends string
        ? DecimalRangeField<K> | DateRangeField<K>
        : never
    : NonNullable<Value> extends string
      ? StringFilterField<K>
      : NonNullable<Value> extends number
        ? IntegerField<K>
        : NonNullable<Value> extends boolean
          ? BooleanField<K>
          : never

type RowFields<Row extends object> = {
  [K in FieldKey<Row>]: ColumnFieldFor<K, Row[K]>
}[FieldKey<Row>]

type FilterFields<Filters extends object> = {
  [K in FieldKey<Filters>]: FilterFieldFor<K, Filters[K]>
}[FieldKey<Filters>]

export type ColumnField<Row extends object = never> = ([Row] extends [never]
  ? AnyDataField | ActionsField
  : RowFields<Row> | ActionsField) & { width?: number }

export type FilterField<Filters extends object = never> = [Filters] extends [
  never,
]
  ? | Exclude<AnyDataField, TextField>
    | (Omit<TextField, 'emptyCaption'> & { emptyCaption?: never })
  : FilterFields<Filters>

export type DataField<T extends object = never> = [T] extends [never]
  ? AnyDataField
  : Exclude<ColumnField<T> | FilterField<T>, ActionsField>

export interface RowAction {
  key: string
  caption: string
  disabled?: boolean
  loading?: boolean
  color?: 'primary' | 'success' | 'warning' | 'error'
}
