import type { EditField, EditFields } from '../direct-page/definition.ts'
import type { EnumOption } from '../dynamic-fields/types.ts'
export type DetailField =
  | EditField
  | {
      key: string
      caption: string
      type: 'group' | 'rows'
      fields: readonly DetailField[]
    }
  | {
      key: string
      caption: string
      type: 'enum-list'
      options: readonly EnumOption[]
    }
  | { key: string; caption: string; type: 'attachments' }
type Keys<T> = T extends unknown ? Extract<keyof T, string> : never
type Value<T, K extends string> = T extends unknown
  ? K extends keyof T
    ? T[K]
    : never
  : never
type Scalars<T extends object> = T extends unknown
  ? EditFields<T>[number]
  : never
export type DetailFields<T extends object> = readonly (
  | Scalars<T>
  | {
      [K in Keys<T>]: NonNullable<Value<T, K>> extends readonly (infer Row)[]
        ? [Row] extends [string]
          ? {
              key: K
              caption: string
              type: 'enum-list'
              options: readonly EnumOption[]
            }
          : [Row] extends [
                { fileName: string; sizeBytes: number; sha256: string },
              ]
            ? { key: K; caption: string; type: 'attachments' }
            : [Row] extends [object]
              ? {
                  key: K
                  caption: string
                  type: 'rows'
                  fields: DetailFields<Extract<Row, object>>
                }
              : never
        : NonNullable<Value<T, K>> extends object
          ? {
              key: K
              caption: string
              type: 'group'
              fields: DetailFields<NonNullable<Value<T, K>>>
            }
          : never
    }[Keys<T>]
)[]
export type AttachmentSource =
  | { source: 'current'; objectId: string }
  | { source: 'submission'; subjectId: string; submissionId: string }
