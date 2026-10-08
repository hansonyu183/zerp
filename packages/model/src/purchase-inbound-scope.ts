export const purchaseInboundScopeValues = [
  'ORDER_REFERENCE',
  'INDEPENDENT_PRIOR',
  'ALL',
] as const
export type PurchaseInboundScope = (typeof purchaseInboundScopeValues)[number]
export type PurchaseInboundMode = Exclude<PurchaseInboundScope, 'ALL'>
export type PurchaseInboundScopes = Readonly<
  Record<string, PurchaseInboundScope>
>
export const purchaseInboundScopePresentation: Readonly<
  Record<PurchaseInboundScope, { label: string }>
> = {
  ORDER_REFERENCE: { label: '订单引用收货' },
  INDEPENDENT_PRIOR: { label: '独立此前收货' },
  ALL: { label: '全部收货' },
}
export const purchaseInboundScopeOptions = purchaseInboundScopeValues.map(
  (value) => ({ value, label: purchaseInboundScopePresentation[value].label }),
)

export function isPurchaseInboundPermission(path: string): boolean {
  return (
    path.startsWith('/vou/purchase-inbound/') ||
    path === '/wfl/process-instance/create-purchase-inbound'
  )
}

export function purchaseInboundScopeCovers(
  own: PurchaseInboundScope | undefined,
  requested: PurchaseInboundScope,
): boolean {
  return own === 'ALL' || own === requested
}

export function mergePurchaseInboundScopes(
  scopes: readonly PurchaseInboundScope[],
): PurchaseInboundScope | undefined {
  if (scopes.length === 0) return undefined
  if (scopes.includes('ALL') || new Set(scopes).size > 1) return 'ALL'
  return scopes[0]
}
