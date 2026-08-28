import { defineComponent, h, type ComponentPublicInstance } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import {
  useProcessDefinitionViewModel,
  type DefinitionListItem,
  type DefinitionView,
} from '@/pages/wfl/process-definition/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: { postContract: vi.fn(), setCsrfToken: vi.fn() },
}))
const mockedPost = vi.mocked(apiClient.postContract)

const listItem: DefinitionListItem = {
  definitionId: '01J00000000000000000000001',
  code: 'editor-flow',
  name: '编辑流程',
  approval: {
    approvalEntryId: '01J00000000000000000000002',
    versionNo: 1,
    status: 'APPROVED',
    revision: 1,
    createdBy: '01J00000000000000000000003',
    createdAt: '2026-08-03T00:00:00Z',
    updatedBy: '01J00000000000000000000003',
    updatedAt: '2026-08-03T00:00:00Z',
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
  },
  revision: 1,
  rootEntity: 'sale-order',
  nodeCount: 2,
  updatedAt: '2026-08-03T00:00:00Z',
}

const definition = (): DefinitionView => ({
  ...listItem,
  script: 'workflow(code="editor-flow", name="编辑流程", root=root)',
  rootNodeKey: 'root',
  nodes: [
    {
      key: 'root',
      name: '销售订单',
      documentEntity: 'sale-order',
      positionX: 0,
      positionY: 0,
    },
  ],
  edges: [],
})

async function mountViewModel(
  permissions = [
    '/wfl/process-definition/query',
    '/wfl/process-definition/get',
  ],
): Promise<{
  vm: ReturnType<typeof useProcessDefinitionViewModel>
  wrapper: VueWrapper<ComponentPublicInstance>
}> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSessionStore().permissions = permissions
  let vm: ReturnType<typeof useProcessDefinitionViewModel> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        vm = useProcessDefinitionViewModel()
        return () => h('div')
      },
    }),
    { global: { plugins: [pinia] } },
  )
  await flushPromises()
  return { vm: vm!, wrapper }
}

describe('WFL process-definition view model (read-only)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPost.mockImplementation(async (path) => {
      if (path === 'wfl/process-definition/query')
        return { data: { items: [listItem] } }
      if (path === 'wfl/process-definition/get') return { data: definition() }
      throw new Error(`unexpected API path: ${path}`)
    })
  })

  it('queries current definitions via wfl/process-definition/query', async () => {
    const { vm, wrapper } = await mountViewModel()
    await vm.query()
    expect(mockedPost).toHaveBeenCalledWith(
      'wfl/process-definition/query',
      expect.objectContaining({ page: 1, pageSize: 100 }),
    )
    expect(vm.definitions.value).toHaveLength(1)
    expect(vm.definitions.value[0]!.code).toBe('editor-flow')
    wrapper.unmount()
  })

  it('opens a definition via wfl/process-definition/get with definitionId', async () => {
    const { vm, wrapper } = await mountViewModel()
    await vm.open(listItem)
    expect(mockedPost).toHaveBeenCalledWith(
      'wfl/process-definition/get',
      expect.objectContaining({ definitionId: listItem.definitionId }),
    )
    expect(vm.selected.value?.code).toBe('editor-flow')
    wrapper.unmount()
  })

  it('only calls query and get — no lifecycle or trial endpoints', async () => {
    const { vm, wrapper } = await mountViewModel()
    await vm.query()
    await vm.open(listItem)
    vm.resetFilters()
    await flushPromises()

    const allPaths = mockedPost.mock.calls.map(([path]) => String(path))
    const forbidden = allPaths.filter(
      (p) =>
        p.includes('trial') ||
        p.includes('create') ||
        p.includes('save') ||
        p.includes('submit') ||
        p.includes('approve') ||
        p.includes('reject') ||
        p.includes('unsubmit') ||
        p.includes('enable') ||
        p.includes('disable'),
    )
    expect(forbidden).toHaveLength(0)
    wrapper.unmount()
  })

  it('does not pass approval-status or candidate parameters to query', async () => {
    const { vm, wrapper } = await mountViewModel()
    vm.keyword.value = 'editor'
    await vm.query()

    const queryCalls = mockedPost.mock.calls.filter(
      ([path]) => String(path) === 'wfl/process-definition/query',
    )
    expect(queryCalls.length).toBeGreaterThanOrEqual(1)
    const lastBody = queryCalls[queryCalls.length - 1]![1] as Record<string, unknown>
    expect(lastBody).not.toHaveProperty('approvalStatuses')
    expect(lastBody).not.toHaveProperty('approvalStatus')
    expect(lastBody).not.toHaveProperty('candidate')
    expect(lastBody).toEqual({ page: 1, pageSize: 100, keyword: 'editor' })
    wrapper.unmount()
  })

  it('exposes no lifecycle or trial methods on the view model', async () => {
    const { vm, wrapper } = await mountViewModel()
    expect(vm).not.toHaveProperty('create')
    expect(vm).not.toHaveProperty('save')
    expect(vm).not.toHaveProperty('trial')
    expect(vm).not.toHaveProperty('run')
    expect(vm).not.toHaveProperty('scriptDiagnostic')
    expect(vm).not.toHaveProperty('status')
    wrapper.unmount()
  })

  it('resets keyword and re-queries without extra parameters', async () => {
    const { vm, wrapper } = await mountViewModel()
    vm.keyword.value = 'something'
    vm.resetFilters()
    await flushPromises()
    expect(vm.keyword.value).toBe('')
    expect(mockedPost).toHaveBeenLastCalledWith(
      'wfl/process-definition/query',
      { page: 1, pageSize: 100 },
    )
    wrapper.unmount()
  })
})
