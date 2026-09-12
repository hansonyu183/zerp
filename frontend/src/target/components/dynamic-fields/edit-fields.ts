import type { EnumOption } from './types.ts'

export type EditReferenceSource =
  | 'customer-subunits'
  | 'suppliers'
  | 'roles'
  | 'permissions'
  | 'operating-entities'
  | 'employee-categories'
  | 'departments'
  | 'positions'
  | 'employees'
  | 'vehicle-types'
  | 'other-units'
  | 'archive-operating-entities'
  | 'archive-employees'
  | 'settlement-rules'
  | 'sales-settlement-methods'
  | 'sales-payment-methods'
  | 'customer-types'
  | 'product-types'
  | 'product-categories'
  | 'product-units'
  | 'formula-materials'
  | 'external-salespeople'
  | 'channel-partners'
export type EditValue = string | number | boolean | null | string[]
export type EditValues = Record<string, EditValue>
export type EditOption = {
  id: string
  name: string
  disabled?: boolean
  unavailable?: boolean
  snapshot?: object
  approvalEntryId?: string
}
export type EditField = {
  key: string
  caption: string
  required?: boolean
  createOnly?: boolean
  visibleWhen?: { key: 'carrierKind'; value: 'INTERNAL' | 'EXTERNAL' }
} & (
  | { type: 'text' | 'textarea' | 'password' | 'date' }
  | { type: 'integer'; min?: number; max?: number }
  | { type: 'decimal'; scale: number; min?: string; max?: string }
  | { type: 'boolean' }
  | { type: 'enum'; options: readonly EnumOption[] }
  | {
      type: 'reference'
      source: Exclude<EditReferenceSource, 'roles' | 'permissions'>
    }
  | { type: 'multi-reference'; source: 'roles' | 'permissions' }
)
type WithKey<F, K extends string> = F extends EditField
  ? Omit<F, 'key'> & { key: K }
  : never
type FieldFor<Value> =
  NonNullable<Value> extends string[]
    ? Extract<EditField, { type: 'multi-reference' }>
    : NonNullable<Value> extends boolean
      ? Extract<EditField, { type: 'boolean' }>
      : NonNullable<Value> extends number
        ? Extract<EditField, { type: 'integer' }>
        : NonNullable<Value> extends string
          ? Exclude<
              EditField,
              { type: 'boolean' | 'integer' | 'multi-reference' }
            >
          : never
export type EditFields<T extends object> = readonly {
  [K in Extract<keyof T, string>]: WithKey<FieldFor<T[K]>, K> & { key: K }
}[Extract<keyof T, string>][]

export type EditReference =
  | { kind: 'book' }
  | { kind: 'subject'; bookId: string }
  | EditReferenceSource
  | { kind: 'voucher'; entity: import('@zerp/model').VouEntity }
  | {
      kind: 'vou-reference'
      entity: import('../../api.ts').TargetReferenceEntity
    }
  | {
      kind: 'vou-source-line'
      entity: import('@zerp/model').VouSourceLineTargetEntity
    }
