import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import {
  buildMenus,
  buildServerMenus,
  hasRegisteredPage,
  pageRegistry,
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
  it('registers Party maintenance under DCL while retaining the read-only BOB page', () => {
    expect(pageRegistry['dcl/party']?.entityTitle).toBe('主体变更')
    expect(pageRegistry['bob/party']?.entityTitle).toBe('主体')
    expect(hasRegisteredPage('dcl', 'party')).toBe(true)
  })

  it('registers Supplier maintenance under DCL while retaining the current-only BOB page', () => {
    expect(pageRegistry['dcl/supplier']?.entityTitle).toBe('供应商变更')
    expect(pageRegistry['bob/supplier']?.entityTitle).toBe('供应商')
    expect(hasRegisteredPage('dcl', 'supplier')).toBe(true)
  })

  it('registers Customer and Customer Account declarations separately from BOB current pages', () => {
    expect(pageRegistry['dcl/customer']?.entityTitle).toBe('客户变更')
    expect(pageRegistry['dcl/customer-account']?.entityTitle).toBe(
      '客户结算子账户变更',
    )
    expect(pageRegistry['bob/customer']?.entityTitle).toBe('客户')
    expect(pageRegistry['bob/customer-account']?.entityTitle).toBe(
      '客户结算子账户',
    )
  })

  it('DCL 菜单只显示对象名，同时保留页面标题元数据', () => {
    const expected = [
      ['party', '主体', '主体变更'],
      ['operating-entity', '经营主体', '经营主体变更'],
      ['warehouse', '仓库', '仓库变更'],
      ['vehicle', '车辆', '车辆变更'],
      ['fund-account', '资金账户', '资金账户变更'],
      ['employee', '人员', '人员变更'],
      ['other-unit', '其他单位', '其他单位变更'],
      ['sales-partner', '销售合作方', '销售合作方变更'],
      ['customer', '客户', '客户变更'],
      ['customer-account', '客户结算子账户', '客户结算子账户变更'],
      ['supplier', '供应商', '供应商变更'],
      ['product', '产品', '产品变更'],
      ['acc-mapping', '会计映射', '会计映射变更'],
      ['rpt-definition', '报表定义', '报表定义变更'],
      ['wfl-process-definition', '流程定义', '流程定义变更'],
    ] as const
    const menus = buildMenus(expected.map(([entity]) => `/dcl/${entity}/query`))

    expect(menus[0]?.title).toBe('档案变更')
    expect(
      menus[0]?.children.map(({ entity, title }) => [entity, title]),
    ).toEqual(expected.map(([entity, menuTitle]) => [entity, menuTitle]))
    for (const [entity, , pageTitle] of expected) {
      const router = createTestRouter()
      registerMenuRoutes(router, buildMenus([`/dcl/${entity}/query`]))
      expect(router.resolve(`/dcl/${entity}`).meta.title).toBe(pageTitle)
      registerMenuRoutes(router, [])
    }
  })

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

  it('无论服务端排序值如何都将工作台置于所有一级菜单之前', () => {
    const menus = buildServerMenus(
      [
        {
          id: 'group-sales',
          parentId: null,
          type: 'GROUP',
          order: 1,
          displayName: '销售',
          icon: null,
          routeKey: null,
          routePath: null,
        },
        {
          id: 'route-workbench',
          parentId: null,
          type: 'ROUTE',
          order: 999,
          displayName: '工作台',
          icon: null,
          routeKey: 'home/dashboard',
          routePath: '/home/dashboard',
        },
      ],
      [],
    )

    expect(menus[0]?.children[0]?.routeKey).toBe('home/dashboard')
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
        '/dcl/customer/create',
        'bob/customer/update',
        '/BOB/customer/query',
        '/bob/customer',
        null,
      ]),
    ).toEqual(['/bob/customer/query', '/dcl/customer/create'])
    for (const invalidValue of [undefined, null, {}, 'permissions']) {
      expect(normalizePermissions(invalidValue)).toEqual([])
    }
  })

  it('显示所有非 APP 权限实体，并优先使用本地菜单元数据', () => {
    const menus = buildMenus(
      normalizePermissions([
        '/app/user/query',
        '/dcl/customer/create',
        '/dcl/customer/query',
        '/bob/customer/query',
        '/bob/supplier/query',
        '/inv/stock/create',
      ]),
    )

    expect(menus).toEqual([
      {
        domain: 'dcl',
        title: '档案变更',
        icon: 'mdi-file-sign',
        order: 5,
        children: [
          {
            entity: 'customer',
            title: '客户',
            pageTitle: '客户变更',
            icon: 'mdi-account-group',
            order: 48,
            actions: ['create', 'query'],
          },
        ],
      },
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
            actions: ['query'],
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
    expect(buildMenus(['/dcl/customer/create'])).toHaveLength(1)
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
        '/bob/supplier/query',
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
      '/dcl/customer/query',
      '/dcl/customer/create',
      '/dcl/customer-account/query',
      '/bob/customer/query',
      '/bob/customer-account/query',
      '/bob/supplier/query',
      '/aux/unknown/query',
    ])

    expect(hasRegisteredPage('dcl', 'customer')).toBe(true)
    expect(hasRegisteredPage('dcl', 'customer-account')).toBe(true)
    expect(hasRegisteredPage('bob', 'customer')).toBe(true)
    expect(hasRegisteredPage('bob', 'customer-account')).toBe(true)
    expect(hasRegisteredPage('bob', 'supplier')).toBe(true)
    expect(registerMenuRoutes(router, menus)).toBe(6)
    expect(router.hasRoute('page:dcl/customer')).toBe(true)
    expect(router.hasRoute('page:dcl/customer-account')).toBe(true)
    expect(router.hasRoute('page:bob/customer')).toBe(true)
    expect(router.hasRoute('page:bob/supplier')).toBe(true)
    expect(router.resolve('/dcl/customer').meta.actions).toEqual([
      'query',
      'create',
    ])
    expect(router.resolve('/dcl/customer').meta.developing).toBe(false)
    expect(router.resolve('/dcl/customer-account').meta.actions).toEqual([
      'query',
    ])
    expect(router.resolve('/bob/customer').meta.actions).toEqual(['query'])
    expect(router.resolve('/bob/customer-account').meta.actions).toEqual([
      'query',
    ])
    expect(router.resolve('/bob/supplier').meta.actions).toEqual(['query'])
    expect(router.resolve('/bob/supplier').meta.developing).toBe(false)
    expect(router.hasRoute('page:aux/unknown')).toBe(true)
    expect(router.resolve('/aux/unknown').meta.actions).toEqual(['query'])
    expect(router.resolve('/aux/unknown').meta.developing).toBe(true)
    expect(resolveFirstMenuPath(menus)).toBe('/dcl/customer')

    expect(registerMenuRoutes(router, [])).toBe(0)
    expect(router.hasRoute('page:dcl/customer')).toBe(false)
    expect(router.hasRoute('page:dcl/customer-account')).toBe(false)
    expect(router.hasRoute('page:bob/customer')).toBe(false)
    expect(router.hasRoute('page:bob/customer-account')).toBe(false)
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
      '产品（当前有效资料）',
      '仓库',
      '车辆',
      '资金账户（当前有效资料）',
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

  it('为 DCL 变更和 BOB 当前有效资料注册独立产品、经营主体、仓库与车辆入口', () => {
    const router = createTestRouter()
    const menus = buildMenus([
      '/dcl/operating-entity/query',
      '/dcl/operating-entity/create',
      '/dcl/warehouse/query',
      '/dcl/warehouse/create',
      '/dcl/vehicle/query',
      '/dcl/vehicle/create',
      '/dcl/product/query',
      '/dcl/product/create',
      '/bob/operating-entity/query',
      '/bob/operating-entity/get',
      '/bob/warehouse/query',
      '/bob/warehouse/get',
      '/bob/vehicle/query',
      '/bob/vehicle/get',
      '/bob/product/query',
      '/bob/product/get',
    ])

    expect(menus.map((domain) => domain.domain)).toEqual(['dcl', 'bob'])
    expect(menus[0]).toMatchObject({
      title: '档案变更',
      children: [
        {
          entity: 'operating-entity',
          title: '经营主体',
          actions: ['query', 'create'],
        },
        {
          entity: 'warehouse',
          title: '仓库',
          actions: ['query', 'create'],
        },
        {
          entity: 'vehicle',
          title: '车辆',
          actions: ['query', 'create'],
        },
        {
          entity: 'product',
          title: '产品',
          actions: ['query', 'create'],
        },
      ],
    })
    expect(menus[1]).toMatchObject({
      title: '业务对象',
      children: [
        {
          entity: 'product',
          title: '产品（当前有效资料）',
          actions: ['query', 'get'],
        },
        {
          entity: 'warehouse',
          title: '仓库',
          actions: ['query', 'get'],
        },
        {
          entity: 'vehicle',
          title: '车辆',
          actions: ['query', 'get'],
        },
        {
          entity: 'operating-entity',
          title: '经营主体',
          actions: ['query', 'get'],
        },
      ],
    })

    expect(registerMenuRoutes(router, menus)).toBe(8)
    expect(hasRegisteredPage('dcl', 'product')).toBe(true)
    expect(hasRegisteredPage('bob', 'product')).toBe(true)
    expect(hasRegisteredPage('dcl', 'operating-entity')).toBe(true)
    expect(hasRegisteredPage('bob', 'operating-entity')).toBe(true)
    expect(hasRegisteredPage('dcl', 'warehouse')).toBe(true)
    expect(hasRegisteredPage('bob', 'warehouse')).toBe(true)
    expect(hasRegisteredPage('dcl', 'vehicle')).toBe(true)
    expect(hasRegisteredPage('bob', 'vehicle')).toBe(true)
    expect(router.resolve('/dcl/operating-entity').meta).toMatchObject({
      developing: false,
      title: '经营主体变更',
      actions: ['query', 'create'],
    })
    expect(router.resolve('/bob/operating-entity').meta).toMatchObject({
      developing: false,
      title: '经营主体',
      actions: ['query', 'get'],
    })
    expect(router.resolve('/dcl/warehouse').meta).toMatchObject({
      developing: false,
      title: '仓库变更',
      actions: ['query', 'create'],
    })
    expect(router.resolve('/bob/warehouse').meta).toMatchObject({
      developing: false,
      title: '仓库',
      actions: ['query', 'get'],
    })
    expect(router.resolve('/dcl/vehicle').meta).toMatchObject({
      developing: false,
      title: '车辆变更',
      actions: ['query', 'create'],
    })
    expect(router.resolve('/bob/vehicle').meta).toMatchObject({
      developing: false,
      title: '车辆',
      actions: ['query', 'get'],
    })
    expect(router.resolve('/dcl/product').meta).toMatchObject({
      developing: false,
      title: '产品变更',
      actions: ['query', 'create'],
    })
    expect(router.resolve('/bob/product').meta).toMatchObject({
      developing: false,
      title: '产品（当前有效资料）',
      actions: ['query', 'get'],
    })

    registerMenuRoutes(router, [])
  })

  it('权限动作变化时更新已有动态路由的元数据', () => {
    const router = createTestRouter()

    expect(
      registerMenuRoutes(router, buildMenus(['/dcl/customer/query'])),
    ).toBe(1)
    expect(router.resolve('/dcl/customer').meta.actions).toEqual(['query'])

    expect(
      registerMenuRoutes(
        router,
        buildMenus(['/dcl/customer/create', '/dcl/customer/save']),
      ),
    ).toBe(1)
    expect(router.resolve('/dcl/customer').meta.actions).toEqual([
      'create',
      'save',
    ])
    expect(
      registerMenuRoutes(
        router,
        buildMenus(['/dcl/customer/create', '/dcl/customer/save']),
      ),
    ).toBe(0)

    registerMenuRoutes(router, [])
  })

  it('为全部十二类 AUX 实体生成中文菜单并加载真实页面组件', () => {
    const entities = [
      'settlement-method',
      'payment-method',
      'asset-category',
      'product-category',
      'product-type',
      'department',
      'employee-category',
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
      '人员类别',
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
  it('keeps execution routes in RPT and definition maintenance in DCL', () => {
    const router = createTestRouter()
    const menus = buildMenus([
      '/rpt/account-journal/query',
      '/rpt/account-balance/export',
      '/dcl/rpt-definition/create',
    ])

    expect(menus).toMatchObject([
      {
        domain: 'dcl',
        children: [
          { entity: 'rpt-definition', title: '报表定义', actions: ['create'] },
        ],
      },
      {
        domain: 'rpt',
        title: '报表',
        children: [
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
    expect(router.resolve('/dcl/rpt-definition').meta).toMatchObject({
      developing: false,
      title: '报表定义变更',
      actions: ['create'],
    })
    expect(router.resolve('/rpt/definition').name).toBe('not-found')
    expect(router.hasRoute('page:rpt/report-center')).toBe(false)
  })
})
