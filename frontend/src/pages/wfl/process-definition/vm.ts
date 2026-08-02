import { computed, onMounted, ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'

export interface CatalogNode {
  entity: string
  name: string
}

export interface CatalogConverter {
  key: string
  sourceEntity: string
  targetEntity: string
  requiredDefaults?: string[]
}

export interface DefinitionNode {
  id: string
  key: string
  name: string
  documentEntity: string
  positionX: number
  positionY: number
  defaults: Record<string, unknown>
}

export interface DefinitionEdge {
  id: string
  sourceNodeId: string
  targetNodeId: string
  converterKey: string
  condition: Record<string, unknown>
}

export interface DefinitionView {
  definitionId: string
  code: string
  name: string
  status: 'DRAFT' | 'ENABLED' | 'DISABLED'
  revision: number
  rootNodeId: string
  startCondition: Record<string, unknown>
  nodes: DefinitionNode[]
  edges: DefinitionEdge[]
  updatedAt: string
}

export interface DefinitionListItem {
  definitionId: string
  code: string
  name: string
  status: DefinitionView['status']
  revision: number
  rootEntity: string
  nodeCount: number
  updatedAt: string
}

function workflowId(prefix: string): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  let suffix = ''
  const bytes = crypto.getRandomValues(new Uint8Array(23 - prefix.length))
  for (const value of bytes) suffix += alphabet[value % alphabet.length]
  return `${prefix}${Date.now().toString(32).toUpperCase().slice(-10)}${suffix}`.slice(
    0,
    26,
  )
}

