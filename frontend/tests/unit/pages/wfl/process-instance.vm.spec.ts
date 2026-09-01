import { defineComponent, h, type ComponentPublicInstance } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  useProcessInstanceViewModel,
  type InstanceListItem,
  type InstanceView,
} from '@/pages/wfl/process-instance/vm'
import { useSessionStore } from '@/stores/session'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { processName: 'expense-flow' } }),
  useRouter: () => ({ push }),
}))
vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn(), setCsrfToken: vi.fn() },
}))
const mockedPost = vi.mocked(apiClient.postContract)
const mockedPostContract = vi.mocked(apiClient.postContract)
const item: InstanceListItem = {
  processId: '01J00000000000000000000001',
  definitionId: '01J00000000000000000000002',
  approvalEntryId: '01J00000000000000000000009',
  definitionCode: 'expense-flow',
  definitionName: '费用流程',
  revision: 2,
  rootDocumentId: '01J00000000000000000000003',
  rootDocumentNo: 'ER-001',
  rootEntity: 'expense-reimbursement',
  updatedAt: '2026-08-08T00:00:00Z',
}
const detail = (): InstanceView => ({
  ...item,
  startedDefinitionRevision: 2,
  nodes: [
    {
      nodeInstanceId: '01J00000000000000000000004',
      nodeKey: 'root',
      nodeName: '费用报销',
      documentId: item.rootDocumentId,
      documentNo: item.rootDocumentNo,
      documentEntity: item.rootEntity,
      documentStatus: 'APPROVED',
      documentRevision: 1,
      businessDate: '2026-08-08',
      trigger: 'APPROVED',
    },
  ],
  availableTargets: [
    {
      parentNodeInstanceId: '01J00000000000000000000004',
      targetNodeKey: 'payment',
      targetNodeName: '费用付款',
      targetEntity: 'expense-payment',
      relation: '报销付款',
    },
  ],
})

async function mountViewModel(): Promise<{
  vm: ReturnType<typeof useProcessInstanceViewModel>
  wrapper: VueWrapper<ComponentPublicInstance>
}> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSessionStore().permissions = [
    '/wfl/expense-flow/query',
    '/wfl/expense-flow/get',
    '/wfl/expense-flow/create-child',
  ]
  let vm: ReturnType<typeof useProcessInstanceViewModel> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        vm = useProcessInstanceViewModel()
        return () => h('div')
      },
    }),
    { global: { plugins: [pinia] } },
  )
  await flushPromises()
  return { vm: vm!, wrapper }
}

