import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'

export type BobEntity = components['schemas']['BobReadableEntity']

export type BobForm = {
  code: string
  name: string
  [key: string]: unknown
}

export type BobDetail = components['schemas']['BobDetailView']
export type BobListItem = components['schemas']['BobListItem']
export type BobObjectView = components['schemas']['BobObjectView']

interface ReferenceConfigBase {
  value?: 'objectId' | 'code'
  label: string
  filters?:
    | Record<string, unknown>
    | ((form: Readonly<BobForm>) => Record<string, unknown>)
}

export type BobReferenceConfig =
  | (ReferenceConfigBase & {
      domain?: 'bob'
      entity: components['schemas']['BobReadableEntity'] | 'other-unit'
    })
  | (ReferenceConfigBase & {
      domain: 'aux'
      entity: components['schemas']['AuxEntity']
    })

export interface BobFilterField {
  key: string
  label: string
  type: 'text' | 'select' | 'autocomplete' | 'switch'
  options?: readonly BusinessObjectFieldOption[]
  multiple?: boolean
  reference?: BobReferenceConfig
}

export interface BobEntityConfig {
  entity: BobEntity
  title: string
  codeLabel: string
  nameLabel: string
  emptyForm: () => BobForm
  detailKeys: readonly string[]
  fields: (context: BobFieldContext) => readonly BusinessObjectField<BobForm>[]
  columns: readonly BusinessObjectColumn<BobListItem>[]
  filters: readonly BobFilterField[]
  references?: Readonly<Record<string, BobReferenceConfig>>
}

export interface BobFieldContext {
  mode: 'create' | 'edit' | 'view'
  referenceOptions: Readonly<
    Record<string, readonly BusinessObjectFieldOption[]>
  >
  referenceLoading: Readonly<Record<string, boolean>>
  referenceErrors: Readonly<Record<string, string | null>>
}

export type AuxReferenceQueryItem = components['schemas']['AuxObjectView']
export type AuxReferenceObject = components['schemas']['AuxObjectView']
