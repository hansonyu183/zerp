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
const rootID = '01J00000000000000000000010'
const childID = '01J00000000000000000000011'
const edgeID = '01J00000000000000000000020'

const listItem: DefinitionListItem = {
  definitionId: '01J00000000000000000000001',
  code: 'editor-flow',
  name: '编辑流程',
  status: 'DRAFT',
  revision: 1,
  sourceKind: 'GRAPH',
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
    '/wfl/process-definition/create',
    '/wfl/process-definition/save',
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

  it('creates a Starlark draft and saves only the script source', async () => {
    mockedPost.mockImplementation(async (path, body) => {
      if (path === 'wfl/process-definition/query') {
        return { data: { items: [listItem] } }
      }
      if (path === 'wfl/process-definition/catalog') {
        return { data: { nodes: [], converters: [] } }
      }
      if (path === 'wfl/process-definition/create') {
        expect(body).toEqual({
          script: expect.stringContaining('workflow('),
        })
        return {
          data: {
            ...definitionView(),
            sourceKind: 'STARLARK',
            script: (body as { script: string }).script,
          },
        }
      }
      throw new Error(`unexpected API path: ${path}`)
    })
    const { vm, wrapper } = await mountViewModel()

    vm.create()
    expect(vm.selected.value?.sourceKind).toBe('STARLARK')
    expect(vm.scriptText.value).toContain('root = node(')
    await vm.save()

    expect(mockedPost).toHaveBeenCalledWith('wfl/process-definition/create', {
      script: expect.stringContaining('workflow('),
    })
    wrapper.unmount()
  })

  it('exposes a structured Starlark diagnostic location after save fails', async () => {
    mockedPost.mockImplementation(async (path) => {
      if (path === 'wfl/process-definition/query') {
        return { data: { items: [listItem] } }
      }
      if (path === 'wfl/process-definition/catalog') {
        return { data: { nodes: [], converters: [] } }
      }
      if (path === 'wfl/process-definition/create') {
        throw new ApiError('business', '流程脚本编译失败。', {
          code: 2001,
          details: {
            diagnostic:
              'Traceback (most recent call last):\n  workflow.star:7:13: in <toplevel>\nworkflow edge is invalid',
          },
        })
      }
      throw new Error(`unexpected API path: ${path}`)
    })
    const { vm, wrapper } = await mountViewModel()

    vm.create()
    await vm.save()

    expect(vm.scriptDiagnostic.value).toEqual({
      line: 7,
      column: 13,
      message:
        'Traceback (most recent call last):\n  workflow.star:7:13: in <toplevel>\nworkflow edge is invalid',
    })
    wrapper.unmount()
  })

  it('trials a saved script draft with manual JSON and exposes its trace', async () => {
    const scriptDefinition: DefinitionView = {
      ...definitionView(),
      sourceKind: 'STARLARK',
      script:
        'workflow(code="editor-flow", name="编辑流程", root=node(key="root", name="销售订单", entity="sale-order"))',
    }
    const trialSource = {
      entity: 'sale-order',
      data: {
        businessDate: '2026-08-08',
        currency: 'CNY',
      },
    }
    mockedPost.mockImplementation(async (path, body) => {
      if (path === 'wfl/process-definition/query') {
        return { data: { items: [listItem] } }
      }
      if (path === 'wfl/process-definition/catalog') {
        return { data: { nodes: [], converters: [] } }
      }
      if (path === 'wfl/process-definition/get') {
        return { data: scriptDefinition }
      }
      if (path === 'wfl/process-definition/trial') {
        expect(body).toEqual({
          definitionId: scriptDefinition.definitionId,
          revision: scriptDefinition.revision,
          source: trialSource,
        })
        return {
          data: {
            matched: true,
            trace: [{ nodeKey: 'root', kind: 'ROOT_MATCHED' }],
          },
        }
      }
      throw new Error(`unexpected API path: ${path}`)
    })
    const { vm, wrapper } = await mountViewModel()
    await vm.open(listItem)
    vm.trialSourceText.value = JSON.stringify(trialSource)

    await vm.trial()

    expect(vm.trialResult.value).toEqual({
      matched: true,
      trace: [{ nodeKey: 'root', kind: 'ROOT_MATCHED' }],
    })
    wrapper.unmount()
  })
})
