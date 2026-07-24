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

  const domains = new Map<string, MenuDomain>()
  const sortedRegistrations = [...registrations].sort(
    (left, right) =>
      left.domainOrder - right.domainOrder ||
      left.domain.localeCompare(right.domain) ||
      left.order - right.order ||
      left.entity.localeCompare(right.entity),
  )

  for (const registration of sortedRegistrations) {
    if (registration.domain === 'app') continue

    const actions = actionsByPage.get(
      `${registration.domain}/${registration.entity}`,
    )
    if (!actions?.includes('query')) continue

    const existingDomain = domains.get(registration.domain)
    const domain = existingDomain ?? {
      domain: registration.domain,
      title: registration.domainTitle,
      ...(registration.domainIcon ? { icon: registration.domainIcon } : {}),
      order: registration.domainOrder,
      children: [],
    }

    domain.children.push({
      entity: registration.entity,
      title: registration.entityTitle,
      ...(registration.icon ? { icon: registration.icon } : {}),
      order: registration.order,
      actions,
    })
    domains.set(registration.domain, domain)
  }

  return [...domains.values()]
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
      if (!registration) continue

      const routeName = `page:${key}`
      expectedRouteNames.add(routeName)
      if (router.hasRoute(routeName)) continue

      router.addRoute('app', {
        path: key,
        name: routeName,
        component: registration.component,
        meta: {
          requiresAuth: true,
          title: entity.title,
          actions: entity.actions,
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
