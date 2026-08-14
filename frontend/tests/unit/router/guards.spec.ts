import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import {
  createSessionNavigationGuard,
  watchSessionMenuRoutes,
} from '@/router/guards'
import { registerMenuRoutes } from '@/router/registry'
import { useSessionStore } from '@/stores/session'

function applyNavigation(
  session: ReturnType<typeof useSessionStore>,
  routes: Array<{ key: string; title: string }>,
) {
  const group = {
    id: 'group',
    parentId: null,
    type: 'GROUP' as const,
    level: 1,
    order: 10,
    displayName: '测试分组',
    icon: null,
    enabled: true,
    routeKey: null,
    routePath: null,
    permissionCode: null,
  }
  const tree = {
    revision: 1,
    items: [
      group,
      ...routes.map((route, index) => ({
        id: route.key,
        parentId: 'group',
        type: 'ROUTE' as const,
        level: 2,
        order: (index + 1) * 10,
        displayName: route.title,
        icon: null,
        enabled: true,
        routeKey: route.key,
        routePath: `/${route.key}`,
        permissionCode: `/${route.key}/query`,
      })),
    ],
  }
  session.applyMenuData({
    mode: 'DEFAULT',
    modeRevision: 1,
    catalogRevision: 'catalog-revision',
    defaultMenu: tree,
    businessTemplate: tree,
    navigation: tree,
    availableRoutes: routes.map((route) => ({
      routeKey: route.key,
      routePath: `/${route.key}`,
      displayName: route.title,
      permissionCode: `/${route.key}/query`,
    })),
  })
}

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/signin',
        name: 'signin',
        component: { template: '<div />' },
        meta: { public: true },
      },
      {
        path: '/',
        name: 'app',
        component: { template: '<router-view />' },
        meta: { requiresAuth: true },
        children: [
          {
            path: 'home/dashboard',
            name: 'page:home/dashboard',
            component: { template: '<div />' },
            meta: { requiresAuth: true },
          },
          {
            path: 'admin/user',
            name: 'page:admin/user',
            component: { template: '<div />' },
            meta: {
              requiresAuth: true,
              requiredPermission: '/app/user/query',
            },
          },
          {
            path: 'admin/menu',
            name: 'page:admin/menu',
            component: { template: '<div />' },
            meta: {
              requiresAuth: true,
              requiredAnyPermissions: [
                '/app/menu/save-business-template',
                '/app/menu/activate',
                '/app/menu/reset-business-template',
              ],
            },
          },
          {
            path: 'forbidden',
            name: 'forbidden',
            component: { template: '<div />' },
            meta: { requiresAuth: true },
          },
        ],
      },
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: { template: '<div />' },
        meta: { requiresAuth: true },
      },
    ],
  })
}

function createAuthenticatedSession() {
  setActivePinia(createPinia())
  const session = useSessionStore()
  session.initialized = true
  session.user = {
    id: 'USER-1',
    username: 'tester',
    displayName: '测试用户',
  }
  return session
}

