import { computed, onMounted, ref } from 'vue'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { ApiError, getErrorMessage } from '@/api/types'
import { documentEntityText } from '@/components/wfl/config'
import { useSessionStore } from '@/stores/session'

export type DefinitionNode = components['schemas']['WflDefinitionNode']
export type DefinitionEdge = components['schemas']['WflDefinitionEdge']
export type DefinitionView = components['schemas']['WflDefinitionView']
export type DefinitionListItem =
  components['schemas']['WflDefinitionListItem']
export type DefinitionTrialResult =
  components['schemas']['WflDefinitionTrialResult']
export type ScriptDiagnostic =
  components['schemas']['WflDefinitionDiagnostic']

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
            relation = "销售出库",
            action = sale_outbound(initial = {}),
        ),
    ],
)`

function diagnosticFromString(diagnostic?: string): ScriptDiagnostic | null {
  if (!diagnostic) return null
  const location = /workflow\.star:(\d+):(\d+)/u.exec(diagnostic)
  return {
    line: Number(location?.[1] ?? 1),
    column: Number(location?.[2] ?? 1),
    message: diagnostic,
  }
}

function diagnosticFromError(error: unknown): ScriptDiagnostic | null {
  if (
    !(error instanceof ApiError) ||
    !error.details ||
    typeof error.details !== 'object'
  )
    return null
  const diagnostic = (error.details as Record<string, unknown>).diagnostic
  if (typeof diagnostic === 'string') return diagnosticFromString(diagnostic)
  if (!diagnostic || typeof diagnostic !== 'object') return null
  const value = diagnostic as Record<string, unknown>
  return typeof value.message === 'string'
    ? {
        message: value.message,
        line: typeof value.line === 'number' ? value.line : undefined,
        column: typeof value.column === 'number' ? value.column : undefined,
      }
    : null
}

export function useProcessDefinitionViewModel() {
  const session = useSessionStore()
  const definitions = ref<DefinitionListItem[]>([])
  const selected = ref<DefinitionView | null>(null)
  const keyword = ref('')
  const status = ref<DefinitionView['status'] | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const trialing = ref(false)
  const editorOpen = ref(false)
  const errorMessage = ref<string | null>(null)
  const scriptDiagnostic = ref<ScriptDiagnostic | null>(null)
  const scriptText = ref(DEFAULT_STARLARK_SCRIPT)
  const trialEntity = ref<components['schemas']['VouEntity'] | ''>('')
  const trialEntityText = computed(() => documentEntityText(trialEntity.value))
  const trialDocumentId = ref('')
  const trialResult = ref<DefinitionTrialResult | null>(null)

  const can = (action: string) =>
    session.can(`/wfl/process-definition/${action}`)
  const nodeMap = computed(
    () =>
      new Map((selected.value?.nodes ?? []).map((node) => [node.key, node])),
  )

  async function query(): Promise<void> {
    if (!can('query')) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract('wfl/process-definition/query', {
        page: 1,
        pageSize: 100,
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
        ...(status.value ? { statuses: [status.value] } : {}),
      })
      definitions.value = data.items ?? []
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function resetFilters(): void {
    keyword.value = ''
    status.value = null
    void query()
  }

  function setSelected(definition: DefinitionView): void {
    selected.value = definition
    scriptText.value = definition.script
    scriptDiagnostic.value = definition.diagnostic ?? null
    trialEntity.value =
      definition.nodes.find((node) => node.key === definition.rootNodeKey)
        ?.documentEntity ?? ''
    trialDocumentId.value = ''
    trialResult.value = null
  }

  async function open(item: DefinitionListItem): Promise<void> {
    if (!can('get')) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.postContract('wfl/process-definition/get', { definitionId: item.definitionId })
      setSelected(data)
      editorOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function create(): void {
    setSelected({
      definitionId: '',
      code: '',
      name: '',
      status: 'DRAFT',
      revision: 0,
      rootEntity: 'sale-order',
      nodeCount: 0,
      script: DEFAULT_STARLARK_SCRIPT,
      rootNodeKey: '',
      nodes: [],
      edges: [],
      updatedAt: '',
    })
    editorOpen.value = true
  }

  async function save(): Promise<void> {
    const definition = selected.value
    if (
      !definition ||
      !scriptText.value.trim() ||
      !(definition.definitionId ? can('save') : can('create'))
    ) {
      if (!scriptText.value.trim()) errorMessage.value = '请填写流程脚本。'
      return
    }
    saving.value = true
    errorMessage.value = null
    scriptDiagnostic.value = null
    trialResult.value = null
    try {
      const { data } = definition.definitionId
        ? await apiClient.postContract('wfl/process-definition/save', {
            definitionId: definition.definitionId,
            revision: definition.revision,
            script: scriptText.value,
          })
        : await apiClient.postContract(
            'wfl/process-definition/create',
            { script: scriptText.value },
          )
      setSelected(data)
      await query()
    } catch (error) {
      scriptDiagnostic.value = diagnosticFromError(error)
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  async function trial(): Promise<void> {
    const definition = selected.value
    if (!definition?.definitionId || !can('save')) return
    const entity = trialEntity.value
    if (!entity || !trialDocumentId.value.trim()) {
      errorMessage.value = '请选择源单据类型并填写已有单据 ID。'
      return
    }
    trialing.value = true
    errorMessage.value = null
    trialResult.value = null
    try {
      const { data } = await apiClient.postContract('wfl/process-definition/trial', {
        definitionId: definition.definitionId,
        revision: definition.revision,
        source: {
          entity,
          documentId: trialDocumentId.value,
        },
      })
      trialResult.value = data
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      trialing.value = false
    }
  }

  async function action(
    actionName: 'publish' | 'enable' | 'disable' | 'delete',
  ): Promise<void> {
    const definition = selected.value
    if (!definition?.definitionId || !can(actionName)) return
    saving.value = true
    errorMessage.value = null
    try {
      if (actionName === 'delete') {
        await apiClient.postContract('wfl/process-definition/delete', {
          definitionId: definition.definitionId,
          revision: definition.revision,
        })
        await session.restore({ force: true })
        editorOpen.value = false
        selected.value = null
        await query()
        return
      }
      const { data } = await apiClient.postContract(`wfl/process-definition/${actionName}`, {
        definitionId: definition.definitionId,
        revision: definition.revision,
      })
      await session.restore({ force: true })
      setSelected(data)
      await query()
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      saving.value = false
    }
  }

  onMounted(() => void query())

  return {
    definitions,
    selected,
    keyword,
    status,
    loading,
    saving,
    trialing,
    editorOpen,
    errorMessage,
    scriptDiagnostic,
    scriptText,
    trialEntity,
    trialEntityText,
    trialDocumentId,
    trialResult,
    nodeMap,
    can,
    query,
    resetFilters,
    create,
    open,
    save,
    trial,
    action,
  }
}
