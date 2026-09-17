/** Customer visibility is separate from action authorization. */
export const customerScopeValues = ['NONE', 'OWN', 'ALL'] as const
export type CustomerScope = (typeof customerScopeValues)[number]
export const customerScopePresentation: Readonly<
  Record<CustomerScope, { label: string }>
> = {
  NONE: { label: '不授予' },
  OWN: { label: '本人客户' },
  ALL: { label: '全部客户' },
}
export const customerScopeOptions = customerScopeValues.map((value) => ({
  value,
  label: customerScopePresentation[value].label,
}))
export function customerScopeRank(scope: CustomerScope): number {
  return customerScopeValues.indexOf(scope)
}
