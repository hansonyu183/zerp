import type {
  CustomerCostCalculationBasis,
  CustomerCreditLimit,
  CustomerForm,
  CustomerPricingCostItem,
  CustomerPricingPolicy,
} from './types'

const nonNegativeDecimalPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
const positiveDecimalPattern =
  /^(?:[1-9]\d*)(?:\.\d{1,2})?$|^0\.(?:0[1-9]|[1-9]\d?)$/

export function createCustomerForm(): CustomerForm {
  return {
    group: {
      companyName: '',
      shortName: '',
      taxNumber: '',
      invoiceTitle: '',
      invoiceAddress: '',
      invoicePhone: '',
      bankAccounts: [],
    },
    account: {
      code: '',
      name: '',
      customerTypeCode: 'DIT-0001',
      shortName: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      operatingEntity: null,
      settlementMethod: null,
      paymentMethod: null,
      defaultTransportMethodCode: '',
      defaultTransportMethodName: '',
      transportSurcharge: '0.00',
      primarySalesAttribution: { type: 'INTERNAL_EMPLOYEE', subject: null },
      pricingPolicy: {
        defaultPremiumUnitPrice: '0.00',
        defaultDiscountUnitPrice: '0.00',
        costItems: [],
        thirdPartyIntermediaryFixedUnitCost: '0.00',
        thirdPartyIntermediaryVariableUnitCost: '0.00',
      },
      creditLimits: [],
      internalReminder: '',
      defaultSalesOrderRemark: '',
    },
  }
}

export function normalizedCostName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function sortedCostItems(
  items: readonly CustomerPricingCostItem[],
): CustomerPricingCostItem[] {
  return items
    .map((item) => ({ ...item, name: normalizedCostName(item.name) }))
    .sort((left, right) =>
      normalizedCostName(left.name).localeCompare(
        normalizedCostName(right.name),
        'zh-Hans-CN',
      ),
    )
}

function isPositiveDecimal(value: string | undefined): boolean {
  return typeof value === 'string' && positiveDecimalPattern.test(value.trim())
}

function costAmountLabel(basis: CustomerCostCalculationBasis): string {
  return basis === 'UNIT_PRICE' ? '单位价格' : '整单金额'
}

export function pricingPolicyErrors(
  policy: CustomerPricingPolicy,
): readonly string[] {
  const errors: string[] = []
  for (const [label, value] of [
    ['默认溢价', policy.defaultPremiumUnitPrice],
    ['默认优惠', policy.defaultDiscountUnitPrice],
    ['固定第三方居间成本', policy.thirdPartyIntermediaryFixedUnitCost],
    ['浮动第三方居间成本', policy.thirdPartyIntermediaryVariableUnitCost],
  ] as const) {
    if (!nonNegativeDecimalPattern.test(value.trim())) {
      errors.push(`${label}必须是非负且最多两位小数的金额。`)
    }
  }

  const names = new Set<string>()
  for (const item of policy.costItems) {
    const name = normalizedCostName(item.name)
    if (!name) {
      errors.push('请填写成本名称。')
      continue
    }
    if (names.has(name)) errors.push(`成本名称“${name}”重复。`)
    names.add(name)

    const selectedAmount =
      item.basis === 'UNIT_PRICE' ? item.unitPrice : item.orderAmount
    const unexpectedAmount =
      item.basis === 'UNIT_PRICE' ? item.orderAmount : item.unitPrice
    if (unexpectedAmount?.trim()) {
      errors.push(
        `成本“${name}”只能填写${costAmountLabel(item.basis)}。`,
      )
    }
    if (!isPositiveDecimal(selectedAmount)) {
      errors.push(
        `成本“${name}”的${costAmountLabel(item.basis)}必须大于 0 且最多两位小数。`,
      )
    }
  }
  return errors
}

export function creditLimitErrors(
  limits: readonly CustomerCreditLimit[],
): readonly string[] {
  const errors: string[] = []
  const currencies = new Set<string>()
  for (const limit of limits) {
    const currency = limit.currency.trim().toUpperCase()
    if (!currency) errors.push('请填写信用额度币种。')
    else if (currencies.has(currency)) errors.push(`币种“${currency}”重复。`)
    currencies.add(currency)
    if (!nonNegativeDecimalPattern.test(limit.amount.trim())) {
      errors.push(
        `币种“${currency || '未填写'}”的信用额度必须是非负且最多两位小数。`,
      )
    }
  }
  return errors
}
