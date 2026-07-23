import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import { hasRegisteredPage, registerMenuRoutes, resolveFirstMenuPath } from '@/router/registry'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        name: 'app',
        component: AppLayout,
        children: [],
      },
    ],
  })
}

describe('router registry', () => {
  it('注册本地存在的 BOB 客户页面并过滤未知实体', () => {
    const router = createTestRouter()
    const menus = [
      {
        domain: 'bob',
        title: '基础资料',
        children: [
          { entity: 'customer', title: '客户', actions: ['query'] },
          { entity: 'supplier', title: '供应商', actions: ['query'] },
        ],
      },
    ]

    expect(hasRegisteredPage('bob', 'customer')).toBe(true)
    expect(hasRegisteredPage('bob', 'supplier')).toBe(false)
    expect(registerMenuRoutes(router, menus)).toBe(1)
    expect(router.hasRoute('page:bob/customer')).toBe(true)
    expect(resolveFirstMenuPath(menus)).toBe('/bob/customer')
  })
})
