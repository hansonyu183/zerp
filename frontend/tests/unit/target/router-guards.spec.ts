import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'

import { createSessionGuard } from '@/target/router/guards.ts'
import { createTargetRouter } from '@/target/router/index.ts'
import { useTargetSession } from '@/target/session/vm.ts'

describe('formal router session guard', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('preserves the complete same-site deep link for unauthenticated users', async () => {
    const router = createTargetRouter(createMemoryHistory())
    const session = useTargetSession()
    vi.spyOn(session, 'restore').mockImplementation(async () => {
      session.initialized = true
      return false
    })
    router.beforeEach(createSessionGuard(session))

    await router.push('/missing-page?tab=history#version-2')
    expect(router.currentRoute.value).toMatchObject({
      name: 'signin',
      query: { redirect: '/missing-page?tab=history#version-2' },
    })
  })

  it('restricts forced-password sessions to the change-password page', async () => {
    const router = createTargetRouter(createMemoryHistory())
    const session = useTargetSession()
    session.initialized = true
    session.user = {
      id: 'u1',
      username: 'tester',
      displayName: '测试',
      avatarUrl: null,
    }
    session.passwordChangeRequired = true
    router.beforeEach(createSessionGuard(session))

    await router.push('/home/dashboard')
    expect(router.currentRoute.value.name).toBe('change-password')
  })

  it('distinguishes a known unauthorized menu route from an unknown route', async () => {
    const router = createTargetRouter(createMemoryHistory())
    const session = useTargetSession()
    session.initialized = true
    session.user = {
      id: 'u1',
      username: 'tester',
      displayName: '测试',
      avatarUrl: null,
    }
    session.menu = {
      mode: 'DEFAULT',
      revision: '1',
      defaultMenu: { items: [] },
      businessMenu: { items: [] },
      navigation: { items: [] },
      availableRoutes: [
        {
          routeKey: 'app/user',
          routePath: '/app/user',
          displayName: '用户管理',
          permissionCode: '/app/user/query',
        },
      ],
    }
    router.beforeEach(createSessionGuard(session))

    await router.push('/app/user')
    expect(router.currentRoute.value.name).toBe('forbidden')
    await router.push('/not-registered')
    expect(router.currentRoute.value.name).toBe('not-found')
  })

  it('admits menu management with any executable menu-management permission', async () => {
    const router = createTargetRouter(createMemoryHistory())
    const session = useTargetSession()
    session.initialized = true
    session.user = {
      id: 'u1',
      username: 'tester',
      displayName: '测试',
      avatarUrl: null,
    }
    session.permissions = ['/app/menu/activate']
    router.beforeEach(createSessionGuard(session))

    await router.push('/app/menu')
    expect(router.currentRoute.value.name).toBe('page:app/menu')
  })

  it('admits dynamic WFL and RPT routes only with exact server catalog and permissions', async () => {
    const router = createTargetRouter(createMemoryHistory())
    const session = useTargetSession()
    session.initialized = true
    session.user = {
      id: 'u1',
      username: 'tester',
      displayName: '测试',
      avatarUrl: null,
    }
    session.permissions = [
      '/wfl/process-instance/query',
      '/rpt/rpt-000001/query',
    ]
    session.menu = {
      mode: 'DEFAULT',
      revision: '1',
      defaultMenu: { items: [] },
      businessMenu: { items: [] },
      navigation: { items: [] },
      availableRoutes: [
        {
          routeKey: 'wfl/sale-flow',
          routePath: '/wfl/sale-flow',
          displayName: '销售流程',
          permissionCode: '/wfl/process-instance/query',
        },
        {
          routeKey: 'rpt/rpt-000001',
          routePath: '/rpt/rpt-000001',
          displayName: '销售报表',
          permissionCode: '/rpt/rpt-000001/query',
        },
      ],
    }
    router.beforeEach(createSessionGuard(session))

    await router.push('/wfl/sale-flow')
    expect(router.currentRoute.value.name).toBe('page:wfl/dynamic-process')
    await router.push('/rpt/rpt-000001')
    expect(router.currentRoute.value.name).toBe('page:rpt/dynamic-report')
    await router.push('/wfl/disabled-flow')
    expect(router.currentRoute.value.name).toBe('forbidden')
    await router.push('/wfl/UPPER')
    expect(router.currentRoute.value.name).toBe('forbidden')

    session.permissions = ['/wfl/process-instance/query']
    await router.push('/rpt/rpt-000001')
    expect(router.currentRoute.value.name).toBe('forbidden')
  })
})
