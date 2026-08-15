import { effectScope } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import Dashboard from '@/pages/home/dashboard/Dashboard.vue'
import {
  type WorkbenchItem,
  useDashboardViewModel,
} from '@/pages/home/dashboard/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => {
  const post = vi.fn()
  return { apiClient: { post, postContract: post } }
})

const mockedPost = vi.mocked(apiClient.post)

const objectItem: WorkbenchItem = {
  category: 'BOB',
  entity: 'customer',
  status: 'DRAFT',
  pendingStage: 'CHECK',
  availableActions: ['view', 'edit', 'submit'],
  updatedAt: '2026-08-01T08:00:00Z',
  objectId: 'object-1',
  objectRevision: 3,
  versionId: 'version-1',
  revision: 5,
  code: 'CUS-0001',
  name: '测试客户',
}

const documentItem: WorkbenchItem = {
  category: 'VOU',
  entity: 'sale-order',
  status: 'DRAFT',
  pendingStage: 'CHECK',
  availableActions: ['view', 'edit', 'check'],
  updatedAt: '2026-08-01T08:00:00Z',
  documentId: 'document-1',
  revision: 2,
  documentNo: 'SO-0001',
  businessDate: '2026-08-01',
  partyName: '测试客户',
  currency: 'CNY',
  amount: '100.00',
}

function page(items: WorkbenchItem[] = []) {
  return { data: { items, total: items.length, page: 1, pageSize: 20 } }
}

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/home/dashboard', component: Dashboard },
      { path: '/bob/customer', component: { template: '<div />' } },
    ],
  })
}

beforeEach(() => {
  mockedPost.mockReset()
  mockedPost.mockResolvedValue(page())
})

