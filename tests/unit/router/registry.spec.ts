import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import {
  buildMenus,
  hasRegisteredPage,
  normalizePermissions,
  registerMenuRoutes,
  resolveFirstMenuPath,
  type PageRegistration,
} from '@/router/registry'

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
      {
        path: '/:pathMatch(.*)*',
        name: 'not-found',
        component: { template: '<div />' },
      },
    ],
  })
}

describe('permission menu registry', () => {
  it('只保留格式正确的完整权限路径并去重', () => {
    expect(normalizePermissions([
      '/bob/customer/query',
      '/bob/customer/query',
      '/bob/customer/create',
      'bob/customer/update',
      '/BOB/customer/query',
      '/bob/customer',
      null,
    ])).toEqual([
      '/bob/customer/query',
      '/bob/customer/create',
    ])
    for (const invalidValue of [undefined, null, {}, 'permissions']) {
      expect(normalizePermissions(invalidValue)).toEqual([])
    }
  })

  it('从权限和本地注册表生成菜单并排除 APP、未知页面和无 query 实体', () => {
    const menus = buildMenus(normalizePermissions([
      '/app/user/query',
      '/bob/customer/create',
      '/bob/customer/query',
      '/bob/customer/update',
      '/bob/supplier/query',
    ]))

    expect(menus).toEqual([
      {
        domain: 'bob',
        title: '基础业务对象',
        icon: 'mdi-database-outline',
        order: 10,
        children: [
          {
            entity: 'customer',
            title: '客户',
            icon: 'mdi-account-group',
            order: 10,
            actions: ['create', 'query', 'update'],
          },
        ],
      },
    ])
    expect(buildMenus(['/bob/customer/create'])).toEqual([])
  })

  it('按本地领域和实体顺序生成菜单并隐藏空领域', () => {
    const component = async () => ({ default: { template: '<div />' } })
    const registrations: PageRegistration[] = [
      {
        domain: 'app',
        domainTitle: '系统能力',
        domainOrder: 1,
        entity: 'user',
        entityTitle: '用户',
        order: 1,
        component,
      },
      {
        domain: 'vou',
        domainTitle: '销售',
        domainOrder: 20,
        entity: 'saleorder',
        entityTitle: '销售订单',
        order: 20,
        component,
      },
      {
        domain: 'bob',
        domainTitle: '基础业务对象',
        domainOrder: 10,
        entity: 'supplier',
        entityTitle: '供应商',
        order: 20,
        component,
      },
      {
        domain: 'bob',
        domainTitle: '基础业务对象',
        domainOrder: 10,
        entity: 'customer',
        entityTitle: '客户',
        order: 10,
        component,
      },
    ]

    const menus = buildMenus([
      '/app/user/query',
      '/vou/saleorder/query',
      '/bob/supplier/create',
      '/bob/customer/query',
    ], registrations)

    expect(menus.map((domain) => domain.domain)).toEqual(['bob', 'vou'])
    expect(menus[0]?.children.map((entity) => entity.entity)).toEqual(['customer'])
    expect(menus[1]?.children.map((entity) => entity.entity)).toEqual(['saleorder'])
  })

  it('只为生成的菜单注册动态路由并在权限移除后删除路由', () => {
    const router = createTestRouter()
    const menus = buildMenus([
      '/bob/customer/query',
      '/bob/customer/create',
      '/bob/supplier/query',
    ])

    expect(hasRegisteredPage('bob', 'customer')).toBe(true)
    expect(hasRegisteredPage('bob', 'supplier')).toBe(false)
    expect(registerMenuRoutes(router, menus)).toBe(1)
    expect(router.hasRoute('page:bob/customer')).toBe(true)
    expect(router.resolve('/bob/customer').meta.actions).toEqual(['query', 'create'])
    expect(resolveFirstMenuPath(menus)).toBe('/bob/customer')

    expect(registerMenuRoutes(router, [])).toBe(0)
    expect(router.hasRoute('page:bob/customer')).toBe(false)
    expect(router.resolve('/bob/customer').name).toBe('not-found')
    expect(resolveFirstMenuPath([])).toBe('/home/dashboard')
  })
})
