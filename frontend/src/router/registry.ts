import type { Component } from 'vue'
import type { Router } from 'vue-router'

type PageLoader = () => Promise<{ default: Component }>

export interface MenuEntity {
  id?: string
  entity: string
  routeKey?: string
  routePath?: string
  title: string
  icon?: string
  order: number
  actions: string[]
}

export interface MenuDomain {
  domain: string
  title: string
  icon?: string
  order: number
  direct?: boolean
  children: MenuEntity[]
}

interface ServerMenuItem {
  id: string
  parentId: string | null
  type: 'GROUP' | 'ROUTE'
  order: number
  displayName: string
  icon: string | null
  routeKey: string | null
  routePath: string | null
}

export interface PageRegistration {
  domain: string
  domainTitle: string
  domainIcon?: string
  domainOrder: number
  entity: string
  entityTitle: string
  icon?: string
  order: number
  component: PageLoader
}

const PERMISSION_PATTERN =
  /^\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/
const FALLBACK_ORDER = Number.MAX_SAFE_INTEGER
const WORKFLOW_ENTITY_TITLES: Readonly<Record<string, string>> = {
  'purchase-fulfillment': '采购履约',
  'sales-fulfillment': '销售履约',
}
const developingPage: PageLoader = () =>
  import('@/pages/system/developing/Developing.vue')
const workflowInstancePage: PageLoader = () =>
  import('@/pages/wfl/process-instance/ProcessInstance.vue')

type DomainId = 'dcl' | 'bob' | 'aux' | 'vou' | 'wfl' | 'acc' | 'rpt'
type DomainRegistration = Pick<
  PageRegistration,
  'domainTitle' | 'domainIcon' | 'domainOrder'
>
type EntityRegistration = Omit<
  PageRegistration,
  'domain' | keyof DomainRegistration
>

const domainRegistrations: Readonly<Record<DomainId, DomainRegistration>> = {
  dcl: {
    domainTitle: '申报控制',
    domainIcon: 'mdi-file-sign',
    domainOrder: 5,
  },
  bob: {
    domainTitle: '业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
  },
  aux: {
    domainTitle: '辅助对象',
    domainIcon: 'mdi-shape-plus-outline',
    domainOrder: 15,
  },
  vou: {
    domainTitle: '业务单据',
    domainIcon: 'mdi-file-document-multiple-outline',
    domainOrder: 20,
  },
  wfl: {
    domainTitle: '业务流程',
    domainIcon: 'mdi-transit-connection-variant',
    domainOrder: 30,
  },
  acc: {
    domainTitle: '内部会计',
    domainIcon: 'mdi-calculator-variant-outline',
    domainOrder: 40,
  },
  rpt: {
    domainTitle: '报表',
    domainIcon: 'mdi-chart-box-outline',
    domainOrder: 50,
  },
}

function registerPage(
  domain: DomainId,
  registration: EntityRegistration,
): PageRegistration {
  return {
    domain,
    ...domainRegistrations[domain],
    ...registration,
  }
}

