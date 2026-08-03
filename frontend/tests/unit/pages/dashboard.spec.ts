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
  it('显示两个待处理 Tab 并按需查询对应类别', async () => {
    const router = createTestRouter()
    const pinia = createPinia()
    useSessionStore(pinia).permissions = [
      '/bob/customer/query',
      '/bob/customer/submit',
      '/vou/sale-order/query',
      '/vou/sale-order/check',
    ]
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
    expect(wrapper.text()).toContain('待处理资料')
    expect(wrapper.text()).toContain('待处理单据')
    expect(wrapper.text()).not.toContain('集中处理')
    expect(wrapper.text()).toContain('类型')
    expect(wrapper.text()).toContain('待办状态')
    expect(
      wrapper.findAllComponents({ name: 'VSelect' })[0]?.props('items'),
    ).toEqual([{ title: '客户', value: 'customer' }])
    expect(wrapper.findComponent({ name: 'BusinessObjectList' }).exists()).toBe(
      true,
    )
    expect(
      wrapper
        .findComponent({ name: 'BusinessObjectList' })
        .props('columns')
        .map((column: { label: string }) => column.label),
    ).toEqual(['类型', '编码', '名称', '状态'])
    expect(mockedPost).toHaveBeenCalledWith('app/workbench/query', {
      category: 'BOB',
      page: 1,
      pageSize: 20,
    })

    mockedPost.mockResolvedValueOnce(page([documentItem]))
    wrapper
      .findComponent({ name: 'VTabs' })
      .vm.$emit('update:modelValue', 'VOU')
    await flushPromises()
    expect(mockedPost).toHaveBeenLastCalledWith('app/workbench/query', {
      category: 'VOU',
      page: 1,
      pageSize: 20,
    })
    expect(wrapper.findComponent({ name: 'VoucherList' }).exists()).toBe(true)
    expect(
      wrapper.findComponent({ name: 'VoucherList' }).props(),
    ).toMatchObject({
      filterable: true,
      showEntity: true,
      sortable: false,
    })
    expect(
      wrapper.findAllComponents({ name: 'VSelect' })[0]?.props('items'),
    ).toEqual([{ title: '销售订单', value: 'sale-order' }])
  })

  it('按类型和待办状态进行服务端筛选并可重置', async () => {
    const vm = useDashboardViewModel()
    vm.states.BOB.keyword = ' 客户 '
    vm.states.BOB.entities = ['customer']
    vm.states.BOB.pendingStages = ['APPROVE']

    await vm.query('BOB', true)

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
      '提交人与审核人不能为同一人，请由其他有审批权限的用户处理。',
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
      '自动生成的销售单据缺少必填业务资料，请先编辑补全并保存后再核对。',
    )
  })
})
