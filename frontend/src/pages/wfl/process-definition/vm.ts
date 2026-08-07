import { computed, onMounted, ref } from 'vue'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { ApiError, getErrorMessage } from '@/api/types'
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
  sourceKind: 'GRAPH' | 'STARLARK'
  script?: string
  diagnostic?: string
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
  sourceKind: DefinitionView['sourceKind']
  rootEntity: string
  nodeCount: number
  updatedAt: string
}

export interface DefinitionTrialResult {
  definitionId?: string
  revision?: number
  matched: boolean
  rootNodeKey?: string
  trace: Array<{
    kind: string
    nodeKey: string
    documentEntity?: string
  }>
}

export interface ScriptDiagnostic {
  line: number
  column: number
  message: string
}

type DefinitionCreateRequest =
  components['schemas']['WflDefinitionCreateRequest']
type DefinitionSaveRequest = components['schemas']['WflDefinitionSaveRequest']
type DefinitionTrialRequest = components['schemas']['WflDefinitionTrialRequest']

const DEFAULT_STARLARK_SCRIPT = `root = node(
    key = "root",
    name = "销售订单",
    entity = "sale-order",
)

outbound = node(
    key = "outbound",
    name = "销售出库",
    entity = "sale-outbound",
)

workflow(
    code = "new-process",
    name = "新流程",
    root = root,
    edges = [
        edge(
            source = root,
            target = outbound,
            converter = "sale-order-to-outbound",
        ),
    ],
)`

const DEFAULT_TRIAL_SOURCE = `{
  "entity": "sale-order",
  "data": {
    "businessDate": "2026-08-08",
    "currency": "CNY",
    "customer": {
      "objectId": "01J00000000000000000000001",
      "versionId": "01J00000000000000000000002"
    },
    "warehouse": {
      "objectId": "01J00000000000000000000003",
      "versionId": "01J00000000000000000000004"
    },
    "productLines": [{
      "product": {
        "objectId": "01J00000000000000000000005",
        "versionId": "01J00000000000000000000006"
      },
      "orderedQuantity": "1",
      "unitPrice": "10"
    }]
  }
}`

function diagnosticFromError(error: unknown): ScriptDiagnostic | null {
  if (
    !(error instanceof ApiError) ||
    !error.details ||
    typeof error.details !== 'object'
  ) {
    return null
  }
  const diagnostic = (error.details as Record<string, unknown>).diagnostic
  return typeof diagnostic === 'string' ? diagnosticFromString(diagnostic) : null
}

