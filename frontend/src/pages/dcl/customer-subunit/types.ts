export type CustomerSalesAttributionType =
  'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER'
export type CustomerCostCalculationBasis = 'UNIT_PRICE' | 'ORDER_AMOUNT'

export interface CustomerPricingCostItemForm {
  name: string
  basis: CustomerCostCalculationBasis
  unitPrice?: string
  orderAmount?: string
}

export interface CustomerSubunitForm {
  subunitId?: string
  enabled: boolean
  name: string
  shortName: string
  customerTypeId: string
  contactName: string
  contactPhone: string
  email: string
  address: string
  settlementMethodId: string
  paymentMethodId: string
  defaultTransportMethodCode: string
  defaultTransportMethodName: string
  transportSurcharge: string
  pricingPolicy: {
    defaultPremiumUnitPrice: string
    defaultDiscountUnitPrice: string
    costItems: CustomerPricingCostItemForm[]
    thirdPartyIntermediaryFixedUnitCost: string
    thirdPartyIntermediaryVariableUnitCost: string
  }
  creditLimits: Array<{
    currency: string
    amount: string
  }>
  primarySalesAttribution: {
    type: CustomerSalesAttributionType
    subjectObjectId: string
  }
  internalReminder: string
  defaultSalesOrderRemark: string
}

export const salesAttributionLabels: Readonly<
  Record<CustomerSalesAttributionType, string>
> = {
  INTERNAL_EMPLOYEE: '本公司专职业务员',
  EXTERNAL_PART_TIME: '外部兼职业务员',
  CHANNEL_PARTNER: '渠道合作伙伴',
}
