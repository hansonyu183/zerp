import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import {
  createSessionNavigationGuard,
  watchSessionMenuRoutes,
} from '@/router/guards'
import { registerMenuRoutes } from '@/router/registry'
import { useSessionStore } from '@/stores/session'

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
  it('会话已初始化但路由缺失时，在首次导航中注册并重新匹配真实页面', async () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    session.permissions = ['/aux/product-category/query']
    router.beforeEach(createSessionNavigationGuard(router, session))

    await router.push('/aux/product-category')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('page:aux/product-category')
    expect(router.currentRoute.value.meta.title).toBe('产品分类')
    expect(router.currentRoute.value.meta.developing).toBe(false)

    registerMenuRoutes(router, [])
  })

  it('权限运行期变化时立即增加和清理对应业务路由', () => {
    const router = createTestRouter()
    const session = createAuthenticatedSession()
    const stop = watchSessionMenuRoutes(router, session)

    expect(router.hasRoute('page:aux/department')).toBe(false)

    session.permissions = ['/aux/department/create']
    expect(router.hasRoute('page:aux/department')).toBe(true)
    expect(router.resolve('/aux/department').meta.title).toBe('部门')

    session.permissions = []
    expect(router.hasRoute('page:aux/department')).toBe(false)

    stop()
  })
})