describe('session menu route synchronization', () => {
  it('未登录首次访问受保护深链时先恢复会话并保留完整目标', async () => {
    setActivePinia(createPinia())
    const router = createTestRouter()
    const session = useSessionStore()
    const restore = vi
      .spyOn(session, 'restore')
      .mockImplementation(async () => {
        session.initialized = true
        return false
      })
    router.beforeEach(createSessionNavigationGuard(router, session))

    await router.push('/bob/customer?tab=history#version-2')

    expect(restore).toHaveBeenCalledOnce()
    expect(router.currentRoute.value).toMatchObject({
      name: 'signin',
      query: { redirect: '/bob/customer?tab=history#version-2' },
    })
  })

  it('系统管理静态路由要求精确 APP 查询权限', async () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    router.beforeEach(createSessionNavigationGuard(router, session))

    await router.push('/admin/user')
    expect(router.currentRoute.value.name).toBe('forbidden')

    session.permissions = ['/app/user/query-extra']
    await router.push('/admin/user')
    expect(router.currentRoute.value.name).toBe('forbidden')

    session.permissions = ['/app/user/query']
    await router.push('/admin/user')
    expect(router.currentRoute.value.name).toBe('page:admin/user')
  })

  it('菜单管理入口接受任一菜单写权限且拒绝无关权限', async () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    router.beforeEach(createSessionNavigationGuard(router, session))

    session.permissions = ['/app/user/query']
    await router.push('/admin/menu')
    expect(router.currentRoute.value.name).toBe('forbidden')

    session.permissions = ['/app/menu/activate']
    await router.push('/admin/menu')
    expect(router.currentRoute.value.name).toBe('page:admin/menu')
  })

  it('会话已初始化但路由缺失时，在首次导航中注册并重新匹配真实页面', async () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    session.permissions = ['/aux/product-category/query']
    applyNavigation(session, [
      { key: 'aux/product-category', title: '产品分类' },
    ])
    router.beforeEach(createSessionNavigationGuard(router, session))

    await router.push('/aux/product-category')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('page:aux/product-category')
    expect(router.currentRoute.value.meta.title).toBe('产品分类')
    expect(router.currentRoute.value.meta.developing).toBe(false)

    registerMenuRoutes(router, [])
  })

  it('已知动态页面无权限时进入无权访问', async () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    applyNavigation(session, [
      { key: 'aux/product-category', title: '产品分类' },
    ])
    router.beforeEach(createSessionNavigationGuard(router, session))

    await router.push('/aux/product-category?status=EFFECTIVE#results')

    expect(router.currentRoute.value.name).toBe('forbidden')
  })

  it('未在路由目录中的目标进入页面不存在', async () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    applyNavigation(session, [
      { key: 'aux/product-category', title: '产品分类' },
    ])
    router.beforeEach(createSessionNavigationGuard(router, session))

    await router.push('/aux/not-a-real-page')

    expect(router.currentRoute.value.name).toBe('not-found')
  })

  it('服务端最新路由目录已移除的本地页面视为不存在', async () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    applyNavigation(session, [])
    router.beforeEach(createSessionNavigationGuard(router, session))

    await router.push('/aux/product-category')

    expect(router.currentRoute.value.name).toBe('not-found')
  })

  it('权限运行期变化时立即增加和清理对应业务路由', () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    const stop = watchSessionMenuRoutes(router, session)

    expect(router.hasRoute('page:aux/department')).toBe(false)

    session.permissions = ['/aux/department/create']
    applyNavigation(session, [{ key: 'aux/department', title: '部门' }])
    expect(router.hasRoute('page:aux/department')).toBe(true)
    expect(router.resolve('/aux/department').meta.title).toBe('部门')

    session.permissions = []
    applyNavigation(session, [])
    expect(router.hasRoute('page:aux/department')).toBe(false)

    stop()
  })

  it('导航隐藏授权页面时仍注册路由，并在权限撤销后移除', async () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    session.permissions = ['/bob/customer/query']
    applyNavigation(session, [])
    const stop = watchSessionMenuRoutes(router, session)
    router.beforeEach(createSessionNavigationGuard(router, session))

    expect(
      session.menus.some((domain) =>
        domain.children.some((entity) => entity.routeKey === 'bob/customer'),
      ),
    ).toBe(false)
    expect(router.hasRoute('page:bob/customer')).toBe(true)

    await router.push('/bob/customer')
    expect(router.currentRoute.value.name).toBe('page:bob/customer')

    session.permissions = []
    expect(router.hasRoute('page:bob/customer')).toBe(false)

    stop()
  })

  it('服务端导航中的自定义 WFL 路由可由非 query 权限注册', async () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    session.permissions = ['/wfl/custom-flow/get']
    applyNavigation(session, [{ key: 'wfl/custom-flow', title: '自定义流程' }])
    const stop = watchSessionMenuRoutes(router, session)
    router.beforeEach(createSessionNavigationGuard(router, session))

    expect(router.hasRoute('page:wfl/custom-flow')).toBe(true)

    await router.push('/wfl/custom-flow')
    expect(router.currentRoute.value.name).toBe('page:wfl/custom-flow')
    expect(router.currentRoute.value.meta).toMatchObject({
      actions: ['get'],
      developing: false,
      processName: 'custom-flow',
    })

    session.permissions = []
    expect(router.hasRoute('page:wfl/custom-flow')).toBe(false)

    stop()
  })
})
