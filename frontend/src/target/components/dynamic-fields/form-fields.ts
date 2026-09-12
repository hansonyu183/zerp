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
export type FormField =
  | EditField
  | {
      key: string
      type: 'snapshot-reference'
      source: SnapshotReferenceSource
      caption: string
      required?: boolean
      emptyValue?: object
    }
  | {
      key: string
      type: 'rows'
      caption: string
      fields: readonly FormField[]
      empty: object
    }
export type FormFields<T extends object> = [keyof T] extends [never]
  ? readonly FormField[]
  : string extends keyof T
    ? readonly FormField[]
    : readonly (
        | EditFields<T>[number]
        | {
            [K in Extract<keyof T, string>]: NonNullable<
              T[K]
            > extends readonly (infer Row)[]
              ? Row extends object
                ? {
                    key: K
                    type: 'rows'
                    caption: string
                    fields: FormFields<Row>
                    empty: Row
                  }
                : never
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
