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

export const pageRegistrations: readonly PageRegistration[] = [
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'customer',
    entityTitle: '客户',
    icon: 'mdi-account-group',
    order: 10,
    component: () => import('@/pages/bob/customer/Customer.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'supplier',
    entityTitle: '供应商',
    icon: 'mdi-truck-delivery-outline',
    order: 20,
    component: () => import('@/pages/bob/supplier/Supplier.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'employee',
    entityTitle: '员工',
    icon: 'mdi-badge-account-horizontal-outline',
    order: 30,
    component: () => import('@/pages/bob/employee/Employee.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'product',
    entityTitle: '产品',
    icon: 'mdi-package-variant-closed',
    order: 40,
    component: () => import('@/pages/bob/product/Product.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'service',
    entityTitle: '服务',
    icon: 'mdi-hand-heart-outline',
    order: 50,
    component: () => import('@/pages/bob/service/Service.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'warehouse',
    entityTitle: '仓库',
    icon: 'mdi-warehouse',
    order: 60,
    component: () => import('@/pages/bob/warehouse/Warehouse.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'vehicle',
    entityTitle: '车辆',
    icon: 'mdi-truck-outline',
    order: 70,
    component: () => import('@/pages/bob/vehicle/Vehicle.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'fund-account',
    entityTitle: '资金账户',
    icon: 'mdi-bank-outline',
    order: 80,
    component: () => import('@/pages/bob/fund-account/FundAccount.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'category',
    entityTitle: '分类',
    icon: 'mdi-shape-outline',
    order: 90,
    component: () => import('@/pages/bob/category/Category.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'department',
    entityTitle: '部门',
    icon: 'mdi-office-building-outline',
    order: 100,
    component: () => import('@/pages/bob/department/Department.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'position',
    entityTitle: '岗位',
    icon: 'mdi-briefcase-account-outline',
    order: 110,
    component: () => import('@/pages/bob/position/Position.vue'),
  },
  {
    domain: 'bob',
    domainTitle: '基础业务对象',
    domainIcon: 'mdi-database-outline',
    domainOrder: 10,
    entity: 'settlement-method',
    entityTitle: '结算方式',
    icon: 'mdi-calendar-clock-outline',
    order: 120,
    component: () =>
      import('@/pages/bob/settlement-method/SettlementMethod.vue'),
  },
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
