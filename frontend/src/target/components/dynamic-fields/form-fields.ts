import type {
  EditFields,
  EditField,
  EditReferenceSource,
} from './edit-fields.ts'
export type SnapshotReferenceSource = Extract<
  EditReferenceSource,
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
>
export type FormFields<T extends object> = string extends keyof T
  ? readonly EditField[]
  : readonly (
      | EditFields<T>[number]
      | {
          [K in Extract<keyof T, string>]: NonNullable<
            T[K]
          > extends readonly unknown[]
            ? never
            : NonNullable<T[K]> extends object
              ? {
                  key: K
                  type: 'snapshot-reference'
                  source: SnapshotReferenceSource
                  caption: string
                  required?: boolean
                  emptyValue?: NonNullable<T[K]>
                }
              : never
        }[Extract<keyof T, string>]
    )[]
export type DetailDefinition<T extends object> = {
  caption: string
  fields: FormFields<T>
  empty: T
}
