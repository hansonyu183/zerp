import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'

export type BobStatus = components['schemas']['BobVersionMeta']['status']

export type BobEntity = components['schemas']['BobCrudEntity']

export type BobForm = {
  code: string
  name: string
  [key: string]: unknown
}

export type BobDetail = components['schemas']['BobDetailView']
export type BobVersionSummary = components['schemas']['BobVersionSummary']
export type BobListItem = components['schemas']['BobListItem']

export function bobListActiveVersion(
  item: Pick<BobListItem, 'effective' | 'candidate'>,
): BobVersionSummary {
  const version = item.candidate ?? item.effective
  if (!version) throw new Error('业务对象缺少有效版本和候选版本。')
  return version
}

export type BobVersionMeta = components['schemas']['BobVersionMeta']
export type BobObjectView = components['schemas']['BobObjectView']
export type BobMutationResult = components['schemas']['BobMutationResult']
export type BobVersionRevisionRequest =
  components['schemas']['BobVersionRevisionRequest']
export type BobVersionHistoryItem =
  components['schemas']['BobVersionHistoryItem']
export type BobAuditEvent = components['schemas']['BobAuditEvent']

export interface BobEditContext {
  objectId: string
  objectRevision: number
  versionId: string
  revision: number
}

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
      entity: components['schemas']['BobCrudEntity'] | 'other-unit'
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
  requiredKeys: readonly string[]
  uppercaseKeys?: readonly string[]
  persistedKeys?: readonly string[]
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

export interface BobActionAvailability {
  view: boolean
  edit: boolean
  delete: boolean
  submit: boolean
  unsubmit: boolean
  approve: boolean
  unapprove: boolean
  reject: boolean
  enable: boolean
  disable: boolean
  versions: boolean
  audit: boolean
}
