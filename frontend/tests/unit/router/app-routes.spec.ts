import { describe, expect, it } from 'vitest'
import { router } from '@/router'

describe('canonical APP management routes', () => {
  it('只注册 APP 页面路由且不保留 admin 兼容路由', () => {
    const routes = router.getRoutes()
    const routeNames = new Set(routes.map((route) => String(route.name ?? '')))
    const routePaths = new Set(routes.map((route) => route.path))

    for (const entity of [
      'user',
      'role',
      'permission',
      'system-parameter',
      'menu',
    ]) {
      expect(routeNames).toContain(`page:app/${entity}`)
      expect(routePaths).toContain(`/app/${entity}`)
      expect(routeNames).not.toContain(`page:admin/${entity}`)
      expect(routePaths).not.toContain(`/admin/${entity}`)
    }
  })
})
