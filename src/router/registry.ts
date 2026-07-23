import type { Component } from 'vue'
import type { Router } from 'vue-router'
import type { MenuDomain } from '@/stores/session'

type PageLoader = () => Promise<{ default: Component }>

const pageModules = import.meta.glob<{ default: Component }>([
  '../pages/*/*/*.vue',
  '!../pages/auth/user/*.vue',
  '!../pages/home/dashboard/*.vue',
  '!../pages/system/notfound/*.vue',
])

export const pageRegistry: Record<string, PageLoader> = Object.fromEntries(
  Object.entries(pageModules).flatMap(([path, loader]) => {
    const match = path.match(/^\.\.\/pages\/([^/]+)\/([^/]+)\/[^/]+\.vue$/)
    if (!match) return []

    const [, domain, entity] = match
    return [[`${domain}/${entity}`, loader as PageLoader]]
  }),
)

const registeredRouteNames = new Set<string>()
const SAFE_SEGMENT = /^[a-z][a-z0-9-]*$/

export function hasRegisteredPage(domain: string, entity: string): boolean {
  return `${domain}/${entity}` in pageRegistry
}

export function registerMenuRoutes(
  router: Router,
  menus: MenuDomain[] | null | undefined,
): number {
  const expectedRouteNames = new Set<string>()
  let added = 0

  for (const domain of Array.isArray(menus) ? menus : []) {
    if (domain.domain === 'app' || !SAFE_SEGMENT.test(domain.domain)) continue

    for (const entity of domain.children) {
      if (!SAFE_SEGMENT.test(entity.entity)) continue

      const key = `${domain.domain}/${entity.entity}`
      const component = pageRegistry[key]
      if (!component) {
        console.warn(`[router] 后端菜单未注册本地页面：${key}`)
        continue
      }

      const routeName = `page:${key}`
      expectedRouteNames.add(routeName)
      if (router.hasRoute(routeName)) continue

      router.addRoute('app', {
        path: key,
        name: routeName,
        component,
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

export function resolveFirstMenuPath(menus: MenuDomain[] | null | undefined): string {
  for (const domain of Array.isArray(menus) ? menus : []) {
    if (domain.domain === 'app') continue

    for (const entity of domain.children) {
      if (hasRegisteredPage(domain.domain, entity.entity)) {
        return `/${domain.domain}/${entity.entity}`
      }
    }
  }

  return '/home/dashboard'
}
