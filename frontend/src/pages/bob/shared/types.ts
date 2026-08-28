import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'

export type BobStatus = components['schemas']['ApprovalVersionMeta']['status']

export type BobEntity = components['schemas']['BobReadableEntity']

export type BobForm = {
  code: string
  name: string
  [key: string]: unknown
}

export type BobDetail = components['schemas']['BobDetailView']
export type BobVersionSummary = {
  approval: components['schemas']['ApprovalVersionMeta']
  summary: BobDetail
}
// DCL list adapters retain their own lifecycle meta while BOB current rows
// expose only sourceApprovalEntryId/sourceVersionNo.  Keep the adapter shape
// local so DCL never depends on the BOB HTTP DTO for lifecycle state.
export type BobListItem = components['schemas']['BobListItem'] & {
  latestApproved: BobVersionSummary | null
  openVersion: BobVersionSummary | null
}

export function bobListActiveVersion(item: BobListItem): BobVersionSummary {
  const version = item.openVersion ?? item.latestApproved
  if (version) return version
  return {
    approval: {
      approvalEntryId: item.sourceApprovalEntryId,
      versionNo: item.sourceVersionNo,
      status: 'APPROVED',
      revision: 0,
      createdBy: '',
      createdAt: item.updatedAt,
      updatedBy: '',
      updatedAt: item.updatedAt,
      submittedBy: null,
      submittedAt: null,
      approvedBy: null,
      approvedAt: null,
    },
    summary: item.data,
  }
}

export type BobVersionMeta = components['schemas']['ApprovalVersionMeta']
export type BobObjectView = components['schemas']['BobObjectView'] & {
  approval: components['schemas']['ApprovalVersionMeta']
}
export type BobVersionHistoryItem = BobVersionMeta & {
  summary: Record<string, unknown>
}
export type BobAuditEvent = components['schemas']['ApprovalEventView']

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
