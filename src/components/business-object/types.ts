export type BusinessObjectFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
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
  span?: 1 | 2
  options?: readonly BusinessObjectFieldOption[]
  min?: number
  max?: number
  step?: number
  trueLabel?: string
  falseLabel?: string
  format?: (value: unknown, record: Readonly<T>) => string
  rules?: readonly BusinessObjectValidationRule<T>[]
}
