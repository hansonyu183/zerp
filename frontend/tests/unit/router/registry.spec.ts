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
  it('不将 APP 管理页面作为动态菜单路由注册', () => {
    const router = createTestRouter()

    expect(
      registerMenuRoutes(router, [
        {
          domain: 'app',
          title: '系统管理',
          order: 1,
          children: [
            {
              entity: 'permission',
              routeKey: 'app/permission',
              routePath: '/app/permission',
              title: '权限管理',
              order: 1,
              actions: ['query'],
            },
          ],
        },
      ]),
    ).toBe(0)
    expect(router.hasRoute('page:app/permission')).toBe(false)
  })

  it('将服务端一级工作台路由投影为唯一的直接导航入口', () => {
    const menus = buildServerMenus(
      [
        {
          id: 'route-workbench',
          parentId: null,
          type: 'ROUTE',
          order: 10,
          displayName: '工作台',
          icon: 'mdi-view-dashboard-outline',
          routeKey: 'home/dashboard',
          routePath: '/home/dashboard',
        },
        {
          id: 'group-sales',
          parentId: null,
          type: 'GROUP',
          order: 20,
          displayName: '销售',
          icon: null,
          routeKey: null,
          routePath: null,
        },
      ],
      [],
    )

    expect(menus).toHaveLength(2)
    expect(menus[0]).toMatchObject({
      title: '工作台',
      children: [{ routeKey: 'home/dashboard', routePath: '/home/dashboard' }],
    })
    expect(menus[0]?.children).toHaveLength(1)
  })

  it('系统默认菜单保留本地注册名称，业务模板保留管理员名称', () => {
    const route = {
      id: 'route-other-unit',
      parentId: 'default-bob',
      type: 'ROUTE' as const,
      order: 10,
      displayName: '客户',
      icon: null,
      routeKey: 'bob/other-unit',
      routePath: '/bob/other-unit',
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
      ['/bob/other-unit/query'],
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
      ['/bob/other-unit/query'],
    )

    expect(defaultMenu[0]?.children[0]?.title).toBe('其他单位')
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

  it('为 BOB 主体和其他单位加载独立页面并移除旧入口', () => {
    const entities = [
      'party',
      'customer',
      'supplier',
      'other-unit',
      'sales-partner',
      'employee',
      'product',
      'warehouse',
      'vehicle',
      'fund-account',
      'operating-entity',
    ]
    const titles = [
      '主体',
      '客户',
      '供应商',
      '其他单位',
      '销售合作方',
      '员工',
      '产品',
      '仓库',
      '车辆',
      '资金账户',
      '经营主体',
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
    expect(hasRegisteredPage('bob', 'other-party')).toBe(false)
    expect(hasRegisteredPage('bob', 'service')).toBe(false)

    registerMenuRoutes(router, [])
  })

  it('为 DCL 申报和 BOB 当前档案注册独立经营主体入口', () => {
    const router = createTestRouter()
    const menus = buildMenus([
      '/dcl/operating-entity/query',
      '/dcl/operating-entity/create',
      '/bob/operating-entity/query',
      '/bob/operating-entity/get',
    ])

    expect(menus.map((domain) => domain.domain)).toEqual(['dcl', 'bob'])
    expect(menus[0]).toMatchObject({
      title: '申报控制',
      children: [
        {
          entity: 'operating-entity',
          title: '经营主体申报',
          actions: ['query', 'create'],
        },
      ],
    })
    expect(menus[1]).toMatchObject({
      title: '业务对象',
      children: [
        {
          entity: 'operating-entity',
          title: '经营主体',
          actions: ['query', 'get'],
        },
      ],
    })

    expect(registerMenuRoutes(router, menus)).toBe(2)
    expect(hasRegisteredPage('dcl', 'operating-entity')).toBe(true)
    expect(hasRegisteredPage('bob', 'operating-entity')).toBe(true)
    expect(router.resolve('/dcl/operating-entity').meta).toMatchObject({
      developing: false,
      title: '经营主体申报',
      actions: ['query', 'create'],
    })
    expect(router.resolve('/bob/operating-entity').meta).toMatchObject({
      developing: false,
      title: '经营主体',
      actions: ['query', 'get'],
    })

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

  it('为全部十一类 AUX 实体生成中文菜单并加载真实页面组件', () => {
    const entities = [
      'settlement-method',
      'payment-method',
      'asset-category',
      'product-category',
      'product-type',
      'department',
      'position',
      'measurement-unit',
      'dictionary-type',
      'dictionary-item',
      'income-expense-type',
    ]
    const titles = [
      '结算方式',
      '收款方式',
      '资产类别',
      '产品分类',
      '产品类型',
      '部门',
      '岗位',
      '计量单位',
      '字典类型',
      '字典项',
      '收支类型',
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
      buildMenus(['/wfl/sales-fulfillment/get', '/wfl/custom-flow/get']),
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

describe('RPT dynamic routes', () => {
  it('registers each authorized report with the shared report page and keeps definition management separate', () => {
    const router = createTestRouter()
    const menus = buildMenus([
      '/rpt/account-journal/query',
      '/rpt/account-balance/export',
      '/rpt/definition/create',
    ])

    expect(menus).toMatchObject([
      {
        domain: 'rpt',
        title: '报表',
        children: [
          { entity: 'definition', title: '报表定义管理', actions: ['create'] },
          { entity: 'account-balance', actions: ['export'] },
          { entity: 'account-journal', actions: ['query'] },
        ],
      },
    ])
    expect(registerMenuRoutes(router, menus)).toBe(3)
    expect(router.resolve('/rpt/account-journal').meta).toMatchObject({
      developing: false,
      reportCode: 'account-journal',
      actions: ['query'],
    })
    expect(router.resolve('/rpt/account-balance').meta).toMatchObject({
      developing: false,
      reportCode: 'account-balance',
      actions: ['export'],
    })
    expect(router.resolve('/rpt/definition').meta).toMatchObject({
      developing: false,
      title: '报表定义管理',
      actions: ['create'],
    })
    expect(router.hasRoute('page:rpt/report-center')).toBe(false)
  })
})
