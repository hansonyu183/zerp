import type { NavigationGuard, Router } from 'vue-router'

import type { useTargetSession } from '../session/vm.ts'

type Session = ReturnType<typeof useTargetSession>

export function createSessionGuard(session: Session): NavigationGuard {
  return async (to) => {
    if (!session.initialized) await session.restore()
    if (session.authenticated && session.passwordChangeRequired)
      return to.name === 'change-password' ? true : { name: 'change-password' }
    if (to.name === 'change-password')
      return session.authenticated ? '/home/dashboard' : { name: 'signin' }
    if (to.name === 'signin')
      return session.authenticated ? '/home/dashboard' : true
    if (to.meta.requiresAuth && !session.authenticated)
      return { name: 'signin', query: { redirect: to.fullPath } }
    if (
      to.name === 'not-found' &&
      session.authenticated &&
      session.isKnownRoute(to.path)
    )
      return { name: 'forbidden' }
    if (to.meta.requiresServerRoute === true && !session.isKnownRoute(to.path))
      return { name: 'forbidden' }
    const permission = to.meta.requiredPermission
    if (typeof permission === 'string' && !session.can(permission))
      return { name: 'forbidden' }
    if (to.meta.requiredDynamicPermission === 'wfl-query') {
      const processCode = to.params.processCode
      if (
        typeof processCode !== 'string' ||
        !/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.test(processCode)
      )
        return { name: 'forbidden' }
    }
    if (to.meta.requiredDynamicPermission === 'rpt-query') {
      const reportCode = to.params.reportCode
      if (
        typeof reportCode !== 'string' ||
        !/^rpt-[0-9]{6}$/.test(reportCode) ||
        !session.can(`/rpt/${reportCode}/query`)
      )
        return { name: 'forbidden' }
    }
    const anyPermissions = to.meta.requiredAnyPermissions
    if (
      Array.isArray(anyPermissions) &&
      !anyPermissions.some(
        (candidate) => typeof candidate === 'string' && session.can(candidate),
      )
    )
      return { name: 'forbidden' }
    return true
  }
}

export function installRouterBehavior(router: Router, session: Session): void {
  router.beforeEach(createSessionGuard(session))
  const title = (value: unknown) => {
    const page = typeof value === 'string' ? value : ''
    document.title = page ? `${page} · ZERP` : 'ZERP'
  }
  router.afterEach((to) => title(to.meta.title))
}
