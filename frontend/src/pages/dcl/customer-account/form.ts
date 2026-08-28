import type { CustomerAccountForm, CustomerPricingCostItemForm } from './types'

const decimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/

export function createCustomerAccountForm(): CustomerAccountForm {
  return {
    name: '',
    shortName: '',
    customerTypeId: '01JAVX00000000000000000005',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    settlementMethodId: '',
    paymentMethodId: '',
    defaultTransportMethodCode: 'SELF_PICKUP',
    defaultTransportMethodName: '客户自提',
    transportSurcharge: '0.00',
    pricingPolicy: {
      defaultPremiumUnitPrice: '0.00',
      defaultDiscountUnitPrice: '0.00',
      costItems: [],
      thirdPartyIntermediaryFixedUnitCost: '0.00',
      thirdPartyIntermediaryVariableUnitCost: '0.00',
    },
    creditLimitAmount: '',
    primarySalesAttribution: {
      type: 'INTERNAL_EMPLOYEE',
      subjectObjectId: '',
    },
    internalReminder: '',
    defaultSalesOrderRemark: '',
  }
}

export function normalizedCostName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function sortedCostItems(
  items: readonly CustomerPricingCostItemForm[],
): CustomerPricingCostItemForm[] {
  return items
    .map((item) => ({ ...item, name: normalizedCostName(item.name) }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
}

export function customerAccountFormErrors(form: CustomerAccountForm): string[] {
  const errors: string[] = []
  if (!form.name.trim()) errors.push('请填写账户名称。')
  if (!form.customerTypeId.trim()) errors.push('请选择客户类型。')
  if (!form.primarySalesAttribution.subjectObjectId.trim())
    errors.push('请选择主要业务归属。')
  for (const [label, value] of [
    ['运输加价', form.transportSurcharge],
    ['默认溢价', form.pricingPolicy.defaultPremiumUnitPrice],
    ['默认优惠', form.pricingPolicy.defaultDiscountUnitPrice],
    [
      '固定第三方居间成本',
      form.pricingPolicy.thirdPartyIntermediaryFixedUnitCost,
    ],
    [
      '浮动第三方居间成本',
      form.pricingPolicy.thirdPartyIntermediaryVariableUnitCost,
    ],
  ] as const) {
    if (!decimalPattern.test(value.trim()))
      errors.push(`${label}必须是非负且最多两位小数的金额。`)
  }
  if (form.creditLimitAmount && !decimalPattern.test(form.creditLimitAmount))
    errors.push('信用额度必须是非负且最多两位小数的金额。')
  const names = new Set<string>()
  for (const item of sortedCostItems(form.pricingPolicy.costItems)) {
    if (!item.name) errors.push('请填写成本名称。')
    else if (names.has(item.name)) errors.push(`成本名称“${item.name}”重复。`)
    names.add(item.name)
    const amount =
      item.basis === 'UNIT_PRICE' ? item.unitPrice : item.orderAmount
    if (!amount || !decimalPattern.test(amount) || Number(amount) <= 0)
      errors.push(`成本“${item.name || '未命名'}”的金额必须大于 0。`)
  }
  return errors
}
