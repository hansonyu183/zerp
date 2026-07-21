import type { Component } from 'vue'
import type { Router } from 'vue-router'
import type { MenuDomain } from '@/stores/session'

type PageLoader = () => Promise<{ default: Component }>

export const pageRegistry: Record<string, PageLoader> = {}

const registeredRouteNames = new Set<string>()
const SAFE_SEGMENT = /^[a-z][a-z0-9-]*$/

export function hasRegisteredPage(domain: string, entity: string): boolean {
  return `${domain}/${entity}` in pageRegistry
}

export function registerMenuRoutes(router: Router, menus: MenuDomain[]): number {
  const expectedRouteNames = new Set<string>()
  let added = 0

  for (const domain of menus) {
    if (!SAFE_SEGMENT.test(domain.domain)) continue

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

export function resolveFirstMenuPath(menus: MenuDomain[]): string {
  for (const domain of menus) {
    for (const entity of domain.children) {
      if (hasRegisteredPage(domain.domain, entity.entity)) {
        return `/${domain.domain}/${entity.entity}`
      }
    }
  }

  return '/home/dashboard'
}
