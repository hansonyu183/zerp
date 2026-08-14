import { watch, type WatchStopHandle } from 'vue'
import type { NavigationGuard, Router } from 'vue-router'
import type { useSessionStore } from '@/stores/session'
import { registerMenuRoutes } from './registry'

type SessionStore = ReturnType<typeof useSessionStore>

export function watchSessionMenuRoutes(
  router: Router,
  session: SessionStore,
): WatchStopHandle {
  return watch(
    () => session.routeMenus,
    (menus) => registerMenuRoutes(router, menus),
    {
      deep: true,
      flush: 'sync',
      immediate: true,
    },
  )
}

export function createSessionNavigationGuard(
  router: Router,
  session: SessionStore,
): NavigationGuard {
  return async (to) => {
    if (!session.initialized) await session.restore()

    registerMenuRoutes(router, session.routeMenus)

    if (to.name === 'not-found') {
      const rematched = router.resolve(to.fullPath)
      if (rematched.name !== 'not-found') return to.fullPath
      if (session.authenticated && session.isKnownRoutePath(to.path)) {
        return { name: 'forbidden' }
      }
    }

    if (to.name === 'signin') {
      return session.authenticated ? '/home/dashboard' : true
    }

    if (to.meta.requiresAuth && !session.authenticated) {
      return {
        name: 'signin',
        query: { redirect: to.fullPath },
      }
    }

    const requiredPermission = to.meta.requiredPermission
    if (
      typeof requiredPermission === 'string' &&
      !session.can(requiredPermission)
    ) {
      return { name: 'forbidden' }
    }

    const requiredAnyPermissions = to.meta.requiredAnyPermissions
    if (
      Array.isArray(requiredAnyPermissions) &&
      requiredAnyPermissions.length > 0 &&
      !requiredAnyPermissions.some(
        (permission) =>
          typeof permission === 'string' && session.can(permission),
      )
    ) {
      return { name: 'forbidden' }
    }

    return true
  }
}
