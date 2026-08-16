import { defineComponent, h, type ComponentPublicInstance } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { ApiError } from '@/api/types'
import {
  useProcessDefinitionViewModel,
  type DefinitionListItem,
  type DefinitionView,
} from '@/pages/wfl/process-definition/vm'
import { useSessionStore } from '@/stores/session'

vi.mock('@/api/client', () => ({
  apiClient: { post: vi.fn(), setCsrfToken: vi.fn() },
}))
const mockedPost = vi.mocked(apiClient.post)
const listItem: DefinitionListItem = {
  definitionId: '01J00000000000000000000001',
  code: 'editor-flow',
  name: '编辑流程',
  status: 'DRAFT',
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
    '/wfl/process-definition/create',
    '/wfl/process-definition/save',
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

describe('Starlark process definition view model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPost.mockImplementation(async (path) => {
      if (path === 'wfl/process-definition/query')
        return { data: { items: [listItem] } }
      if (path === 'wfl/process-definition/get') return { data: definition() }
      throw new Error(`unexpected API path: ${path}`)
    })
  })

  it('creates and saves only Starlark source', async () => {
    mockedPost.mockImplementation(async (path, body) => {
      if (path === 'wfl/process-definition/query')
        return { data: { items: [listItem] } }
      if (path === 'wfl/process-definition/create') {
        expect(body).toEqual({
          script: expect.stringContaining('sale_outbound'),
        })
        return {
          data: { ...definition(), definitionId: listItem.definitionId },
        }
      }
      throw new Error(`unexpected API path: ${path}`)
    })
    const { vm, wrapper } = await mountViewModel()
    vm.create()
    await vm.save()
    expect(mockedPost).toHaveBeenCalledWith('wfl/process-definition/create', {
      script: expect.stringContaining('workflow('),
    })
    wrapper.unmount()
  })

  it('sends an existing VOU reference instead of editable source JSON for trial', async () => {
    mockedPost.mockImplementation(async (path, body) => {
      if (path === 'wfl/process-definition/query')
        return { data: { items: [listItem] } }
      if (path === 'wfl/process-definition/get') return { data: definition() }
      if (path === 'wfl/process-definition/trial') {
        expect(body).toEqual({
          definitionId: listItem.definitionId,
          revision: 1,
          source: {
            entity: 'sale-order',
            documentId: '01J00000000000000000000088',
          },
        })
        return {
          data: {
            matched: true,
            trace: [{ kind: 'ROOT_MATCHED', nodeKey: 'root' }],
          },
        }
      }
      throw new Error(`unexpected API path: ${path}`)
    })
    const { vm, wrapper } = await mountViewModel()
    await vm.open(listItem)
    vm.trialDocumentId.value = '01J00000000000000000000088'
    await vm.trial()
    expect(vm.trialResult.value?.matched).toBe(true)
    wrapper.unmount()
  })

  it('does not trial without the shared save permission', async () => {
    const { vm, wrapper } = await mountViewModel([
      '/wfl/process-definition/query',
      '/wfl/process-definition/get',
    ])
    await vm.open(listItem)
    vm.trialDocumentId.value = '01J00000000000000000000088'
    await vm.trial()
    expect(mockedPost).not.toHaveBeenCalledWith(
      'wfl/process-definition/trial',
      expect.anything(),
    )
    wrapper.unmount()
  })

  it('queries and resets the selected definition status', async () => {
    const { vm, wrapper } = await mountViewModel()
    vi.clearAllMocks()

    vm.status.value = 'ENABLED'
    await vm.query()
    expect(mockedPost).toHaveBeenLastCalledWith(
      'wfl/process-definition/query',
      expect.objectContaining({ status: 'ENABLED' }),
    )

    vm.resetFilters()
    await flushPromises()
    expect(vm.status.value).toBeNull()
    expect(mockedPost).toHaveBeenLastCalledWith(
      'wfl/process-definition/query',
      expect.not.objectContaining({ status: expect.anything() }),
    )
    wrapper.unmount()
  })

  it('surfaces a script location after compilation fails', async () => {
    mockedPost.mockImplementation(async (path) => {
      if (path === 'wfl/process-definition/query')
        return { data: { items: [listItem] } }
      if (path === 'wfl/process-definition/create')
        throw new ApiError('business', '流程脚本编译失败。', {
          code: 2001,
          details: {
            diagnostic: 'workflow.star:7:13: workflow edge is invalid',
          },
        })
      throw new Error(`unexpected API path: ${path}`)
    })
    const { vm, wrapper } = await mountViewModel()
    vm.create()
    await vm.save()
    expect(vm.scriptDiagnostic.value).toMatchObject({ line: 7, column: 13 })
    wrapper.unmount()
  })
})
