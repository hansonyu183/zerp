import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { apiClient } from '@/api/client'
import Dashboard from '@/pages/home/dashboard/Dashboard.vue'
import {
  type WorkbenchItem,
  useDashboardViewModel,
} from '@/pages/home/dashboard/vm'

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

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
    await router.push('/home/dashboard')

    const wrapper = mount(Dashboard, {
      global: {
        plugins: [router],
        stubs: {
          BusinessObjectList: {
            name: 'BusinessObjectList',
            props: ['columns'],
            template: '<section class="list-stub" />',
          },
          VoucherList: {
            name: 'VoucherList',
            props: ['filterable', 'showEntity', 'sortable'],
            template: '<section class="voucher-list-stub" />',
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
          VTextarea: true,
        },
      },
    })

    await flushPromises()
    expect(wrapper.text()).toContain('待处理资料')
    expect(wrapper.text()).toContain('待处理单据')
    expect(wrapper.text()).not.toContain('集中处理')
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
      filterable: false,
      showEntity: true,
      sortable: false,
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
})