describe('process instance view model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPostContract.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
      requestId: '',
    } as never)
    mockedPost.mockImplementation(async (path) => {
      if (path === 'wfl/expense-flow/get') return { data: detail() }
      throw new Error(`unexpected API path: ${path}`)
    })
  })

  it('uses available targets from the actual instance response and sends dynamic create-child input', async () => {
    mockedPost.mockImplementation(async (path, body) => {
      if (path === 'wfl/expense-flow/get') return { data: detail() }
      if (path === 'wfl/expense-flow/create-child') {
        expect(body).toEqual({
          processId: item.processId,
          parentNodeInstanceId: '01J00000000000000000000004',
          targetNodeKey: 'payment',
          requestKey: 'retry-key-0000001',
        })
        return { data: { nodeInstanceId: '01J00000000000000000000005' } }
      }
      throw new Error(`unexpected API path: ${path}`)
    })
    const { vm, wrapper } = await mountViewModel()
    await vm.open(item)
    expect(vm.nodeTargets.value).toEqual(detail().availableTargets)
    vm.selectedTarget.value = vm.nodeTargets.value[0]!
    vm.requestKey.value = 'retry-key-0000001'
    await vm.createChild()
    expect(mockedPost).toHaveBeenCalledWith(
      'wfl/expense-flow/create-child',
      expect.anything(),
    )
    wrapper.unmount()
  })

  it('does not call create-child without its dynamic session permission', async () => {
    const { vm, wrapper } = await mountViewModel()
    useSessionStore().permissions = [
      '/wfl/expense-flow/query',
      '/wfl/expense-flow/get',
    ]
    await vm.open(item)
    vm.selectedTarget.value = vm.nodeTargets.value[0]!
    vm.requestKey.value = 'retry-key-0000001'
    await vm.createChild()
    expect(mockedPost).not.toHaveBeenCalledWith(
      'wfl/expense-flow/create-child',
      expect.anything(),
    )
    wrapper.unmount()
  })

  it('filters by the selected typed counterparty object ID', async () => {
    mockedPost.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 20 },
      requestId: '',
    } as never)
    const { vm, wrapper } = await mountViewModel()
    vi.clearAllMocks()
    vm.selectedCounterparty.value = {
      entity: 'supplier',
      objectId: '01J00000000000000000000010',
      approvalEntryId: '01J00000000000000000000011',
      code: 'SUP-0001',
      name: '供应商甲',
    }

    await vm.query({ resetPage: true })

    expect(mockedPost).toHaveBeenCalledWith('wfl/expense-flow/query', {
      page: 1,
      pageSize: 20,
      counterpartyObjectId: '01J00000000000000000000010',
    })
    wrapper.unmount()
  })

  it('retains the selected counterparty when a later search excludes it', async () => {
    vi.useFakeTimers()
    const selectedCounterparty = {
      objectId: '01J00000000000000000000010',
      approvalEntryId: '01J00000000000000000000011',
      entity: 'customer-account' as const,
      code: 'C-001',
      name: '已选客户',
    }
    mockedPost.mockImplementation(async (path) => {
      if (path === 'bob/customer/query') {
        return {
          data: {
            items: [
              {
                objectId: '01J00000000000000000000010',
                code: 'C-001-UPDATED',
                latestApproved: {
                  approval: {
                    approvalEntryId: '01J00000000000000000000014',
                    status: 'APPROVED',
                  },
                  summary: { name: '已选客户（搜索结果）' },
                },
              },
              {
                objectId: '01J00000000000000000000012',
                code: 'C-002',
                latestApproved: {
                  approval: {
                    approvalEntryId: '01J00000000000000000000013',
                    status: 'APPROVED',
                  },
                  summary: { name: '搜索结果客户' },
                },
              },
            ],
          },
        }
      }
      throw new Error(`unexpected API path: ${path}`)
    })
    mockedPostContract.mockResolvedValue({
      data: [
        {
          objectId: '01J00000000000000000000012',
          approvalEntryId: '01J00000000000000000000013',
          code: 'C-002',
          name: '搜索结果客户',
        },
      ],
    } as never)
    const { vm, wrapper } = await mountViewModel()
    useSessionStore().permissions.push(
      '/bob/reference/query',
      '/bob/customer/query',
    )
    vm.selectedCounterparty.value = selectedCounterparty
    const selectedCounterpartyReference = vm.selectedCounterparty.value

    vm.searchCounterparty('搜索结果客户')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(vm.counterpartyOptions.value).toEqual([
      selectedCounterparty,
      {
        objectId: '01J00000000000000000000012',
        approvalEntryId: '01J00000000000000000000013',
        entity: 'customer-account',
        code: 'C-002',
        name: '搜索结果客户',
      },
    ])
    expect(vm.counterpartyOptions.value[0]).toBe(selectedCounterpartyReference)
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('queries employee counterparties only when both reference and entity permissions are granted', async () => {
    vi.useFakeTimers()
    const { vm, wrapper } = await mountViewModel()
    useSessionStore().permissions.push(
      '/bob/reference/query',
      '/bob/employee/query',
    )
    mockedPost.mockImplementation(async (path, body) => {
      if (path === 'bob/reference/query') {
        expect(body).toEqual({ entity: 'employee', keyword: '报销' })
        return {
          data: [
            {
              objectId: '01J00000000000000000000020',
              approvalEntryId: '01J00000000000000000000021',
              code: 'EMP-0001',
              name: '报销员工',
            },
          ],
        } as never
      }
      throw new Error(`unexpected API path: ${path}`)
    })

    vm.searchCounterparty('报销')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(vm.counterpartyOptions.value).toEqual([
      {
        objectId: '01J00000000000000000000020',
        approvalEntryId: '01J00000000000000000000021',
        entity: 'employee',
        code: 'EMP-0001',
        name: '报销员工',
      },
    ])
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('does not issue a counterparty request when either required permission is absent', async () => {
    vi.useFakeTimers()
    const { vm, wrapper } = await mountViewModel()
    useSessionStore().permissions.push('/bob/reference/query')

    vm.searchCounterparty('报销')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(mockedPost).not.toHaveBeenCalledWith(
      'bob/reference/query',
      expect.anything(),
    )
    expect(vm.counterpartyError.value).toBe('缺少客户、供应商或员工查询权限。')

    useSessionStore().permissions = ['/bob/employee/query']
    vm.searchCounterparty('报销')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(mockedPost).not.toHaveBeenCalledWith(
      'bob/reference/query',
      expect.anything(),
    )
    expect(vm.counterpartyError.value).toBe('缺少相对方引用查询权限。')

    useSessionStore().permissions.push('/bob/reference/query')
    vm.searchCounterparty('报销')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(mockedPost).toHaveBeenCalledWith('bob/reference/query', {
      entity: 'employee',
      keyword: '报销',
    })
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('does not update counterparty state after unmount while a search is in flight', async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    const pending = new Promise<unknown>((nextResolve) => {
      resolve = nextResolve
    })
    const { vm, wrapper } = await mountViewModel()
    useSessionStore().permissions.push(
      '/bob/reference/query',
      '/bob/employee/query',
    )
    vm.counterpartyOptions.value = [
      {
        objectId: '01J00000000000000000000030',
        approvalEntryId: '01J00000000000000000000031',
        entity: 'supplier',
        code: 'SUP-0001',
        name: '已有供应商',
      },
    ]
    mockedPost.mockImplementation(async (path) => {
      if (path === 'bob/reference/query') return pending as never
      throw new Error(`unexpected API path: ${path}`)
    })

    vm.searchCounterparty('员工')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()
    expect(vm.counterpartyLoading.value).toBe(true)

    wrapper.unmount()
    resolve({
      data: [
        {
          objectId: '01J00000000000000000000032',
          approvalEntryId: '01J00000000000000000000033',
          code: 'EMP-0002',
          name: '晚到员工',
        },
      ],
    })
    await flushPromises()

    expect(vm.counterpartyOptions.value).toEqual([
      {
        objectId: '01J00000000000000000000030',
        approvalEntryId: '01J00000000000000000000031',
        entity: 'supplier',
        code: 'SUP-0001',
        name: '已有供应商',
      },
    ])
    expect(vm.counterpartyLoading.value).toBe(true)
    vi.useRealTimers()
  })
})
