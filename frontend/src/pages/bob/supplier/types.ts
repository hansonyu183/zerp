import type {
  BobAuditEvent,
  BobMutationResult,
  BobVersionHistoryItem,
} from '@/pages/bob/shared/types'
import type { components } from '@/api/generated/schema'

export type SupplierMutationResult = BobMutationResult
export type SupplierVersionHistoryItem = BobVersionHistoryItem
export type SupplierAuditEvent = BobAuditEvent
export type SupplierPartyOption = components['schemas']['PartyListItem']
export type SupplierReferenceEntity =
  'employee' | 'settlement-method' | 'operating-entity'

export interface SupplierReference {
  objectId: string
  approvalEntryId: string
  code: string
  name: string
  entity: SupplierReferenceEntity
}

export interface SupplierForm {
  code: string
  name: string
  partyMode: 'new' | 'existing'
  selectedParty: SupplierPartyOption | null
  partyKind: 'PERSON' | 'ORGANIZATION'
  taxNumber: string
  identifierType: 'PERSON_ID' | 'UNIFIED_SOCIAL_CREDIT_CODE'
  identifierValue: string
  operatingEntity: SupplierReference | null
  contactName: string
  contactPhone: string
  email: string
  address: string
  remark: string
  settlementMethod: SupplierReference | null
  defaultPurchaser: SupplierReference | null
}

export interface SupplierVersion {
  approvalEntryId: string
  versionNo: number
  approvalRevision: number
  status: string
  submittedBy: string | null
  defaultPurchaserCode?: string
  defaultPurchaserName?: string
  data: SupplierForm
}

export type SupplierListVersion = components['schemas']['SupplierListVersion']

export interface SupplierListItem {
  objectId: string
  code: string
  objectRevision: number
  enabled: boolean
  status: string
  name: string
  hasCandidate: boolean
  latestApproved: SupplierListVersion | null
  openVersion: SupplierListVersion | null
  approvalEntryId: string
  approvalRevision: number
  submittedBy: string | null
}

export interface SupplierDetail {
  objectId: string
  code: string
  objectRevision: number
  enabled: boolean
  partyId: string
  partyKind: 'PERSON' | 'ORGANIZATION'
  partyDisplayName: string
  operatingEntityId: string
  operatingEntityCode: string
  operatingEntityName: string
  latestApproved: SupplierVersion | null
  openVersion: SupplierVersion | null
}
