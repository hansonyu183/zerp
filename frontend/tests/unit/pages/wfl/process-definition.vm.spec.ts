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
  apiClient: { post: vi.fn(), setCsrfToken: vi.fn() },
}))

const mockedPost = vi.mocked(apiClient.post)
const rootID = '01J00000000000000000000010'
const childID = '01J00000000000000000000011'
const edgeID = '01J00000000000000000000020'

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

function definitionView(): DefinitionView {
  return {
    ...listItem,
    rootNodeId: rootID,
    startCondition: {},
    nodes: [
      {
        id: rootID,
        key: 'root',
        name: '销售订单',
        documentEntity: 'sale-order',
        positionX: 0,
        positionY: 0,
        defaults: {},
      },
      {
        id: childID,
        key: 'outbound',
        name: '销售出库',
        documentEntity: 'sale-outbound',
        positionX: 280,
        positionY: 0,
        defaults: {},
      },
    ],
    edges: [
      {
        id: edgeID,
        sourceNodeId: rootID,
        targetNodeId: childID,
        converterKey: 'sale-order-to-outbound',
        condition: {},
      },
    ],
  }
}

async function mountViewModel(): Promise<{
  vm: ReturnType<typeof useProcessDefinitionViewModel>
  wrapper: VueWrapper<ComponentPublicInstance>
}> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSessionStore().permissions = [
    '/wfl/process-definition/query',
    '/wfl/process-definition/get',
    '/wfl/process-definition/catalog',
  ]
  let vm: ReturnType<typeof useProcessDefinitionViewModel> | undefined
  const Harness = defineComponent({
    setup() {
      vm = useProcessDefinitionViewModel()
      return () => h('div')
    },
  })
  const wrapper = mount(Harness, { global: { plugins: [pinia] } })
  await flushPromises()
  return { vm: vm!, wrapper }
}

describe('process definition JSON editors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPost.mockImplementation(async (path) => {
      if (path === 'wfl/process-definition/query') {
        return { data: { items: [listItem] } }
      }
      if (path === 'wfl/process-definition/catalog') {
        return { data: { nodes: [], converters: [] } }
      }
      if (path === 'wfl/process-definition/get') {
        return { data: definitionView() }
      }
      throw new Error(`unexpected API path: ${path}`)
    })
  })

  it('commits node and edge JSON before changing selection', async () => {
    const { vm, wrapper } = await mountViewModel()
    await vm.open(listItem)

    vm.defaultsText.value = '{"warehouseObjectId":"warehouse"}'
    expect(vm.selectEdge(edgeID)).toBe(true)
    expect(vm.selected.value?.nodes[0]?.defaults).toEqual({
      warehouseObjectId: 'warehouse',
    })

    vm.conditionText.value =
      '{"lineAny":{"field":"quantity","operator":"GT","value":5}}'
    expect(vm.selectNode(childID)).toBe(true)
    expect(vm.selected.value?.edges[0]?.condition).toEqual({
      lineAny: { field: 'quantity', operator: 'GT', value: 5 },
    })
    wrapper.unmount()
  })

  it('keeps the current selection when its JSON is invalid', async () => {
    const { vm, wrapper } = await mountViewModel()
    await vm.open(listItem)

    vm.defaultsText.value = '{invalid'
    expect(vm.selectEdge(edgeID)).toBe(false)
    expect(vm.selectedNode.value?.id).toBe(rootID)
    expect(vm.selectedEdge.value).toBeUndefined()
    expect(vm.defaultsText.value).toBe('{invalid')
    expect(vm.errorMessage.value).toBe('条件或默认值不是有效的 JSON。')
    wrapper.unmount()
  })
})
