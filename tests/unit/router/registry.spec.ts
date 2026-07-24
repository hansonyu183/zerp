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

  it('显示所有非 APP 权限实体，并优先使用本地注册菜单元数据', () => {
    const menus = buildMenus(normalizePermissions([
      '/app/user/query',
      '/bob/customer/create',
      '/bob/customer/query',
      '/bob/customer/update',
      '/bob/supplier/query',
      '/inv/stock/create',
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
          {
            entity: 'supplier',
            title: '供应商',
            icon: 'mdi-truck-delivery-outline',
            order: 20,
            actions: ['query'],
          },
        ],
      },
      {
        domain: 'inv',
        title: 'Inv',
        order: Number.MAX_SAFE_INTEGER,
        children: [
          {
            entity: 'stock',
            title: 'Stock',
            order: Number.MAX_SAFE_INTEGER,
            actions: ['create'],
          },
        ],
      },
    ])
    expect(buildMenus(['/app/user/query'])).toEqual([])
    expect(buildMenus(['/bob/customer/create'])).toHaveLength(1)
  })

  it('按本地领域和实体顺序生成菜单，未注册实体排在已注册实体之后', () => {
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
    expect(menus[0]?.children.map((entity) => entity.entity)).toEqual([
      'customer',
      'supplier',
    ])
    expect(menus[1]?.children.map((entity) => entity.entity)).toEqual(['saleorder'])
  })

  it('为全部菜单注册路由，未注册组件使用开发中占位页', () => {
    const router = createTestRouter()
    const menus = buildMenus([
      '/bob/customer/query',
      '/bob/customer/create',
      '/bob/supplier/query',
    ])

    expect(hasRegisteredPage('bob', 'customer')).toBe(true)
    expect(hasRegisteredPage('bob', 'supplier')).toBe(true)
    expect(registerMenuRoutes(router, menus)).toBe(2)
    expect(router.hasRoute('page:bob/customer')).toBe(true)
    expect(router.hasRoute('page:bob/supplier')).toBe(true)
    expect(router.resolve('/bob/customer').meta.actions).toEqual(['query', 'create'])
    expect(router.resolve('/bob/customer').meta.developing).toBe(false)
    expect(router.resolve('/bob/supplier').meta.actions).toEqual(['query'])
    expect(router.resolve('/bob/supplier').meta.developing).toBe(false)
    expect(resolveFirstMenuPath(menus)).toBe('/bob/customer')

    expect(registerMenuRoutes(router, [])).toBe(0)
    expect(router.hasRoute('page:bob/customer')).toBe(false)
    expect(router.hasRoute('page:bob/supplier')).toBe(false)
    expect(router.resolve('/bob/customer').name).toBe('not-found')
    expect(resolveFirstMenuPath([])).toBe('/home/dashboard')
  })

  it('为 BOB 十二类实体加载真实页面组件', () => {
    const entities = [
      'customer',
      'supplier',
      'employee',
      'product',
      'service',
      'warehouse',
      'vehicle',
      'fund-account',
      'category',
      'department',
      'position',
      'settlement-method',
    ]
    const router = createTestRouter()
    const menus = buildMenus(
      entities.map((entity) => `/bob/${entity}/query`),
    )

    expect(menus[0]?.children.map((item) => item.entity)).toEqual(entities)
    expect(registerMenuRoutes(router, menus)).toBe(entities.length)
    for (const entity of entities) {
      expect(hasRegisteredPage('bob', entity)).toBe(true)
      expect(router.resolve(`/bob/${entity}`).meta.developing).toBe(false)
    }
  })
})
