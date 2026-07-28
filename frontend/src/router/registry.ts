import type { Component } from 'vue'
import type { Router } from 'vue-router'

type PageLoader = () => Promise<{ default: Component }>

export interface MenuEntity {
  entity: string
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
  children: MenuEntity[]
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
const developingPage: PageLoader =
  () => import('@/pages/system/developing/Developing.vue')

type DomainId = 'bob' | 'vou' | 'wfl' | 'led'
type DomainRegistration = Pick<
  PageRegistration,
  'domainTitle' | 'domainIcon' | 'domainOrder'
>
type EntityRegistration = Omit<
  PageRegistration,
  'domain' | keyof DomainRegistration
>

const domainRegistrations: Readonly<Record<DomainId, DomainRegistration>> = {
  bob: {
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
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
  led: {
    domainTitle: '业务账簿',
    domainIcon: 'mdi-book-open-page-variant-outline',
    domainOrder: 40,
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
    entity: 'service',
    entityTitle: '服务',
    icon: 'mdi-hand-heart-outline',
    order: 50,
    component: () => import('@/pages/bob/service/Service.vue'),
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
    entity: 'category',
    entityTitle: '分类',
    icon: 'mdi-shape-outline',
    order: 90,
    component: () => import('@/pages/bob/category/Category.vue'),
  }),
  registerPage('bob', {
    entity: 'department',
    entityTitle: '部门',
    icon: 'mdi-office-building-outline',
    order: 100,
    component: () => import('@/pages/bob/department/Department.vue'),
  }),
  registerPage('bob', {
    entity: 'position',
    entityTitle: '岗位',
    icon: 'mdi-briefcase-account-outline',
    order: 110,
    component: () => import('@/pages/bob/position/Position.vue'),
  }),
  registerPage('bob', {
    entity: 'settlement-method',
    entityTitle: '结算方式',
    icon: 'mdi-calendar-clock-outline',
    order: 120,
    component: () =>
      import('@/pages/bob/settlement-method/SettlementMethod.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-order',
    entityTitle: '销售订单',
    icon: 'mdi-cart-arrow-down',
    order: 10,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-outbound',
    entityTitle: '销售出库',
    icon: 'mdi-tray-arrow-up',
    order: 20,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-delivery',
    entityTitle: '销售送货',
    icon: 'mdi-truck-delivery-outline',
    order: 30,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'sale-signoff',
    entityTitle: '销售签收',
    icon: 'mdi-clipboard-check-outline',
    order: 40,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'purchase-order',
    entityTitle: '采购订单',
    icon: 'mdi-cart-arrow-up',
    order: 50,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'purchase-inbound',
    entityTitle: '采购入库',
    icon: 'mdi-tray-arrow-down',
    order: 60,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'receipt',
    entityTitle: '往来收款',
    icon: 'mdi-cash-plus',
    order: 70,
    component: () => import('@/pages/vou/receipt/Receipt.vue'),
  }),
  registerPage('vou', {
    entity: 'payment',
    entityTitle: '往来付款',
    icon: 'mdi-cash-minus',
    order: 80,
    component: () => import('@/pages/vou/payment/Payment.vue'),
  }),
  registerPage('vou', {
    entity: 'expense-reimbursement',
    entityTitle: '费用报销',
    icon: 'mdi-receipt-text-outline',
    order: 90,
    component: () =>
      import('@/pages/vou/expense-reimbursement/ExpenseReimbursement.vue'),
  }),
  registerPage('vou', {
    entity: 'other-income',
    entityTitle: '其他收入',
    icon: 'mdi-cash-multiple',
    order: 100,
    component: () => import('@/pages/vou/other-income/OtherIncome.vue'),
  }),
  registerPage('vou', {
    entity: 'customer-order',
    entityTitle: '居间订单',
    icon: 'mdi-cart-outline',
    order: 110,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'procurement-order',
    entityTitle: '居间采购',
    icon: 'mdi-file-sign',
    order: 120,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'goods-receipt',
    entityTitle: '居间收货',
    icon: 'mdi-tray-arrow-down',
    order: 130,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'delivery-note',
    entityTitle: '居间送货',
    icon: 'mdi-truck-delivery-outline',
    order: 140,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('vou', {
    entity: 'signoff-note',
    entityTitle: '居间签收',
    icon: 'mdi-clipboard-check-outline',
    order: 150,
    component: () => import('@/pages/vou/shared/ManagedVoucherPage.vue'),
  }),
  registerPage('wfl', {
    entity: 'sales-fulfillment',
    entityTitle: '销售履约',
    icon: 'mdi-truck-check-outline',
    order: 10,
    component: () =>
      import('@/pages/wfl/sales-fulfillment/SalesFulfillment.vue'),
  }),
  registerPage('wfl', {
    entity: 'purchase-fulfillment',
    entityTitle: '采购履约',
    icon: 'mdi-warehouse',
    order: 20,
    component: () =>
      import('@/pages/wfl/purchase-fulfillment/PurchaseFulfillment.vue'),
  }),
  registerPage('wfl', {
    entity: 'intermediary-trade',
    entityTitle: '居间贸易',
    icon: 'mdi-swap-horizontal-bold',
    order: 30,
    component: () =>
      import('@/pages/wfl/intermediary-trade/IntermediaryTrade.vue'),
  }),
  registerPage('led', {
    entity: 'opening',
    entityTitle: '期初与启用',
    icon: 'mdi-book-cog-outline',
    order: 10,
    component: () => import('@/pages/led/opening/Opening.vue'),
  }),
  registerPage('led', {
    entity: 'inventory',
    entityTitle: '库存台账',
    icon: 'mdi-warehouse',
    order: 20,
    component: () => import('@/pages/led/inventory/Inventory.vue'),
  }),
  registerPage('led', {
    entity: 'fund',
    entityTitle: '资金台账',
    icon: 'mdi-bank-outline',
    order: 30,
    component: () => import('@/pages/led/fund/Fund.vue'),
  }),
  registerPage('led', {
    entity: 'party',
    entityTitle: '往来台账',
    icon: 'mdi-account-cash-outline',
    order: 40,
    component: () => import('@/pages/led/party/Party.vue'),
  }),
  registerPage('led', {
    entity: 'container',
    entityTitle: '空桶台账',
    icon: 'mdi-barrel',
    order: 50,
    component: () => import('@/pages/led/container/Container.vue'),
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

export function normalizePermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return [...new Set(
    value.filter(
      (permission): permission is string =>
        typeof permission === 'string' && PERMISSION_PATTERN.test(permission),
    ),
  )]
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
    const registration = registrationsByPage.get(key)
    const domainRegistration = registration ??
      registrationsByDomain.get(domainId)
    const existingDomain = domains.get(domainId)
    const domain = existingDomain ?? {
      domain: domainId,
      title: domainRegistration?.domainTitle ??
        formatIdentifierTitle(domainId),
      ...(domainRegistration?.domainIcon
        ? { icon: domainRegistration.domainIcon }
        : {}),
      order: domainRegistration?.domainOrder ?? FALLBACK_ORDER,
      children: [],
    }

    domain.children.push({
      entity: entityId,
      title: registration?.entityTitle ?? formatIdentifierTitle(entityId),
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
          left.order - right.order ||
          left.entity.localeCompare(right.entity),
      ),
    }))
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.domain.localeCompare(right.domain),
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

export function registerMenuRoutes(router: Router, menus: readonly MenuDomain[]): number {
  const expectedRouteNames = new Set<string>()
  let added = 0

  for (const domain of menus) {
    for (const entity of domain.children) {
      const key = `${domain.domain}/${entity.entity}`
      const registration = pageRegistry[key]

      const routeName = `page:${key}`
      expectedRouteNames.add(routeName)
      if (router.hasRoute(routeName)) continue

      router.addRoute('app', {
        path: key,
        name: routeName,
        component: registration?.component ?? developingPage,
        meta: {
          requiresAuth: true,
          title: entity.title,
          actions: entity.actions,
          developing: !registration,
        },
      })
      registeredRouteNames.add(routeName)
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
    ? `/${firstDomain.domain}/${firstEntity.entity}`
    : '/home/dashboard'
}
