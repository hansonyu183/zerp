import type { CustomerData } from '@zerp/model'

export type PricingSubunit = Pick<
  CustomerData['subunits'][number],
  'id' | 'code' | 'name' | 'pricingPolicy'
>

type CustomerPricingCostItem =
  CustomerData['subunits'][number]['pricingPolicy']['costItems'][number]

export interface CustomerPricingChange {
  subunit: string
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
  before: readonly PricingSubunit[],
  after: readonly PricingSubunit[],
): CustomerPricingChange[] {
  const changes: CustomerPricingChange[] = []
  const ids = new Set([...before, ...after].map((sub) => sub.id))
  for (const id of ids) {
    const old = before.find((sub) => sub.id === id)
    const next = after.find((sub) => sub.id === id)
    const subunit = `${next?.code ?? old?.code ?? ''} · ${next?.name ?? old?.name ?? ''}`
    for (const field of Object.keys(amounts) as Array<keyof typeof amounts>) {
      const previous = old?.pricingPolicy[field] ?? '—'
      const current = next?.pricingPolicy[field] ?? '—'
      if (previous !== current)
        changes.push({
          subunit,
          field: amounts[field],
          change: old ? (next ? '金额变化' : '删除') : '新增',
          before: previous,
          after: current,
        })
    }
    const previousCosts = new Map(
      old?.pricingPolicy.costItems.map((cost) => [key(cost.name), cost]),
    )
    const currentCosts = new Map(
      next?.pricingPolicy.costItems.map((cost) => [key(cost.name), cost]),
    )
    for (const name of [
      ...new Set([...previousCosts.keys(), ...currentCosts.keys()]),
    ].sort()) {
      const previous = previousCosts.get(name),
        current = currentCosts.get(name)
      if (costValue(previous) === costValue(current)) continue
      changes.push({
        subunit,
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
  }
  return changes
}
