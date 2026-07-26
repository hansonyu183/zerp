export type BusinessObjectFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'autocomplete'
  | 'date'
  | 'switch'
  | 'readonly'

export type BusinessObjectFieldState<T extends object> =
  | boolean
  | ((record: Readonly<T>) => boolean)

export type BusinessObjectValidationResult = true | string

export type BusinessObjectValidationRule<T extends object> = (
  value: unknown,
  record: Readonly<T>,
) =>
  | BusinessObjectValidationResult
  | Promise<BusinessObjectValidationResult>

export interface BusinessObjectFieldOption<TValue = unknown> {
  title: string
  value: TValue
  disabled?: boolean
}

export interface BusinessObjectField<T extends object> {
  key: Extract<keyof T, string>
  label: string
  type: BusinessObjectFieldType
  required?: boolean
  placeholder?: string
  hint?: string
  readonly?: BusinessObjectFieldState<T>
  disabled?: BusinessObjectFieldState<T>
  visible?: BusinessObjectFieldState<T>
  span?: 1 | 2
  options?: readonly BusinessObjectFieldOption[]
  loading?: boolean
  clearable?: boolean
  multiple?: boolean
  min?: number
  max?: number
  step?: number
  trueLabel?: string
  falseLabel?: string
  format?: (value: unknown, record: Readonly<T>) => string
  rules?: readonly BusinessObjectValidationRule<T>[]
  onChange?: (
    value: unknown,
    record: Readonly<T>,
  ) => Partial<T> | void
}

export type BusinessObjectRowState<T extends object> =
  | boolean
  | ((row: Readonly<T>) => boolean)

export interface BusinessObjectColumn<T extends object> {
  key: string
  label: string
  value: (row: Readonly<T>) => unknown
  format?: (value: unknown, row: Readonly<T>) => string
  align?: 'start' | 'center' | 'end'
  width?: string
}