describe('Dashboard workbench', () => {
  it('初始查询失败时不显示空状态', async () => {
    mockedPost.mockRejectedValueOnce(new Error('network unavailable'))
    const router = createTestRouter()
    const wrapper = mount(Dashboard, {
      global: {
        plugins: [router, createPinia()],
        stubs: {
          BusinessObjectList: {
            name: 'BusinessObjectList',
            props: ['emptyText', 'rows'],
            template:
              '<section><span v-if="!rows.length">{{ emptyText }}</span></section>',
          },
          VoucherList: {
            name: 'VoucherList',
            props: ['emptyText', 'rows'],
            template:
              '<section><span v-if="!rows.length">{{ emptyText }}</span></section>',
          },
          VAlert: {
            template:
              '<section class="error-alert"><slot /><slot name="append" /></section>',
          },
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('.error-alert').exists()).toBe(true)
    expect(wrapper.text()).toContain('重试查询')
    expect(wrapper.text()).not.toContain('暂无待办单据')
  })

  it('业务菜单隐藏时仍按权限和页面注册表提供待办实体筛选', async () => {
    mockedPost.mockResolvedValue(
      page([{ ...documentItem, entity: 'runtime-voucher' }]),
    )
    const router = createTestRouter()
    const pinia = createPinia()
    const session = useSessionStore(pinia)
    session.permissions = [
      '/bob/customer/query',
      '/bob/customer/submit',
      '/bob/supplier/query',
      '/bob/supplier/unsubmit',
      '/vou/sale-order/query',
      '/vou/sale-order/check',
      '/vou/developing-invoice/query',
      '/vou/developing-invoice/uncheck',
    ]
    const navigation = {
      revision: 1,
      items: [
        {
          id: 'business',
          parentId: null,
          type: 'GROUP' as const,
          level: 1,
          order: 10,
          displayName: '业务',
          icon: null,
          enabled: true,
          routeKey: null,
          routePath: null,
          permissionCode: null,
        },
        {
          id: 'customer',
          parentId: 'business',
          type: 'ROUTE' as const,
          level: 2,
          order: 10,
          displayName: '客户',
          icon: null,
          enabled: true,
          routeKey: 'bob/customer',
          routePath: '/bob/customer',
          permissionCode: '/bob/customer/query',
        },
        {
          id: 'sale-order',
          parentId: 'business',
          type: 'ROUTE' as const,
          level: 2,
          order: 20,
          displayName: '销售订单',
          icon: null,
          enabled: true,
          routeKey: 'vou/sale-order',
          routePath: '/vou/sale-order',
          permissionCode: '/vou/sale-order/query',
        },
      ],
    }
    session.applyMenuData({
      mode: 'DEFAULT',
      modeRevision: 1,
      catalogRevision: 'catalog-revision',
      defaultMenu: navigation,
      businessTemplate: navigation,
      navigation,
      availableRoutes: [],
    })
    await router.push('/home/dashboard')

    const wrapper = mount(Dashboard, {
      global: {
        plugins: [router, pinia],
        stubs: {
          BusinessObjectList: {
            name: 'BusinessObjectList',
            props: ['columns'],
            template:
              '<section class="list-stub"><slot name="filters" /></section>',
          },
          VoucherList: {
            name: 'VoucherList',
            props: ['filterable', 'showEntity', 'sortable'],
            template:
              '<section class="voucher-list-stub"><slot name="filters" /></section>',
          },
          AppSnackbar: true,
          ListRowActions: true,
          VAlert: { template: '<section><slot /><slot name="append" /></section>' },
          VBtn: true,
          VCard: { template: '<section><slot /></section>' },
          VCardActions: true,
          VCardText: true,
          VChip: true,
          VContainer: { template: '<main><slot /></main>' },
          VDialog: true,
          VDivider: true,
          VIcon: true,
          VSpacer: true,
          VTab: { template: '<button><slot /></button>' },
          VTabs: {
            name: 'VTabs',
            emits: ['update:modelValue'],
            template: '<nav><slot /></nav>',
          },
          VSelect: {
            name: 'VSelect',
            props: ['label', 'items', 'modelValue'],
            template: '<label>{{ label }}</label>',
          },
          VTextarea: true,
        },
      },
    })

    await flushPromises()
    expect(wrapper.text()).toContain('待办单据')
    expect(wrapper.text()).toContain('待办资料')
    expect(wrapper.text().indexOf('待办单据')).toBeLessThan(
      wrapper.text().indexOf('待办资料'),
    )
    expect(wrapper.text()).not.toContain('集中处理')
    expect(wrapper.text()).toContain('类型')
    expect(wrapper.text()).toContain('待办状态')
    expect(wrapper.findAll('nav button').map((tab) => tab.text())).toEqual([
      '待办单据',
      '待办资料',
    ])
    expect(
      wrapper.findAllComponents({ name: 'VSelect' })[0]?.props('items'),
    ).toEqual([
      { title: '销售订单', value: 'sale-order' },
      { title: '开发中：Developing Invoice', value: 'developing-invoice' },
      { title: '开发中：runtime voucher', value: 'runtime-voucher' },
    ])
    session.applyMenuData({
      mode: 'DEFAULT',
      modeRevision: 2,
      catalogRevision: 'catalog-revision',
      defaultMenu: { ...navigation, items: [] },
      businessTemplate: { ...navigation, items: [] },
      navigation: { ...navigation, items: [] },
      availableRoutes: [],
    })
    await flushPromises()
    expect(
      wrapper.findAllComponents({ name: 'VSelect' })[0]?.props('items'),
    ).toEqual([
      { title: '销售订单', value: 'sale-order' },
      { title: '开发中：Developing Invoice', value: 'developing-invoice' },
      { title: '开发中：runtime voucher', value: 'runtime-voucher' },
    ])
    expect(wrapper.findComponent({ name: 'VoucherList' }).exists()).toBe(true)
    expect(mockedPost).toHaveBeenCalledWith('app/workbench/query', {
      category: 'VOU',
      page: 1,
      pageSize: 20,
    })

    mockedPost.mockResolvedValueOnce(page([objectItem]))
    wrapper
      .findComponent({ name: 'VTabs' })
      .vm.$emit('update:modelValue', 'BOB')
    await flushPromises()
    expect(mockedPost).toHaveBeenLastCalledWith('app/workbench/query', {
      category: 'BOB',
      page: 1,
      pageSize: 20,
    })
    expect(wrapper.findComponent({ name: 'BusinessObjectList' }).exists()).toBe(
      true,
    )
    expect(
      wrapper
        .findComponent({ name: 'BusinessObjectList' })
        .props('columns')
        .map((column: { label: string }) => column.label),
    ).toEqual(['类型', '编码', '名称', '状态'])
    expect(
      wrapper.findAllComponents({ name: 'VSelect' })[0]?.props('items'),
    ).toEqual([
      { title: '客户', value: 'customer' },
      { title: '供应商', value: 'supplier' },
    ])
  })

  it('按类型和待办状态进行服务端筛选并可重置', async () => {
    const vm = useDashboardViewModel()
    vm.activeCategory.value = 'BOB'
    vm.states.BOB.keyword = ' 客户 '
    vm.states.BOB.entities = ['customer']
    vm.states.BOB.pendingStages = ['APPROVE']

    await vm.applyFilters('BOB')

    expect(mockedPost).toHaveBeenLastCalledWith('app/workbench/query', {
      category: 'BOB',
      keyword: '客户',
      entities: ['customer'],
      pendingStages: ['APPROVE'],
      page: 1,
      pageSize: 20,
    })

    await vm.resetFilters()
    expect(vm.states.BOB).toMatchObject({
      keyword: '',
      entities: [],
      pendingStages: [],
      page: 1,
    })
    expect(mockedPost).toHaveBeenLastCalledWith('app/workbench/query', {
      category: 'BOB',
      page: 1,
      pageSize: 20,
    })
  })

  it('每次切换页签都用各自已应用的筛选条件刷新', async () => {
    const vm = useDashboardViewModel()
    vm.states.VOU.keyword = '销售'
    await vm.applyFilters('VOU')
    vm.states.BOB.keyword = '客户'
    await vm.applyFilters('BOB')

    await vm.selectCategory('VOU')
    await vm.selectCategory('BOB')

    expect(mockedPost).toHaveBeenNthCalledWith(3, 'app/workbench/query', {
      category: 'VOU',
      keyword: '销售',
      page: 1,
      pageSize: 20,
    })
    expect(mockedPost).toHaveBeenNthCalledWith(4, 'app/workbench/query', {
      category: 'BOB',
      keyword: '客户',
      page: 1,
      pageSize: 20,
    })
  })

  it('查询失败保留输入并以当前已应用条件重试', async () => {
    mockedPost.mockRejectedValueOnce(new Error('network unavailable'))
    const vm = useDashboardViewModel()
    vm.states.BOB.keyword = ' 客户 '
    vm.states.BOB.entities = ['customer']

    await expect(vm.applyFilters('BOB')).resolves.toBe(false)
    expect(vm.states.BOB).toMatchObject({
      keyword: ' 客户 ',
      appliedKeyword: '客户',
      entities: ['customer'],
      appliedEntities: ['customer'],
    })
    expect(vm.states.BOB.errorMessage).toBeTruthy()

    await vm.query('BOB')
    expect(mockedPost).toHaveBeenLastCalledWith('app/workbench/query', {
      category: 'BOB',
      keyword: '客户',
      entities: ['customer'],
      page: 1,
      pageSize: 20,
    })
  })

  it('忽略较早的慢响应，并且至多纠正一次失效页码', async () => {
    let resolveOld: ((value: ReturnType<typeof page>) => void) | undefined
    let resolveNew: ((value: ReturnType<typeof page>) => void) | undefined
    mockedPost
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve
          }),
      )
    const vm = useDashboardViewModel()
    vm.states.VOU.keyword = '旧条件'
    const oldQuery = vm.applyFilters('VOU')
    vm.states.VOU.keyword = '新条件'
    const newQuery = vm.applyFilters('VOU')

    resolveNew?.(page([documentItem]))
    await newQuery
    resolveOld?.(page([{ ...documentItem, documentNo: 'OLD-0001' }]))
    await oldQuery

    expect(vm.states.VOU.rows).toEqual([documentItem])

    vm.states.VOU.page = 3
    mockedPost
      .mockResolvedValueOnce(
        { data: { items: [], total: 21, page: 3, pageSize: 20 } },
      )
      .mockResolvedValueOnce({
        data: { items: [documentItem], total: 21, page: 2, pageSize: 20 },
      })
    await vm.query('VOU')

    expect(vm.states.VOU.page).toBe(2)
    expect(mockedPost).toHaveBeenLastCalledWith('app/workbench/query', {
      category: 'VOU',
      keyword: '新条件',
      page: 2,
      pageSize: 20,
    })
    expect(mockedPost).toHaveBeenCalledTimes(4)
  })

  it('组件销毁后忽略迟到的工作台响应', async () => {
    let resolveQuery: ((value: ReturnType<typeof page>) => void) | undefined
    mockedPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve
        }),
    )
    const scope = effectScope()
    const vm = scope.run(() => useDashboardViewModel())
    if (!vm) throw new Error('view model scope was not created')
    vm.states.VOU.rows = [documentItem]

    const pending = vm.query('VOU')
    scope.stop()
    resolveQuery?.(page())
    await pending

    expect(vm.states.VOU.rows).toEqual([documentItem])
  })

  it('撤回提交与反核对只调用服务器返回的动作，并在完成后刷新', async () => {
    const submitted = {
      ...objectItem,
      status: 'PENDING' as const,
      pendingStage: 'APPROVE' as const,
      availableActions: ['unsubmit'] as const,
    }
    const checked = {
      ...documentItem,
      status: 'CHECKED' as const,
      pendingStage: 'APPROVE' as const,
      availableActions: ['uncheck'] as const,
    }
    mockedPost
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(page())
    const vm = useDashboardViewModel()

    await expect(vm.runAction(submitted, 'unsubmit', '  资料有误  ')).resolves.toBe(
      true,
    )
    await expect(vm.runAction(checked, 'uncheck')).resolves.toBe(true)

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'bob/customer/unsubmit', {
      objectId: 'object-1',
      objectRevision: 3,
      versionId: 'version-1',
      revision: 5,
      reason: '资料有误',
    })
    expect(mockedPost).toHaveBeenNthCalledWith(3, 'vou/sale-order/uncheck', {
      documentId: 'document-1',
      revision: 2,
    })
    expect(await vm.runAction(submitted, 'unsubmit', '   ')).toBe(false)
    expect(await vm.runAction(objectItem, 'unsubmit', '不可执行')).toBe(false)
    expect(mockedPost).toHaveBeenCalledTimes(4)
  })

  it('动作后由刷新结果决定是否纠正当前页', async () => {
    const pageTwo = {
      data: { items: [documentItem], total: 21, page: 2, pageSize: 20 },
    }
    mockedPost
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(pageTwo)
    const vm = useDashboardViewModel()
    vm.states.VOU.page = 2
    vm.states.VOU.rows = [documentItem]

    expect(await vm.runAction(documentItem, 'check')).toBe(true)

    expect(vm.states.VOU.page).toBe(2)
    expect(mockedPost).toHaveBeenLastCalledWith('app/workbench/query', {
      category: 'VOU',
      page: 2,
      pageSize: 20,
    })
  })

  it('使用列表携带的 revision 直接提交资料并刷新列表', async () => {
    mockedPost
      .mockResolvedValueOnce(page([objectItem]))
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce(page())
    const vm = useDashboardViewModel()

    await vm.query('BOB')
    const success = await vm.runAction(objectItem, 'submit')

    expect(success).toBe(true)
    expect(mockedPost).toHaveBeenNthCalledWith(2, 'bob/customer/submit', {
      objectId: 'object-1',
      versionId: 'version-1',
      revision: 5,
    })
    expect(vm.states.BOB.rows).toEqual([])
  })

  it('驳回资料时提交去除首尾空白的意见', async () => {
    const pending = {
      ...objectItem,
      status: 'PENDING' as const,
      pendingStage: 'APPROVE' as const,
      availableActions: ['view', 'approve', 'reject'] as const,
    }
    mockedPost.mockResolvedValueOnce({ data: {} }).mockResolvedValueOnce(page())
    const vm = useDashboardViewModel()

    await vm.runAction(pending, 'reject', '  信息不完整  ')

    expect(mockedPost).toHaveBeenNthCalledWith(1, 'bob/customer/reject', {
      objectId: 'object-1',
      versionId: 'version-1',
      revision: 5,
      comment: '信息不完整',
    })
  })

  it('批准人与提交人相同时显示明确失败原因', async () => {
    const pending = {
      ...objectItem,
      status: 'PENDING' as const,
      pendingStage: 'APPROVE' as const,
      availableActions: ['view', 'approve', 'reject'] as const,
    }
    mockedPost
      .mockRejectedValueOnce(
        new ApiError('business', 'submitter cannot review the same version', {
          code: 3001,
        }),
      )
      .mockResolvedValueOnce(page([pending]))
    const vm = useDashboardViewModel()

    const success = await vm.runAction(pending, 'approve')

    expect(success).toBe(false)
    expect(vm.states.BOB.errorMessage).toBe(
      '提交人与审核人不能为同一人，请由其他有审批权限的用户处理。（错误码：3001）',
    )
  })

  it('单据核对失败时保留操作并显示具体业务原因', async () => {
    const delivery = {
      ...documentItem,
      entity: 'sale-delivery' as const,
      documentNo: 'SDL-20260715-0001',
    }
    mockedPost
      .mockRejectedValueOnce(
        new ApiError(
          'business',
          'generated sales draft is missing required business data',
          { code: 2001 },
        ),
      )
      .mockResolvedValueOnce(page([delivery]))
    const vm = useDashboardViewModel()

    const success = await vm.runAction(delivery, 'check')

    expect(success).toBe(false)
    expect(delivery.availableActions).toContain('check')
    expect(vm.states.VOU.errorMessage).toBe(
      '自动生成的销售单据缺少必填业务资料，请先编辑补全并保存后再核对。（错误码：2001）',
    )
  })
})
