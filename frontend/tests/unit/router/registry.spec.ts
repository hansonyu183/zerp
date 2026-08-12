import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import {
  buildMenus,
  buildServerMenus,
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
  it('系统默认菜单保留本地注册名称，业务模板保留管理员名称', () => {
    const route = {
      id: 'route-other-party',
      parentId: 'default-bob',
      type: 'ROUTE' as const,
      order: 10,
      displayName: '客户',
      icon: null,
      routeKey: 'bob/other-party',
      routePath: '/bob/other-party',
    }
    const defaultMenu = buildServerMenus(
      [
        {
          id: 'default-bob',
          parentId: null,
          type: 'GROUP',
          order: 10,
          displayName: '业务对象',
          icon: null,
          routeKey: null,
          routePath: null,
        },
        route,
      ],
      ['/bob/other-party/query'],
    )
    const businessMenu = buildServerMenus(
      [
        {
          id: 'menu-group-sales',
          parentId: null,
          type: 'GROUP',
          order: 10,
          displayName: '销售',
          icon: null,
          routeKey: null,
          routePath: null,
        },
        { ...route, parentId: 'menu-group-sales' },
      ],
      ['/bob/other-party/query'],
    )

    expect(defaultMenu[0]?.children[0]?.title).toBe('其他往来单位')
    expect(businessMenu[0]?.children[0]?.title).toBe('客户')
  })

  it('只保留格式正确的完整权限路径并去重', () => {
    expect(
      normalizePermissions([
        '/bob/customer/query',
        '/bob/customer/query',
        '/bob/customer/create',
        'bob/customer/update',
        '/BOB/customer/query',
        '/bob/customer',
        null,
      ]),
    ).toEqual(['/bob/customer/query', '/bob/customer/create'])
    for (const invalidValue of [undefined, null, {}, 'permissions']) {
      expect(normalizePermissions(invalidValue)).toEqual([])
    }
  })

  it('显示所有非 APP 权限实体，并优先使用本地菜单元数据', () => {
    const menus = buildMenus(
      normalizePermissions([
        '/app/user/query',
        '/bob/customer/create',
        '/bob/customer/query',
        '/bob/customer/update',
        '/bob/supplier/query',
        '/inv/stock/create',
      ]),
    )

    expect(menus).toEqual([
      {
        domain: 'bob',
        title: '业务对象',
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
    expect(buildMenus(['/aux/unknown/query'])).toMatchObject([
      {
        domain: 'aux',
        title: '辅助对象',
        children: [
          {
            entity: 'unknown',
            title: 'Unknown',
            actions: ['query'],
          },
        ],
      },
    ])
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

    const menus = buildMenus(
      [
        '/app/user/query',
        '/vou/saleorder/query',
        '/bob/supplier/create',
        '/bob/customer/query',
      ],
      registrations,
    )

    expect(menus.map((domain) => domain.domain)).toEqual(['bob', 'vou'])
    expect(menus[0]?.children.map((entity) => entity.entity)).toEqual([
      'customer',
      'supplier',
    ])
    expect(menus[1]?.children.map((entity) => entity.entity)).toEqual([
      'saleorder',
    ])
  })

  it('为全部授权菜单注册路由，未注册组件使用开发中占位页', () => {
    const router = createTestRouter()
    const menus = buildMenus([
      '/bob/customer/query',
      '/bob/customer/create',
      '/bob/supplier/query',
      '/aux/unknown/query',
    ])

    expect(hasRegisteredPage('bob', 'customer')).toBe(true)
    expect(hasRegisteredPage('bob', 'supplier')).toBe(true)
    expect(registerMenuRoutes(router, menus)).toBe(3)
    expect(router.hasRoute('page:bob/customer')).toBe(true)
    expect(router.hasRoute('page:bob/supplier')).toBe(true)
    expect(router.resolve('/bob/customer').meta.actions).toEqual([
      'query',
      'create',
    ])
    expect(router.resolve('/bob/customer').meta.developing).toBe(false)
    expect(router.resolve('/bob/supplier').meta.actions).toEqual(['query'])
    expect(router.resolve('/bob/supplier').meta.developing).toBe(false)
    expect(router.hasRoute('page:aux/unknown')).toBe(true)
    expect(router.resolve('/aux/unknown').meta.actions).toEqual(['query'])
    expect(router.resolve('/aux/unknown').meta.developing).toBe(true)
    expect(resolveFirstMenuPath(menus)).toBe('/bob/customer')

    expect(registerMenuRoutes(router, [])).toBe(0)
    expect(router.hasRoute('page:bob/customer')).toBe(false)
    expect(router.hasRoute('page:bob/supplier')).toBe(false)
    expect(router.hasRoute('page:aux/unknown')).toBe(false)
    expect(router.resolve('/bob/customer').name).toBe('not-found')
    expect(resolveFirstMenuPath([])).toBe('/home/dashboard')
  })

  it('为 BOB 九类实体加载真实页面组件', () => {
    const entities = [
      'customer',
      'supplier',
      'employee',
      'product',
      'service',
      'warehouse',
      'vehicle',
      'fund-account',
      'settlement-method',
    ]
    const titles = [
      '客户',
      '供应商',
      '员工',
      '产品',
      '服务',
      '仓库',
      '车辆',
      '资金账户',
      '结算方式',
    ]
    const router = createTestRouter()
    const menus = buildMenus(entities.map((entity) => `/bob/${entity}/query`))

    expect(menus[0]?.children.map((item) => item.entity)).toEqual(entities)
    expect(menus[0]?.children.map((item) => item.title)).toEqual(titles)
    expect(registerMenuRoutes(router, menus)).toBe(entities.length)
    for (const [index, entity] of entities.entries()) {
      expect(hasRegisteredPage('bob', entity)).toBe(true)
      expect(router.resolve(`/bob/${entity}`).meta).toMatchObject({
        developing: false,
        title: titles[index],
      })
    }

    registerMenuRoutes(router, [])
  })

  it('权限动作变化时更新已有动态路由的元数据', () => {
    const router = createTestRouter()

    expect(
      registerMenuRoutes(router, buildMenus(['/bob/customer/query'])),
    ).toBe(1)
    expect(router.resolve('/bob/customer').meta.actions).toEqual(['query'])

    expect(
      registerMenuRoutes(
        router,
        buildMenus(['/bob/customer/create', '/bob/customer/save']),
      ),
    ).toBe(1)
    expect(router.resolve('/bob/customer').meta.actions).toEqual([
      'create',
      'save',
    ])
    expect(
      registerMenuRoutes(
        router,
        buildMenus(['/bob/customer/create', '/bob/customer/save']),
      ),
    ).toBe(0)

    registerMenuRoutes(router, [])
  })

  it('为 AUX 八类实体生成中文菜单并加载真实页面组件', () => {
    const entities = [
      'product-category',
      'department',
      'position',
      'measurement-unit',
      'dictionary-type',
      'dictionary-item',
      'income-expense-type',
      'account-subject',
    ]
    const titles = [
      '产品分类',
      '部门',
      '岗位',
      '计量单位',
      '字典类型',
      '字典项',
      '收支类型',
      '会计科目',
    ]
    const router = createTestRouter()
    const menus = buildMenus(entities.map((entity) => `/aux/${entity}/query`))

    expect(menus).toHaveLength(1)
    expect(menus[0]).toMatchObject({
      domain: 'aux',
      title: '辅助对象',
      order: 15,
    })
    expect(menus[0]?.children.map((item) => item.entity)).toEqual(entities)
    expect(menus[0]?.children.map((item) => item.title)).toEqual(titles)
    expect(registerMenuRoutes(router, menus)).toBe(entities.length)
    for (const entity of entities) {
      expect(hasRegisteredPage('aux', entity)).toBe(true)
      expect(router.resolve(`/aux/${entity}`).meta.developing).toBe(false)
    }
  })

  it('为全部十二类核心原子单据注册独立 VOU 页面', () => {
    const entities = [
      'sale-order',
      'sale-outbound',
      'sale-delivery',
      'sale-signoff',
      'sale-return',
      'purchase-order',
      'purchase-inbound',
      'sales-receipt',
      'purchase-refund',
      'other-receipt',
      'sales-refund',
      'purchase-payment',
      'other-payment',
      'expense-reimbursement',
      'expense-payment',
      'other-income',
    ]

    expect(entities.every((entity) => hasRegisteredPage('vou', entity))).toBe(
      true,
    )
    const menus = buildMenus(entities.map((entity) => `/vou/${entity}/query`))
    expect(menus).toHaveLength(1)
    expect(menus[0]?.title).toBe('业务单据')
    expect(menus[0]?.children.map((item) => item.entity)).toEqual(entities)
    expect(menus[0]?.children.map((item) => item.title)).toEqual([
      '销售订单',
      '销售出库',
      '销售送货',
      '销售签收',
      '销售退货',
      '采购订单',
      '采购入库',
      '销售收款',
      '采购退款',
      '其他往来收款',
      '销售退款',
      '采购付款',
      '其他往来付款',
      '费用报销',
      '费用付款',
      '其他收入',
    ])
    expect(hasRegisteredPage('vou', 'sale-order')).toBe(true)
    expect(hasRegisteredPage('vou', 'customer-order')).toBe(false)
    expect(hasRegisteredPage('vou', 'intermediary-sale-order')).toBe(false)
  })

  it('仅按登录权限生成流程定义、流程实例和各流程类型菜单', () => {
    expect(hasRegisteredPage('wfl', 'intermediary-trade')).toBe(false)
    expect(hasRegisteredPage('wfl', 'sales-fulfillment')).toBe(false)
    expect(hasRegisteredPage('wfl', 'purchase-fulfillment')).toBe(false)
    expect(hasRegisteredPage('wfl', 'process-definition')).toBe(true)
    expect(hasRegisteredPage('wfl', 'process-instance')).toBe(true)
    expect(hasRegisteredPage('vou', 'intermediary-trade')).toBe(false)

    const menus = buildMenus([
      '/wfl/process-definition/query',
      '/wfl/process-instance/query',
      '/wfl/purchase-fulfillment/query',
      '/wfl/sales-fulfillment/query',
      '/vou/purchase-order/query',
    ])

    expect(menus.map((item) => item.domain)).toEqual(['vou', 'wfl'])
    expect(menus[1]).toMatchObject({
      domain: 'wfl',
      title: '业务流程',
      order: 30,
      children: [
        {
          entity: 'process-definition',
          title: '流程定义',
          order: 10,
          actions: ['query'],
        },
        {
          entity: 'process-instance',
          title: '流程实例',
          order: 20,
          actions: ['query'],
        },
        {
          entity: 'purchase-fulfillment',
          title: '采购履约',
          order: Number.MAX_SAFE_INTEGER,
          actions: ['query'],
        },
        {
          entity: 'sales-fulfillment',
          title: '销售履约',
          order: Number.MAX_SAFE_INTEGER,
          actions: ['query'],
        },
      ],
    })

    const router = createTestRouter()
    expect(registerMenuRoutes(router, menus)).toBe(5)
    expect(router.resolve('/wfl/purchase-fulfillment').meta).toMatchObject({
      developing: false,
      processName: 'purchase-fulfillment',
    })
    expect(router.resolve('/wfl/sales-fulfillment').meta).toMatchObject({
      developing: false,
      processName: 'sales-fulfillment',
    })
    expect(router.resolve('/wfl/process-instance').meta).toMatchObject({
      title: '流程实例',
      developing: false,
    })
  })

  it('没有 query 权限的流程专用动作不生成菜单', () => {
    expect(
      buildMenus([
        '/wfl/sales-fulfillment/get',
        '/wfl/custom-flow/get',
      ]),
    ).toEqual([])
  })

  it('注册 ACC 会计账簿页面', () => {
    const router = createTestRouter()
    const menus = buildMenus(['/acc/book/query', '/acc/book/create'])

    expect(menus).toMatchObject([
      {
        domain: 'acc',
        title: '内部会计',
        children: [{ entity: 'book', title: '会计账簿' }],
      },
    ])
    expect(registerMenuRoutes(router, menus)).toBe(1)
    expect(hasRegisteredPage('acc', 'book')).toBe(true)
    expect(router.resolve('/acc/book').meta.developing).toBe(false)
  })

})
