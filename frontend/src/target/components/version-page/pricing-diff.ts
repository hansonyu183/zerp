import type { CustomerData } from '@zerp/model'

export type CustomerPricing = CustomerData['pricingPolicy']
type CustomerPricingCostItem = CustomerPricing['costItems'][number]

export interface CustomerPricingChange {
  field: string
  change: string
  before: string
  after: string
}
const amounts = {
  defaultPremiumUnitPrice: '默认加价单价',
  defaultDiscountUnitPrice: '默认优惠单价',
  thirdPartyIntermediaryFixedUnitCost: '第三方居间固定单位成本',
  thirdPartyIntermediaryVariableUnitCost: '第三方居间浮动单位成本',
} as const
const costValue = (cost: CustomerPricingCostItem | undefined) =>
  !cost
    ? '—'
    : cost.calculationBasis === 'UNIT_PRICE'
      ? `按单价 ${cost.unitPrice}`
      : `按订单金额 ${cost.orderAmount}`
const key = (name: string) => name.trim().toLocaleUpperCase()

export function customerPricingChanges(
  before: CustomerPricing | undefined,
  after: CustomerPricing,
): CustomerPricingChange[] {
  const changes: CustomerPricingChange[] = []
  const old = before,
    next = after
  for (const field of Object.keys(amounts) as Array<keyof typeof amounts>) {
    const previous = old?.[field] ?? '—'
    const current = next[field] ?? '—'
    if (previous !== current)
      changes.push({
        field: amounts[field],
        change: old ? (next ? '金额变化' : '删除') : '新增',
        before: previous,
        after: current,
      })
  }
  const previousCosts = new Map(
    old?.costItems.map((cost) => [key(cost.name), cost]),
  )
  const currentCosts = new Map(
    next?.costItems.map((cost) => [key(cost.name), cost]),
  )
  for (const name of [
    ...new Set([...previousCosts.keys(), ...currentCosts.keys()]),
  ].sort()) {
    const previous = previousCosts.get(name),
      current = currentCosts.get(name)
    if (costValue(previous) === costValue(current)) continue
    changes.push({
      field: current?.name ?? previous!.name,
      change: !previous
        ? '新增'
        : !current
          ? '删除'
          : previous.calculationBasis !== current.calculationBasis
            ? '口径变化'
            : '金额变化',
      before: costValue(previous),
      after: costValue(current),
    })
  }
  return changes
}
