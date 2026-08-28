import type {
  BusinessObjectColumn,
  BusinessObjectField,
  BusinessObjectFieldOption,
} from '@/components/business-object'
import type { components } from '@/api/generated/schema'

export type DclRelationshipEntity = 'other-unit' | 'sales-partner'
export type DclRelationshipListItem =
  | components['schemas']['DclOtherUnitListItem']
  | components['schemas']['DclSalesPartnerListItem']
export type DclRelationshipView =
  | components['schemas']['DclOtherUnitView']
  | components['schemas']['DclSalesPartnerView']
export type DclRelationshipVersionView =
  | components['schemas']['DclOtherUnitVersionView']
  | components['schemas']['DclSalesPartnerVersionView']
export type DclRelationshipAuditEvent =
  components['schemas']['ApprovalEventView']
export type DclRelationshipReferenceOption = BusinessObjectFieldOption<string>
export type SalesPartnerCapability =
  components['schemas']['SalesPartnerCapability']

export type DclRelationshipForm = {
  code: string
  partyDisplayName: string
  partyMode: 'EXISTING' | 'NEW'
  partyId: string
  partyKind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  taxNumber: string
  identifierType: 'PERSON_ID' | 'UNIFIED_SOCIAL_CREDIT_CODE'
  identifierValue: string
  operatingEntityId: string
  contactName: string
  contactPhone: string
  email: string
  address: string
  settlementMethodId: string
  capabilities: SalesPartnerCapability[]
  remark: string
}

export type DclRelationshipEditContext = {
  objectId: string
  approvalEntryId: string
  approvalRevision: number
}

export type DclRelationshipConfig = {
  columns: readonly BusinessObjectColumn<DclRelationshipListItem>[]
  fields: readonly BusinessObjectField<DclRelationshipForm>[]
  filters: readonly {
    key: 'status' | 'enabled'
    label: string
    type: 'select'
    options: readonly BusinessObjectFieldOption[]
    multiple?: boolean
  }[]
  emptyForm: () => DclRelationshipForm
}

export function dclRelationshipActiveVersion(
  item: Readonly<DclRelationshipListItem>,
): DclRelationshipVersionView {
  const version = item.openVersion ?? item.latestApproved
  if (!version) throw new Error('关系申报缺少已批准版本和开放候选版本。')
  return version
}
