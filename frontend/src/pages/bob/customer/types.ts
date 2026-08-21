export type CustomerSalesAttributionType =
  'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'DEALER'

export type CustomerCostCalculationBasis = 'UNIT_PRICE' | 'ORDER_AMOUNT'

export interface CustomerReference {
  objectId: string
  versionId: string
  code: string
  name: string
  entity:
    | 'employee'
    | 'other-unit'
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
  | 'otherParty'

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

export interface CustomerPayerBankAccount {
  bankName: string
  bankBranch: string
  accountName: string
  accountNumber: string
}

export interface CustomerGroupDraft {
  companyName: string
  shortName: string
  taxNumber: string
  invoiceTitle: string
  invoiceAddress: string
  invoicePhone: string
  bankAccounts: CustomerPayerBankAccount[]
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

export interface CustomerForm {
  group: CustomerGroupDraft
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

export interface CustomerListPage {
  items: CustomerListItem[]
  total: number
  page: number
  pageSize: number
}

export interface CustomerDetail {
  objectId: string
  code: string
  objectRevision: number
  versionId: string
  revision: number
  group: CustomerGroupDraft & {
    groupId: string
    revision: number
    attachments: CustomerAttachment[]
  }
  versionStatus: string
  accountAttachments: CustomerAttachment[]
  effectiveAccount: CustomerAccountDraft | null
  candidateAccount: CustomerAccountDraft | null
}

export type CustomerAttachment = import('@/api/generated/schema').components['schemas']['CustomerAttachmentView']

export const salesAttributionLabels: Readonly<
  Record<CustomerSalesAttributionType, string>
> = {
  INTERNAL_EMPLOYEE: '本公司专职业务员',
  EXTERNAL_PART_TIME: '外部兼职业务员',
  DEALER: '经销型业务关系',
}

export function salesAttributionSubjectEntity(
  type: CustomerSalesAttributionType,
): 'employee' | 'other-unit' {
  return type === 'INTERNAL_EMPLOYEE' ? 'employee' : 'other-unit'
}
