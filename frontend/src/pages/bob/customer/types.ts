import type { components } from '@/api/generated/schema'

export type CustomerSalesAttributionType =
  | 'INTERNAL_EMPLOYEE'
  | 'EXTERNAL_PART_TIME'
  | 'CHANNEL_PARTNER'
export type CustomerCostCalculationBasis = 'UNIT_PRICE' | 'ORDER_AMOUNT'
export type CustomerPartyMode = 'EXISTING' | 'NEW'

export interface CustomerReference {
  objectId: string
  versionId: string
  code: string
  name: string
  entity:
    | 'employee'
    | 'sales-partner'
    | 'operating-entity'
    | 'settlement-method'
    | 'payment-method'
    | 'dictionary-item'
}

export type CustomerReferenceKey =
  | 'operatingEntity'
  | 'settlementMethod'
  | 'paymentMethod'
  | 'customerType'
  | 'documentCategory'
  | 'employee'
  | 'salesPartner'

export interface CustomerSalesAttributionDraft {
  type: CustomerSalesAttributionType
  subject: CustomerReference | null
}

export interface CustomerPricingCostItem {
  name: string
  basis: CustomerCostCalculationBasis
  unitPrice?: string
  orderAmount?: string
}

export interface CustomerPricingPolicy {
  defaultPremiumUnitPrice: string
  defaultDiscountUnitPrice: string
  costItems: CustomerPricingCostItem[]
  thirdPartyIntermediaryFixedUnitCost: string
  thirdPartyIntermediaryVariableUnitCost: string
}

export interface CustomerCreditLimit {
  currency: 'CNY'
  amount: string
  usedAmount?: string
}

export interface CustomerAccountDraft {
  code: string
  name: string
  customerTypeCode: string
  shortName: string
  contactName: string
  contactPhone: string
  email: string
  address: string
  operatingEntity: CustomerReference | null
  settlementMethod: CustomerReference | null
  paymentMethod: CustomerReference | null
  defaultTransportMethodCode: string
  defaultTransportMethodName: string
  transportSurcharge: string
  primarySalesAttribution: CustomerSalesAttributionDraft
  pricingPolicy: CustomerPricingPolicy
  creditLimits: CustomerCreditLimit[]
  internalReminder: string
  defaultSalesOrderRemark: string
}

export interface CustomerPartyDraft {
  mode: CustomerPartyMode
  partyId: string
  kind: 'PERSON' | 'ORGANIZATION'
  legalName: string
  displayName: string
  taxNumber: string
  identifierType: 'PERSON_ID' | 'UNIFIED_SOCIAL_CREDIT_CODE'
  identifierValue: string
}

export interface CustomerForm {
  party: CustomerPartyDraft
  account: CustomerAccountDraft
}

export interface CustomerListItem {
  objectId: string
  code: string
  name: string
  enabled: boolean
  status: string
  customerType: string
  hasCandidate: boolean
  objectRevision: number
  versionId: string
  revision: number
  submittedBy: string | null
}

export interface CustomerAccount {
  objectId: string
  code: string
  objectRevision: number
  enabled: boolean
  status: string
  versionId: string
  revision: number
  data: CustomerAccountDraft
  attachments: CustomerAttachment[]
}

export interface CustomerDetail {
  objectId: string
  code: string
  objectRevision: number
  enabled: boolean
  partyId: string
  partyKind: string
  partyDisplayName: string
  operatingEntityId: string
  operatingEntityCode: string
  operatingEntityName: string
  accounts: CustomerAccount[]
  attachments: CustomerAttachment[]
}

export type CustomerAttachment = components['schemas']['CustomerAttachmentView']

export const salesAttributionLabels: Readonly<
  Record<CustomerSalesAttributionType, string>
> = {
  INTERNAL_EMPLOYEE: '本公司专职业务员',
  EXTERNAL_PART_TIME: '外部兼职业务员',
  CHANNEL_PARTNER: '渠道合作伙伴',
}

export function salesAttributionSubjectEntity(
  type: CustomerSalesAttributionType,
): 'employee' | 'sales-partner' {
  return type === 'INTERNAL_EMPLOYEE' ? 'employee' : 'sales-partner'
}
