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
  apiClient: { post: vi.fn(), postContract: vi.fn(), setCsrfToken: vi.fn() },
}))
const mockedPost = vi.mocked(apiClient.post)
const mockedPostContract = vi.mocked(apiClient.postContract)
const item: InstanceListItem = {
  processId: '01J00000000000000000000001',
  definitionId: '01J00000000000000000000002',
  definitionCode: 'expense-flow',
  definitionName: '费用流程',
  revision: 2,
  rootDocumentId: '01J00000000000000000000003',
  rootDocumentNo: 'ER-001',
  rootEntity: 'expense-reimbursement',
  partyCode: '',
  partyName: '',
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

  it('retains the selected party when a later search excludes it', async () => {
    vi.useFakeTimers()
    const selectedParty = {
      objectId: '01J00000000000000000000010',
      versionId: '01J00000000000000000000011',
      entity: 'customer' as const,
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
                effectiveVersionId: '01J00000000000000000000014',
                currentVersion: {
                  versionId: '01J00000000000000000000014',
                  status: 'EFFECTIVE',
                  summary: { name: '已选客户（搜索结果）' },
                },
              },
              {
                objectId: '01J00000000000000000000012',
                code: 'C-002',
                effectiveVersionId: '01J00000000000000000000013',
                currentVersion: {
                  versionId: '01J00000000000000000000013',
                  status: 'EFFECTIVE',
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
          versionId: '01J00000000000000000000013',
          code: 'C-002',
          name: '搜索结果客户',
        },
      ],
    } as never)
    const { vm, wrapper } = await mountViewModel()
    useSessionStore().permissions.push('/bob/customer/query')
    vm.selectedParty.value = selectedParty
    const selectedPartyReference = vm.selectedParty.value

    vm.searchParty('搜索结果客户')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(vm.partyOptions.value).toEqual([
      selectedParty,
      {
        objectId: '01J00000000000000000000012',
        versionId: '01J00000000000000000000013',
        entity: 'customer',
        code: 'C-002',
        name: '搜索结果客户',
      },
    ])
    expect(vm.partyOptions.value[0]).toBe(selectedPartyReference)
    wrapper.unmount()
    vi.useRealTimers()
  })
})
