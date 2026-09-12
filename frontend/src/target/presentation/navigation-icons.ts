import { vouEntityPresentation } from '@zerp/model'
import type { NavigationResourceGroup } from '../navigation/resources.ts'
export const navigationIcons = {
  business: 'mdi-briefcase-outline',
  documents: 'mdi-receipt-text-outline',
  system: 'mdi-cog-outline',
  auxiliary: 'mdi-shape-outline',
  accounting: 'mdi-calculator',
  report: 'mdi-chart-box-outline',
  workflow: 'mdi-sitemap-outline',
  customer: 'mdi-account-group-outline',
  product: 'mdi-package-variant-closed',
  supplier: 'mdi-truck-delivery-outline',
  partner: 'mdi-handshake-outline',
  unit: 'mdi-office-building-outline',
  user: 'mdi-account-outline',
  role: 'mdi-account-key-outline',
  permission: 'mdi-shield-key-outline',
  workbench: 'mdi-view-dashboard-outline',
  category: 'mdi-shape-outline',
  department: 'mdi-domain',
  position: 'mdi-badge-account-outline',
  payment: 'mdi-credit-card-outline',
  dictionary: 'mdi-book-open-variant',
  measure: 'mdi-ruler',
  income: 'mdi-cash-multiple',
  asset: 'mdi-office-building-outline',
  employee: 'mdi-account-tie-outline',
  warehouse: 'mdi-warehouse',
  fund: 'mdi-bank-outline',
  vehicle: 'mdi-car-outline',
  book: 'mdi-book-open-page-variant-outline',
  subject: 'mdi-format-list-bulleted',
  mapping: 'mdi-swap-horizontal',
  period: 'mdi-calendar-range',
  definition: 'mdi-file-tree-outline',
  instance: 'mdi-play-network-outline',
  reference: 'mdi-link-variant',
  sale: 'mdi-cart-outline',
  purchase: 'mdi-cart-arrow-down',
  receipt: 'mdi-cash-plus',
  paymentOut: 'mdi-cash-minus',
  stock: 'mdi-package-variant',
  production: 'mdi-factory',
  bill: 'mdi-receipt-text-outline',
} as const
export type NavigationIcon = keyof typeof navigationIcons
export function navigationIcon(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !Object.hasOwn(navigationIcons, value))
    throw new Error('未登记的导航图标')
  return navigationIcons[value as NavigationIcon]
}
const domains: Record<string, NavigationIcon> = {
  bob: 'business',
  vou: 'documents',
  app: 'system',
  aux: 'auxiliary',
  acc: 'accounting',
  rpt: 'report',
  wfl: 'workflow',
}
const resources: Record<string, NavigationIcon> = {
  'bob/customer': 'customer',
  'bob/product': 'product',
  'bob/supplier': 'supplier',
  'bob/other-unit': 'unit',
  'bob/sales-partner': 'partner',
  'app/user': 'user',
  'app/role': 'role',
  'app/permission': 'permission',
  'app/workbench': 'workbench',
  'app/system-parameter': 'system',
  'aux/product-category': 'category',
  'aux/product-type': 'category',
  'aux/employee-category': 'category',
  'aux/department': 'department',
  'aux/position': 'position',
  'aux/settlement-method': 'payment',
  'aux/payment-method': 'payment',
  'aux/dictionary-type': 'dictionary',
  'aux/dictionary-item': 'dictionary',
  'aux/measurement-unit': 'measure',
  'aux/income-expense-type': 'income',
  'aux/asset-category': 'asset',
  'aux/operating-entity': 'unit',
  'aux/employee': 'employee',
  'aux/warehouse': 'warehouse',
  'aux/fund-account': 'fund',
  'aux/vehicle': 'vehicle',
  'acc/book': 'book',
  'acc/subject': 'subject',
  'acc/mapping': 'mapping',
  'acc/period': 'period',
  'wfl/process-definition': 'definition',
  'wfl/process-instance': 'instance',
  'rpt/directory': 'report',
  'rpt/definition': 'report',
  'vou/source-line': 'reference',
}
const vouchers = {
  'sale-pricing': 'sale',
  'sale-order': 'sale',
  'sale-outbound': 'sale',
  'sale-delivery': 'sale',
  'sale-signoff': 'sale',
  'sale-return': 'sale',
  'purchase-order': 'purchase',
  'purchase-inbound': 'purchase',
  'purchase-return': 'purchase',
  'purchase-inquiry': 'purchase',
  'order-production': 'production',
  'self-production': 'production',
  'inventory-count': 'stock',
  'sales-receipt': 'receipt',
  'purchase-refund': 'receipt',
  'other-receipt': 'receipt',
  'sales-refund': 'paymentOut',
  'purchase-payment': 'paymentOut',
  'other-payment': 'paymentOut',
  'employee-loan': 'paymentOut',
  'employee-repayment': 'receipt',
  'employee-loan-writeoff': 'accounting',
  'expense-reimbursement': 'accounting',
  'expense-payment': 'paymentOut',
  'other-income': 'income',
  'asset-acquisition': 'asset',
  'asset-sale': 'asset',
  'asset-liquidation': 'asset',
  'bill-receipt': 'bill',
  'bill-payment': 'bill',
  'bill-issue': 'bill',
  'bill-discount': 'bill',
  'bill-maturity': 'bill',
  'intermediary-calculation': 'accounting',
  'service-contract': 'partner',
  'service-acceptance': 'partner',
  opening: 'accounting',
} as const satisfies Record<keyof typeof vouEntityPresentation, NavigationIcon>
function resourceIcon(
  domain: string,
  entity: string,
): NavigationIcon | undefined {
  if (domain === 'rpt' && /^rpt-[0-9]{6}$/.test(entity)) return 'report'
  if (domain === 'vou' && Object.hasOwn(vouEntityPresentation, entity))
    return vouchers[entity as keyof typeof vouchers]
  return resources[`${domain}/${entity}`]
}
export type NavigationMenuGroup = Omit<NavigationResourceGroup, 'resources'> & {
  icon?: NavigationIcon
  resources: (NavigationResourceGroup['resources'][number] & {
    icon?: NavigationIcon
  })[]
}
export function presentNavigation(
  groups: readonly NavigationResourceGroup[],
): NavigationMenuGroup[] {
  return groups.map((group) => ({
    ...group,
    icon: domains[group.domain],
    resources: group.resources.map((resource) => ({
      ...resource,
      icon: resourceIcon(resource.domain, resource.entity),
    })),
  }))
}