function diagnosticFromString(diagnostic?: string): ScriptDiagnostic | null {
  if (!diagnostic) return null
  const location = /workflow\.star:(\d+):(\d+)/u.exec(diagnostic)
  return {
    line: Number(location?.[1] ?? 1),
    column: Number(location?.[2] ?? 1),
    message: diagnostic,
  }
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
  const trialing = ref(false)
  const editorOpen = ref(false)
  const errorMessage = ref<string | null>(null)
  const scriptDiagnostic = ref<ScriptDiagnostic | null>(null)
  const selectedNodeId = ref<string | null>(null)
  const selectedEdgeId = ref<string | null>(null)
  const startConditionText = ref('{}')
  const conditionText = ref('{}')
  const defaultsText = ref('{}')
  const scriptText = ref(DEFAULT_STARLARK_SCRIPT)
  const trialSourceText = ref(DEFAULT_TRIAL_SOURCE)
  const trialResult = ref<DefinitionTrialResult | null>(null)

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
      scriptText.value = data.script ?? ''
      scriptDiagnostic.value = diagnosticFromString(data.diagnostic)
      trialSourceText.value = JSON.stringify(
        {
          entity:
            data.nodes.find((node) => node.id === data.rootNodeId)
              ?.documentEntity ?? '',
        },
        null,
        2,
      )
      trialResult.value = null
      selectNode(data.rootNodeId, false)
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
      sourceKind: 'STARLARK',
      script: DEFAULT_STARLARK_SCRIPT,
      rootNodeId: '',
      startCondition: {},
      nodes: [],
      edges: [],
      updatedAt: '',
    }
    selectedNodeId.value = null
    selectedEdgeId.value = null
    scriptText.value = DEFAULT_STARLARK_SCRIPT
    trialSourceText.value = '{"entity":"sale-order"}'
    trialResult.value = null
    syncEditors()
    editorOpen.value = true
  }

  function addRoot(entity: string): void {
    if (!selected.value || selected.value.nodes.length || !applyJson()) return
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
    selectNode(id, false)
  }

  function addChild(sourceNodeId: string, converterKey: string): void {
    if (!selected.value || !applyJson()) return
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
    selectNode(nodeId, false)
  }

  function removeNode(nodeId: string): void {
    if (!selected.value || nodeId === selected.value.rootNodeId || !applyJson())
      return
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
    selectNode(selected.value.rootNodeId, false)
  }

  function selectNode(id: string, commitCurrent = true): boolean {
    if (commitCurrent && !applyJson()) return false
    selectedNodeId.value = id
    selectedEdgeId.value = null
    syncEditors()
    return true
  }

  function selectEdge(id: string, commitCurrent = true): boolean {
    if (commitCurrent && !applyJson()) return false
    selectedEdgeId.value = id
    selectedNodeId.value = null
    syncEditors()
    return true
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
    if (!definition) return
    if (definition.sourceKind === 'STARLARK') {
      if (!scriptText.value.trim()) {
        errorMessage.value = '请填写流程脚本。'
        return
      }
      saving.value = true
      errorMessage.value = null
      scriptDiagnostic.value = null
      trialResult.value = null
      try {
        const createBody: DefinitionCreateRequest = {
          script: scriptText.value,
        }
        const { data } = definition.definitionId
          ? await apiClient.post<DefinitionView, DefinitionSaveRequest>(
              'wfl/process-definition/save',
              {
                script: scriptText.value,
                definitionId: definition.definitionId,
                revision: definition.revision,
              },
            )
          : await apiClient.post<DefinitionView, DefinitionCreateRequest>(
              'wfl/process-definition/create',
              createBody,
            )
        selected.value = data
        scriptText.value = data.script ?? scriptText.value
        scriptDiagnostic.value = diagnosticFromString(data.diagnostic)
        selectNode(data.rootNodeId, false)
        await query()
      } catch (error) {
        scriptDiagnostic.value = diagnosticFromError(error)
        errorMessage.value = getErrorMessage(error)
      } finally {
        saving.value = false
      }
      return
    }
    if (!applyJson()) return
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
      selectNode(data.rootNodeId, false)
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function trial(): Promise<void> {
    const definition = selected.value
    if (
      !definition?.definitionId ||
      definition.sourceKind !== 'STARLARK' ||
      !can('save')
    )
      return
    let source: DefinitionTrialRequest['source']
    try {
      const parsed: unknown = JSON.parse(trialSourceText.value)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new TypeError('trial source must be an object')
      }
      const record = parsed as Record<string, unknown>
      const entity = record.entity
      if (typeof entity !== 'string' || !entity.trim()) {
        throw new TypeError('trial source must have an entity')
      }
      if (
        !record.data ||
        Array.isArray(record.data) ||
        typeof record.data !== 'object'
      ) {
        throw new TypeError('trial source must have document data')
      }
      source = record as DefinitionTrialRequest['source']
    } catch {
      errorMessage.value =
        '试算源单必须是包含 entity 和 data 的有效 JSON 对象。'
      return
    }
    trialing.value = true
    errorMessage.value = null
    trialResult.value = null
    try {
      const { data } = await apiClient.post<
        DefinitionTrialResult,
        DefinitionTrialRequest
      >('wfl/process-definition/trial', {
        definitionId: definition.definitionId,
        revision: definition.revision,
        source,
      })
      trialResult.value = data
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      trialing.value = false
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
      await session.restore({ force: true })
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
    trialing,
    editorOpen,
    errorMessage,
    scriptDiagnostic,
    query,
    create,
    open,
    save,
    trial,
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
    scriptText,
    trialSourceText,
    trialResult,
  }
}
