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
  versionId: string
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
  versionId: string
  version: number
  revision: number
  status: string
  submittedBy: string | null
  defaultPurchaserCode?: string
  defaultPurchaserName?: string
  data: SupplierForm
}

export interface SupplierListVersion {
  versionId: string
  version: number
  revision: number
  status: string
  defaultPurchaserCode?: string
  defaultPurchaserName?: string
  submittedBy: string | null
}

export interface SupplierListItem {
  objectId: string
  code: string
  objectRevision: number
  enabled: boolean
  status: string
  name: string
  hasCandidate: boolean
  effective: SupplierListVersion | null
  candidate: SupplierListVersion | null
  versionId: string
  revision: number
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
  effective: SupplierVersion | null
  candidate: SupplierVersion | null
}