export function useProcessDefinitionViewModel() {
  const session = useSessionStore()
  const definitions = ref<DefinitionListItem[]>([])
  const catalogNodes = ref<CatalogNode[]>([])
  const converters = ref<CatalogConverter[]>([])
  const selected = ref<DefinitionView | null>(null)
  const keyword = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const editorOpen = ref(false)
  const errorMessage = ref<string | null>(null)
  const selectedNodeId = ref<string | null>(null)
  const selectedEdgeId = ref<string | null>(null)
  const startConditionText = ref('{}')
  const conditionText = ref('{}')
  const defaultsText = ref('{}')

  const can = (action: string) =>
    session.can(`/wfl/process-definition/${action}`)
  const selectedNode = computed(() =>
    selected.value?.nodes.find((node) => node.id === selectedNodeId.value),
  )
  const selectedEdge = computed(() =>
    selected.value?.edges.find((edge) => edge.id === selectedEdgeId.value),
  )

  async function query(): Promise<void> {
    if (!can('query')) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<
        { items: DefinitionListItem[] },
        { page: number; pageSize: number; keyword?: string }
      >('wfl/process-definition/query', {
        page: 1,
        pageSize: 100,
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      })
      definitions.value = data.items ?? []
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function loadCatalog(): Promise<void> {
    if (!can('catalog')) return
    try {
      const { data } = await apiClient.post<
        { nodes: CatalogNode[]; converters: CatalogConverter[] },
        Record<string, never>
      >('wfl/process-definition/catalog', {})
      catalogNodes.value = data.nodes ?? []
      converters.value = data.converters ?? []
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  function syncEditors(): void {
    startConditionText.value = JSON.stringify(
      selected.value?.startCondition ?? {},
      null,
      2,
    )
    conditionText.value = JSON.stringify(
      selectedEdge.value?.condition ?? {},
      null,
      2,
    )
    defaultsText.value = JSON.stringify(
      selectedNode.value?.defaults ?? {},
      null,
      2,
    )
  }

  async function open(item: DefinitionListItem): Promise<void> {
    if (!can('get')) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<
        DefinitionView,
        { definitionId: string }
      >('wfl/process-definition/get', { definitionId: item.definitionId })
      selected.value = data
      selectedNodeId.value = data.rootNodeId
      selectedEdgeId.value = null
      syncEditors()
      editorOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function create(): void {
    selected.value = {
      definitionId: '',
      code: '',
      name: '',
      status: 'DRAFT',
      revision: 0,
      rootNodeId: '',
      startCondition: {},
      nodes: [],
      edges: [],
      updatedAt: '',
    }
    selectedNodeId.value = null
    selectedEdgeId.value = null
    syncEditors()
    editorOpen.value = true
  }

  function addRoot(entity: string): void {
    if (!selected.value || selected.value.nodes.length) return
    const nodeType = catalogNodes.value.find((item) => item.entity === entity)
    if (!nodeType) return
    const id = workflowId('N')
    selected.value.nodes.push({
      id,
      key: 'root',
      name: nodeType.name,
      documentEntity: entity,
      positionX: 40,
      positionY: 120,
      defaults: {},
    })
    selected.value.rootNodeId = id
    selectNode(id)
  }

  function addChild(sourceNodeId: string, converterKey: string): void {
    if (!selected.value) return
    const source = selected.value.nodes.find((node) => node.id === sourceNodeId)
    const converter = converters.value.find(
      (item) =>
        item.key === converterKey &&
        item.sourceEntity === source?.documentEntity,
    )
    const targetType = catalogNodes.value.find(
      (item) => item.entity === converter?.targetEntity,
    )
    if (!source || !converter || !targetType) return
    const siblings = selected.value.edges.filter(
      (edge) => edge.sourceNodeId === sourceNodeId,
    ).length
    const nodeId = workflowId('N')
    const defaults = Object.fromEntries(
      (converter.requiredDefaults ?? []).map((field) => [field, '']),
    )
    selected.value.nodes.push({
      id: nodeId,
      key: `${converter.targetEntity}-${selected.value.nodes.length + 1}`,
      name: targetType.name,
      documentEntity: converter.targetEntity,
      positionX: source.positionX + 280,
      positionY: source.positionY + siblings * 150,
      defaults,
    })
    selected.value.edges.push({
      id: workflowId('E'),
      sourceNodeId,
      targetNodeId: nodeId,
      converterKey,
      condition: {},
    })
    selectNode(nodeId)
  }

  function removeNode(nodeId: string): void {
    if (!selected.value || nodeId === selected.value.rootNodeId) return
    const descendants = new Set([nodeId])
    let changed = true
    while (changed) {
      changed = false
      for (const edge of selected.value.edges) {
        if (
          descendants.has(edge.sourceNodeId) &&
          !descendants.has(edge.targetNodeId)
        ) {
          descendants.add(edge.targetNodeId)
          changed = true
        }
      }
    }
    selected.value.nodes = selected.value.nodes.filter(
      (node) => !descendants.has(node.id),
    )
    selected.value.edges = selected.value.edges.filter(
      (edge) =>
        !descendants.has(edge.sourceNodeId) &&
        !descendants.has(edge.targetNodeId),
    )
    selectNode(selected.value.rootNodeId)
  }

  function selectNode(id: string): void {
    selectedNodeId.value = id
    selectedEdgeId.value = null
    syncEditors()
  }

  function selectEdge(id: string): void {
    selectedEdgeId.value = id
    selectedNodeId.value = null
    syncEditors()
  }

  function applyJson(): boolean {
    if (!selected.value) return false
    try {
      selected.value.startCondition = JSON.parse(
        startConditionText.value || '{}',
      )
      if (selectedNode.value) {
        selectedNode.value.defaults = JSON.parse(defaultsText.value || '{}')
      }
      if (selectedEdge.value) {
        selectedEdge.value.condition = JSON.parse(conditionText.value || '{}')
      }
      return true
    } catch {
      errorMessage.value = '条件或默认值不是有效的 JSON。'
      return false
    }
  }

  async function save(): Promise<void> {
    const definition = selected.value
    if (!definition || !applyJson()) return
    if (
      !definition.code.trim() ||
      !definition.name.trim() ||
      !definition.rootNodeId
    ) {
      errorMessage.value = '请填写编码、名称并设置根单据。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      const body = {
        code: definition.code.trim(),
        name: definition.name.trim(),
        rootNodeId: definition.rootNodeId,
        startCondition: definition.startCondition,
        nodes: definition.nodes,
        edges: definition.edges,
      }
      const { data } = definition.definitionId
        ? await apiClient.post<
            DefinitionView,
            typeof body & { definitionId: string; revision: number }
          >('wfl/process-definition/save', {
            ...body,
            definitionId: definition.definitionId,
            revision: definition.revision,
          })
        : await apiClient.post<DefinitionView, typeof body>(
            'wfl/process-definition/create',
            body,
          )
      selected.value = data
      selectNode(data.rootNodeId)
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function action(
    actionName: 'enable' | 'disable' | 'delete',
  ): Promise<void> {
    const definition = selected.value
    if (!definition?.definitionId || !can(actionName)) return
    saving.value = true
    errorMessage.value = null
    try {
      await apiClient.post(`wfl/process-definition/${actionName}`, {
        definitionId: definition.definitionId,
        revision: definition.revision,
      })
      if (actionName === 'delete') {
        editorOpen.value = false
        selected.value = null
      } else {
        await open({
          ...definition,
          rootEntity: '',
          nodeCount: definition.nodes.length,
        })
      }
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  onMounted(() => void Promise.all([query(), loadCatalog()]))

  return {
    definitions,
    catalogNodes,
    converters,
    selected,
    selectedNode,
    selectedEdge,
    keyword,
    loading,
    saving,
    editorOpen,
    errorMessage,
    query,
    create,
    open,
    save,
    action,
    addRoot,
    addChild,
    removeNode,
    selectNode,
    selectEdge,
    can,
    startConditionText,
    conditionText,
    defaultsText,
  }
}