export const pageRegistrations: readonly PageRegistration[] = [
  registerPage('dcl', {
    entity: 'operating-entity',
    entityTitle: '经营主体申报',
    icon: 'mdi-office-building-edit-outline',
    order: 10,
    component: () => import('@/pages/dcl/operating-entity/OperatingEntity.vue'),
  }),
  registerPage('rpt', {
    entity: 'definition',
    entityTitle: '报表定义管理',
    icon: 'mdi-file-cog-outline',
    order: 10,
    component: () => import('@/pages/rpt/Definition.vue'),
  }),
  registerPage('acc', {
    entity: 'book',
    entityTitle: '会计账簿',
    icon: 'mdi-book-cog-outline',
    order: 10,
    component: () => import('@/pages/acc/book/Book.vue'),
  }),
  registerPage('acc', {
    entity: 'subject',
    entityTitle: '会计科目',
    icon: 'mdi-file-tree-outline',
    order: 20,
    component: () => import('@/pages/acc/subject/Subject.vue'),
  }),
  registerPage('acc', {
    entity: 'opening',
    entityTitle: '账簿期初',
    icon: 'mdi-book-open-variant-outline',
    order: 30,
    component: () => import('@/pages/acc/opening/Opening.vue'),
  }),
  registerPage('acc', {
    entity: 'mapping',
    entityTitle: 'VOU 会计映射',
    icon: 'mdi-source-branch',
    order: 40,
    component: () => import('@/pages/acc/mapping/Mapping.vue'),
  }),
  registerPage('acc', {
    entity: 'period',
    entityTitle: '会计期间',
    icon: 'mdi-calendar-lock-outline',
    order: 50,
    component: () => import('@/pages/acc/period/Period.vue'),
  }),
  registerPage('bob', {
    entity: 'party',
    entityTitle: '主体',
    icon: 'mdi-account-box-multiple-outline',
    order: 5,
    component: () => import('@/pages/bob/party/Party.vue'),
  }),
  registerPage('bob', {
    entity: 'customer',
    entityTitle: '客户',
    icon: 'mdi-account-group',
    order: 10,
    component: () => import('@/pages/bob/customer/Customer.vue'),
  }),
  registerPage('bob', {
    entity: 'supplier',
    entityTitle: '供应商',
    icon: 'mdi-truck-delivery-outline',
    order: 20,
    component: () => import('@/pages/bob/supplier/Supplier.vue'),
  }),
  registerPage('bob', {
    entity: 'other-unit',
    entityTitle: '其他单位',
    icon: 'mdi-account-question-outline',
    order: 25,
    component: () => import('@/pages/bob/other-unit/OtherUnit.vue'),
  }),
  registerPage('bob', {
    entity: 'sales-partner',
    entityTitle: '销售合作方',
    icon: 'mdi-handshake-outline',
    order: 27,
    component: () => import('@/pages/bob/sales-partner/SalesPartner.vue'),
  }),
  registerPage('bob', {
    entity: 'employee',
    entityTitle: '员工',
    icon: 'mdi-badge-account-horizontal-outline',
    order: 30,
    component: () => import('@/pages/bob/employee/Employee.vue'),
  }),
  registerPage('bob', {
    entity: 'product',
    entityTitle: '产品',
    icon: 'mdi-package-variant-closed',
    order: 40,
    component: () => import('@/pages/bob/product/Product.vue'),
  }),
  registerPage('bob', {
    entity: 'warehouse',
    entityTitle: '仓库',
    icon: 'mdi-warehouse',
    order: 60,
    component: () => import('@/pages/bob/warehouse/Warehouse.vue'),
  }),
  registerPage('bob', {
    entity: 'vehicle',
    entityTitle: '车辆',
    icon: 'mdi-truck-outline',
    order: 70,
    component: () => import('@/pages/bob/vehicle/Vehicle.vue'),
  }),
  registerPage('bob', {
    entity: 'fund-account',
    entityTitle: '资金账户',
    icon: 'mdi-bank-outline',
    order: 80,
    component: () => import('@/pages/bob/fund-account/FundAccount.vue'),
  }),
  registerPage('bob', {
    entity: 'operating-entity',
    entityTitle: '经营主体',
    icon: 'mdi-office-building-cog-outline',
    order: 90,
    component: () => import('@/pages/bob/operating-entity/OperatingEntity.vue'),
  }),
  registerPage('aux', {
    entity: 'settlement-method',
    entityTitle: '结算方式',
    icon: 'mdi-calendar-clock-outline',
    order: 3,
    component: () =>
      import('@/pages/aux/settlement-method/SettlementMethod.vue'),
  }),
  registerPage('aux', {
    entity: 'payment-method',
    entityTitle: '收款方式',
    icon: 'mdi-cash-check',
    order: 4,
    component: () => import('@/pages/aux/payment-method/PaymentMethod.vue'),
  }),
  registerPage('aux', {
    entity: 'asset-category',
    entityTitle: '资产类别',
    icon: 'mdi-shape-plus-outline',
    order: 5,
    component: () => import('@/pages/aux/asset-category/AssetCategory.vue'),
  }),
  registerPage('aux', {
    entity: 'product-category',
    entityTitle: '产品分类',
    icon: 'mdi-shape-outline',
    order: 10,
    component: () => import('@/pages/aux/product-category/ProductCategory.vue'),
  }),
  registerPage('aux', {
    entity: 'product-type',
    entityTitle: '产品类型',
    icon: 'mdi-tag-outline',
    order: 15,
    component: () => import('@/pages/aux/product-type/ProductType.vue'),
  }),
  registerPage('aux', {
    entity: 'department',
    entityTitle: '部门',
    icon: 'mdi-office-building-outline',
    order: 20,
    component: () => import('@/pages/aux/department/Department.vue'),
  }),
  registerPage('aux', {
    entity: 'position',
    entityTitle: '岗位',
    icon: 'mdi-briefcase-account-outline',
    order: 30,
    component: () => import('@/pages/aux/position/Position.vue'),
  }),
  registerPage('aux', {
    entity: 'measurement-unit',
    entityTitle: '计量单位',
    icon: 'mdi-ruler-square',
    order: 50,
    component: () => import('@/pages/aux/measurement-unit/MeasurementUnit.vue'),
  }),
  registerPage('aux', {
    entity: 'dictionary-type',
    entityTitle: '字典类型',
    icon: 'mdi-book-alphabet',
    order: 60,
    component: () => import('@/pages/aux/dictionary-type/DictionaryType.vue'),
  }),
  registerPage('aux', {
    entity: 'dictionary-item',
    entityTitle: '字典项',
    icon: 'mdi-format-list-bulleted-type',
    order: 70,
    component: () => import('@/pages/aux/dictionary-item/DictionaryItem.vue'),
  }),
  registerPage('aux', {
    entity: 'income-expense-type',
    entityTitle: '收支类型',
    icon: 'mdi-swap-vertical',
    order: 80,
    component: () =>
      import('@/pages/aux/income-expense-type/IncomeExpenseType.vue'),
  }),
  registerPage('vou', {
    entity: 'bill-receipt',
    entityTitle: '票据收入',
    icon: 'mdi-cash-plus',
    order: 130,
    component: () => import('@/pages/vou/bill-receipt/BillReceipt.vue'),
  }),
  registerPage('vou', {
    entity: 'bill-payment',
    entityTitle: '票据付出',
    icon: 'mdi-cash-minus',
    order: 131,
    component: () => import('@/pages/vou/bill-payment/BillPayment.vue'),
  }),
  registerPage('vou', {
    entity: 'bill-issue',
    entityTitle: '票据开出',
    icon: 'mdi-cash-plus',
    order: 132,
    component: () => import('@/pages/vou/bill-issue/BillIssue.vue'),
  }),
  registerPage('vou', {
    entity: 'bill-discount',
    entityTitle: '票据贴现',
    icon: 'mdi-cash-fast',
    order: 133,
    component: () => import('@/pages/vou/bill-discount/BillDiscount.vue'),
  }),
  registerPage('vou', {
    entity: 'bill-maturity',
    entityTitle: '票据到期处理',
    icon: 'mdi-calendar-clock-outline',
    order: 134,
    component: () => import('@/pages/vou/bill-maturity/BillMaturity.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-pricing',
    entityTitle: '销售定价',
    icon: 'mdi-tag-multiple-outline',
    order: 5,
    component: () => import('@/pages/vou/sale-pricing/SalePricing.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-order',
    entityTitle: '销售订单',
    icon: 'mdi-cart-arrow-down',
    order: 10,
    component: () => import('@/pages/vou/sale-order/SaleOrder.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-outbound',
    entityTitle: '销售出库',
    icon: 'mdi-tray-arrow-up',
    order: 20,
    component: () => import('@/pages/vou/sale-outbound/SaleOutbound.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-delivery',
    entityTitle: '销售送货',
    icon: 'mdi-truck-delivery-outline',
    order: 30,
    component: () => import('@/pages/vou/sale-delivery/SaleDelivery.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-signoff',
    entityTitle: '销售签收',
    icon: 'mdi-clipboard-check-outline',
    order: 40,
    component: () => import('@/pages/vou/sale-signoff/SaleSignoff.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-return',
    entityTitle: '销售退货',
    icon: 'mdi-keyboard-return',
    order: 50,
    component: () => import('@/pages/vou/sale-return/SaleReturn.vue'),
  }),
  registerPage('vou', {
    entity: 'intermediary-calculation',
    entityTitle: '居间计算单',
    icon: 'mdi-calculator-variant-outline',
    order: 45,
    component: () =>
      import('@/pages/vou/intermediary-calculation/IntermediaryCalculation.vue'),
  }),
  registerPage('vou', {
    entity: 'service-contract',
    entityTitle: '服务合同',
    icon: 'mdi-file-sign',
    order: 46,
    component: () => import('@/pages/vou/service-contract/ServiceContract.vue'),
  }),
  registerPage('vou', {
    entity: 'service-acceptance',
    entityTitle: '履约验收',
    icon: 'mdi-file-check-outline',
    order: 47,
    component: () =>
      import('@/pages/vou/service-acceptance/ServiceAcceptance.vue'),
  }),
  registerPage('vou', {
    entity: 'order-production',
    entityTitle: '生产配货',
    icon: 'mdi-factory',
    order: 55,
    component: () => import('@/pages/vou/order-production/OrderProduction.vue'),
  }),
  registerPage('vou', {
    entity: 'self-production',
    entityTitle: '生产自制品',
    icon: 'mdi-cog-transfer-outline',
    order: 56,
    component: () => import('@/pages/vou/self-production/SelfProduction.vue'),
  }),
  registerPage('vou', {
    entity: 'inventory-count',
    entityTitle: '库存盘点',
    icon: 'mdi-clipboard-list-outline',
    order: 57,
    component: () => import('@/pages/vou/inventory-count/InventoryCount.vue'),
  }),
  registerPage('vou', {
    entity: 'purchase-inquiry',
    entityTitle: '采购询价',
    icon: 'mdi-comment-question-outline',
    order: 58,
    component: () => import('@/pages/vou/purchase-inquiry/PurchaseInquiry.vue'),
  }),
  registerPage('vou', {
    entity: 'purchase-order',
    entityTitle: '采购订单',
    icon: 'mdi-cart-arrow-up',
    order: 60,
    component: () => import('@/pages/vou/purchase-order/PurchaseOrder.vue'),
  }),
  registerPage('vou', {
    entity: 'purchase-inbound',
    entityTitle: '采购入库',
    icon: 'mdi-tray-arrow-down',
    order: 70,
    component: () => import('@/pages/vou/purchase-inbound/PurchaseInbound.vue'),
  }),
  registerPage('vou', {
    entity: 'purchase-return',
    entityTitle: '采购退货',
    icon: 'mdi-keyboard-return',
    order: 75,
    component: () => import('@/pages/vou/purchase-return/PurchaseReturn.vue'),
  }),
  registerPage('vou', {
    entity: 'sales-receipt',
    entityTitle: '销售收款',
    icon: 'mdi-cash-plus',
    order: 80,
    component: () => import('@/pages/vou/sales-receipt/SalesReceipt.vue'),
  }),
  registerPage('vou', {
    entity: 'purchase-refund',
    entityTitle: '采购退款',
    icon: 'mdi-cash-plus',
    order: 81,
    component: () => import('@/pages/vou/purchase-refund/PurchaseRefund.vue'),
  }),
  registerPage('vou', {
    entity: 'other-receipt',
    entityTitle: '其他往来收款',
    icon: 'mdi-cash-plus',
    order: 82,
    component: () => import('@/pages/vou/other-receipt/OtherReceipt.vue'),
  }),
  registerPage('vou', {
    entity: 'sales-refund',
    entityTitle: '销售退款',
    icon: 'mdi-cash-minus',
    order: 90,
    component: () => import('@/pages/vou/sales-refund/SalesRefund.vue'),
  }),
  registerPage('vou', {
    entity: 'purchase-payment',
    entityTitle: '采购付款',
    icon: 'mdi-cash-minus',
    order: 91,
    component: () => import('@/pages/vou/purchase-payment/PurchasePayment.vue'),
  }),
  registerPage('vou', {
    entity: 'other-payment',
    entityTitle: '其他往来付款',
    icon: 'mdi-cash-minus',
    order: 92,
    component: () => import('@/pages/vou/other-payment/OtherPayment.vue'),
  }),
  registerPage('vou', {
    entity: 'expense-reimbursement',
    entityTitle: '费用报销',
    icon: 'mdi-receipt-text-outline',
    order: 100,
    component: () =>
      import('@/pages/vou/expense-reimbursement/ExpenseReimbursement.vue'),
  }),
  registerPage('vou', {
    entity: 'employee-loan',
    entityTitle: '员工借款',
    icon: 'mdi-account-cash-outline',
    order: 95,
    component: () => import('@/pages/vou/employee-loan/EmployeeLoan.vue'),
  }),
  registerPage('vou', {
    entity: 'employee-repayment',
    entityTitle: '员工还款',
    icon: 'mdi-cash-refund',
    order: 96,
    component: () =>
      import('@/pages/vou/employee-repayment/EmployeeRepayment.vue'),
  }),
  registerPage('vou', {
    entity: 'employee-loan-writeoff',
    entityTitle: '员工借款核销',
    icon: 'mdi-receipt-text-check-outline',
    order: 97,
    component: () =>
      import('@/pages/vou/employee-loan-writeoff/EmployeeLoanWriteoff.vue'),
  }),
  registerPage('vou', {
    entity: 'expense-payment',
    entityTitle: '费用付款',
    icon: 'mdi-cash-check',
    order: 105,
    component: () => import('@/pages/vou/expense-payment/ExpensePayment.vue'),
  }),
  registerPage('vou', {
    entity: 'other-income',
    entityTitle: '其他收入',
    icon: 'mdi-cash-multiple',
    order: 110,
    component: () => import('@/pages/vou/other-income/OtherIncome.vue'),
  }),
  registerPage('vou', {
    entity: 'asset-acquisition',
    entityTitle: '资产购置',
    icon: 'mdi-office-building-plus-outline',
    order: 120,
    component: () =>
      import('@/pages/vou/asset-acquisition/AssetAcquisition.vue'),
  }),
  registerPage('vou', {
    entity: 'asset-sale',
    entityTitle: '资产出让',
    icon: 'mdi-office-building-minus-outline',
    order: 122,
    component: () => import('@/pages/vou/asset-sale/AssetSale.vue'),
  }),
  registerPage('vou', {
    entity: 'asset-liquidation',
    entityTitle: '资产清算',
    icon: 'mdi-office-building-remove-outline',
    order: 123,
    component: () =>
      import('@/pages/vou/asset-liquidation/AssetLiquidation.vue'),
  }),
  registerPage('wfl', {
    entity: 'process-definition',
    entityTitle: '流程定义',
    icon: 'mdi-source-branch',
    order: 10,
    component: () =>
      import('@/pages/wfl/process-definition/ProcessDefinition.vue'),
  }),
  registerPage('wfl', {
    entity: 'process-instance',
    entityTitle: '流程实例',
    icon: 'mdi-sitemap-outline',
    order: 20,
    component: () => import('@/pages/wfl/process-instance/ProcessInstance.vue'),
  }),
]

export const pageRegistry: Readonly<Record<string, PageRegistration>> =
  Object.fromEntries(
    pageRegistrations.map((registration) => [
      `${registration.domain}/${registration.entity}`,
      registration,
    ]),
  )

const registeredRouteNames = new Set<string>()

function hasSameActions(
  current: unknown,
  expected: readonly string[],
): boolean {
  return (
    Array.isArray(current) &&
    current.length === expected.length &&
    current.every((action, index) => action === expected[index])
  )
}

export function normalizePermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return [
    ...new Set(
      value.filter(
        (permission): permission is string =>
          typeof permission === 'string' && PERMISSION_PATTERN.test(permission),
      ),
    ),
  ]
}

export function buildMenus(
  permissions: readonly string[],
  registrations: readonly PageRegistration[] = pageRegistrations,
): MenuDomain[] {
  const actionsByPage = new Map<string, string[]>()

  for (const permission of permissions) {
    const match = permission.match(PERMISSION_PATTERN)
    if (!match) continue

    const [, domain, entity, action] = match
    if (domain === 'app') continue

    const key = `${domain}/${entity}`
    const actions = actionsByPage.get(key) ?? []
    if (!actions.includes(action)) actions.push(action)
    actionsByPage.set(key, actions)
  }

  const sortedRegistrations = [...registrations].sort(
    (left, right) =>
      left.domainOrder - right.domainOrder ||
      left.domain.localeCompare(right.domain) ||
      left.order - right.order ||
      left.entity.localeCompare(right.entity),
  )
  const registrationsByPage = new Map(
    sortedRegistrations.map((registration) => [
      `${registration.domain}/${registration.entity}`,
      registration,
    ]),
  )
  const registrationsByDomain = new Map<string, PageRegistration>()

  for (const registration of sortedRegistrations) {
    if (registration.domain === 'app') continue
    if (!registrationsByDomain.has(registration.domain)) {
      registrationsByDomain.set(registration.domain, registration)
    }
  }
  const domains = new Map<string, MenuDomain>()

  for (const [key, actions] of actionsByPage) {
    const [domainId, entityId] = key.split('/') as [string, string]
    if (
      domainId === 'wfl' &&
      entityId !== 'process-definition' &&
      !actions.includes('query')
    ) {
      continue
    }
    const registration = registrationsByPage.get(key)
    const domainRegistration =
      registration ?? registrationsByDomain.get(domainId)
    const existingDomain = domains.get(domainId)
    const domain = existingDomain ?? {
      domain: domainId,
      title: domainRegistration?.domainTitle ?? formatIdentifierTitle(domainId),
      ...(domainRegistration?.domainIcon
        ? { icon: domainRegistration.domainIcon }
        : {}),
      order: domainRegistration?.domainOrder ?? FALLBACK_ORDER,
      children: [],
    }

    domain.children.push({
      entity: entityId,
      title:
        registration?.entityTitle ??
        (domainId === 'wfl' ? WORKFLOW_ENTITY_TITLES[entityId] : undefined) ??
        formatIdentifierTitle(entityId),
      ...(registration?.icon ? { icon: registration.icon } : {}),
      order: registration?.order ?? FALLBACK_ORDER,
      actions,
    })
    domains.set(domainId, domain)
  }

  return [...domains.values()]
    .map((domain) => ({
      ...domain,
      children: domain.children.sort(
        (left, right) =>
          left.order - right.order || left.entity.localeCompare(right.entity),
      ),
    }))
    .sort(
      (left, right) =>
        left.order - right.order || left.domain.localeCompare(right.domain),
    )
}

export function buildServerMenus(
  items: readonly ServerMenuItem[],
  permissions: readonly string[],
): MenuDomain[] {
  const groups = items
    .filter((item) => item.type === 'GROUP')
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    )
  const actionsByRoute = new Map<string, string[]>()
  for (const permission of permissions) {
    const match = permission.match(PERMISSION_PATTERN)
    if (!match) continue
    const [, domain, entity, action] = match
    const key = `${domain}/${entity}`
    const actions = actionsByRoute.get(key) ?? []
    if (!actions.includes(action)) actions.push(action)
    actionsByRoute.set(key, actions)
  }

  const toEntity = (item: ServerMenuItem, isDefaultMenu: boolean) => {
    const routeKey = item.routeKey as string
    const registration = pageRegistry[routeKey]
    return {
      id: item.id,
      entity: item.id,
      routeKey,
      routePath: item.routePath as string,
      title: isDefaultMenu
        ? (registration?.entityTitle ??
          WORKFLOW_ENTITY_TITLES[routeKey.split('/')[1] ?? ''] ??
          item.displayName)
        : item.displayName,
      ...(isDefaultMenu && registration?.icon
        ? { icon: registration.icon }
        : item.icon
          ? { icon: item.icon }
          : {}),
      order: item.order,
      actions: actionsByRoute.get(routeKey) ?? [],
    }
  }
  const directRoutes = items
    .filter(
      (item) =>
        item.type === 'ROUTE' &&
        item.parentId === null &&
        item.routeKey &&
        item.routePath,
    )
    .map((item) => ({
      domain: item.id,
      title: item.displayName,
      ...(item.icon ? { icon: item.icon } : {}),
      order: item.order,
      direct: true,
      children: [toEntity(item, item.id.startsWith('default-'))],
    }))
  const groupedMenus = groups.map((group) => ({
    domain: group.id,
    title: group.displayName,
    ...(group.icon ? { icon: group.icon } : {}),
    order: group.order,
    children: items
      .filter(
        (item) =>
          item.type === 'ROUTE' &&
          item.parentId === group.id &&
          item.routeKey &&
          item.routePath,
      )
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id),
      )
      .map((item) => toEntity(item, group.id.startsWith('default-'))),
  }))

  return [...directRoutes, ...groupedMenus].sort(
    (left, right) =>
      left.order - right.order || left.domain.localeCompare(right.domain),
  )
}

function formatIdentifierTitle(identifier: string): string {
  return identifier
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function hasRegisteredPage(domain: string, entity: string): boolean {
  return `${domain}/${entity}` in pageRegistry
}

export function registerMenuRoutes(
  router: Router,
  menus: readonly MenuDomain[],
): number {
  const expectedRouteNames = new Set<string>()
  let added = 0

  for (const domain of menus) {
    for (const entity of domain.children) {
      const key = entity.routeKey ?? `${domain.domain}/${entity.entity}`
      if (key.startsWith('app/') || key === 'home/dashboard') continue
      const routeName = `page:${key}`
      if (expectedRouteNames.has(routeName)) continue
      const registration = pageRegistry[key]
      const [routeDomain, routeEntity] = key.split('/') as [string, string]
      const dynamicWorkflow =
        routeDomain === 'wfl' &&
        routeEntity !== 'process-definition' &&
        !registration
      const dynamicReport =
        routeDomain === 'rpt' && routeEntity !== 'definition'

      expectedRouteNames.add(routeName)
      const currentRoute = router
        .getRoutes()
        .find((route) => route.name === routeName)
      const developing = !registration && !dynamicWorkflow && !dynamicReport
      const routeIsCurrent =
        currentRoute?.meta.title === entity.title &&
        currentRoute.meta.developing === developing &&
        currentRoute.meta.processName ===
          (dynamicWorkflow ? routeEntity : undefined) &&
        currentRoute.meta.reportCode ===
          (dynamicReport ? routeEntity : undefined) &&
        hasSameActions(currentRoute.meta.actions, entity.actions)

      registeredRouteNames.add(routeName)
      if (routeIsCurrent) continue
      if (currentRoute) router.removeRoute(routeName)

      router.addRoute('app', {
        path: entity.routePath?.replace(/^\//, '') ?? key,
        name: routeName,
        component:
          registration?.component ??
          (dynamicWorkflow
            ? workflowInstancePage
            : dynamicReport
              ? () => import('@/pages/rpt/Report.vue')
              : developingPage),
        meta: {
          requiresAuth: true,
          title: entity.title,
          actions: entity.actions,
          developing,
          ...(dynamicWorkflow ? { processName: routeEntity } : {}),
          ...(dynamicReport ? { reportCode: routeEntity } : {}),
        },
      })
      added += 1
    }
  }

  for (const routeName of registeredRouteNames) {
    if (expectedRouteNames.has(routeName)) continue
    if (router.hasRoute(routeName)) router.removeRoute(routeName)
    registeredRouteNames.delete(routeName)
  }

  return added
}

export function resolveFirstMenuPath(menus: readonly MenuDomain[]): string {
  const firstDomain = menus[0]
  const firstEntity = firstDomain?.children[0]

  return firstDomain && firstEntity
    ? (firstEntity.routePath ?? `/${firstDomain.domain}/${firstEntity.entity}`)
    : '/home/dashboard'
}
