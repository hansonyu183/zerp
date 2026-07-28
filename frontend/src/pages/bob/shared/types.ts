import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'

export type BobStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'REJECTED'
  | 'EFFECTIVE'
  | 'INVALID'

export type BobEntity =
  | 'customer'
  | 'supplier'
  | 'employee'
  | 'product'
  | 'service'
  | 'warehouse'
  | 'vehicle'
  | 'fund-account'

export type BobForm = {
  code: string
  name: string
  [key: string]: unknown
}

export type BobDetail = Record<string, unknown> & { name: string }

export interface BobVersionSummary {
  versionId: string
  version: number
  status: BobStatus
  revision: number
  summary: BobDetail
}

export interface BobListItem {
  objectId: string
  entity: BobEntity
  code: string
  objectRevision: number
  currentVersion: BobVersionSummary
  effectiveVersionId: string | null
  updatedAt: string
}

export interface BobVersionMeta {
  versionId: string
  version: number
  status: BobStatus
  revision: number
  createdAt?: string
  createdBy?: string
  updatedAt?: string
  updatedBy?: string
  submittedAt?: string | null
  submittedBy?: string | null
  reviewedAt?: string | null
  reviewedBy?: string | null
  reviewComment?: string | null
}

export interface BobObjectView {
  objectId: string
  entity: BobEntity
  code: string
  objectRevision: number
  currentVersionId: string
  effectiveVersionId: string | null
  updatedAt?: string
  version: BobVersionMeta
  data: BobDetail
}

export interface BobMutationResult {
  objectId: string
  objectRevision: number
  versionId: string
  version: number
  status: BobStatus
  revision: number
}

export interface BobVersionHistoryItem extends BobVersionMeta {
  summary: BobDetail
}

export interface BobAuditEvent {
  id: string
  objectId: string
  versionId: string
  entity: BobEntity
  eventType: string
  fromStatus: BobStatus | null
  toStatus: BobStatus
  actorId: string
  occurredAt: string
  comment: string | null
  requestId: string
  summary: unknown
}

export interface BobEditContext {
  objectId: string
  objectRevision: number
  versionId: string
  revision: number
}

export interface BobReferenceConfig {
  domain?: 'bob' | 'aux'
  value?: 'objectId' | 'code'
  entity: string
  label: string
  filters?: Record<string, unknown> | ((form: Readonly<BobForm>) => Record<string, unknown>)
}

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
  fields: (
    context: BobFieldContext,
  ) => readonly BusinessObjectField<BobForm>[]
  columns: readonly BusinessObjectColumn<BobListItem>[]
  filters: readonly BobFilterField[]
  references?: Readonly<Record<string, BobReferenceConfig>>
}

export interface BobFieldContext {
  mode: 'create' | 'edit' | 'view'
  referenceOptions: Readonly<Record<string, readonly BusinessObjectFieldOption[]>>
  referenceLoading: Readonly<Record<string, boolean>>
  referenceErrors: Readonly<Record<string, string | null>>
}

export interface ReferenceQueryItem {
  objectId: string
  code: string
  currentVersion: {
    summary: {
      name: string
    }
  }
}

export interface AuxReferenceQueryItem {
  objectId: string
  code: string
  currentVersion: {
    data: {
      name: string
    }
  }
}

export interface AuxReferenceObject {
  objectId: string
  code: string
  currentVersion: {
    data: {
      name: string
    }
  }
}

export interface BobActionAvailability {
  view: boolean
  edit: boolean
  delete: boolean
  submit: boolean
  approve: boolean
  reject: boolean
  versions: boolean
  audit: boolean
}
