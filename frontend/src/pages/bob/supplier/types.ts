import type { components } from '@/api/generated/schema'
import type {
  BobAuditEvent,
  BobMutationResult,
  BobVersionHistoryItem,
} from '@/pages/bob/shared/types'

export type SupplierType = components['schemas']['SupplierType']
export type SupplierTaxMatch = components['schemas']['SupplierTaxMatch']
export type SupplierMutationResult = BobMutationResult
export type SupplierVersionHistoryItem = BobVersionHistoryItem
export type SupplierAuditEvent = BobAuditEvent
export type SupplierReferenceEntity = 'employee' | 'settlement-method'

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
  supplierType: SupplierType
  shortName: string
  taxNumber: string
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
  name: string
  supplierType: SupplierType
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
  supplierType: SupplierType
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
  effective: SupplierVersion | null
  candidate: SupplierVersion | null
}
