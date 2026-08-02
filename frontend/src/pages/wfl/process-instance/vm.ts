import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'

export interface InstanceListItem {
  processId: string
  definitionId: string
  definitionCode: string
  definitionName: string
  status: 'ACTIVE' | 'COMPLETED'
  revision: number
  rootDocumentId: string
  rootDocumentNo: string
  rootEntity: string
  updatedAt: string
}

export interface NodeInstance {
  nodeInstanceId: string
  parentNodeInstanceId?: string
  nodeKey: string
  nodeName: string
  documentId: string
  documentNo: string
  documentEntity: string
  documentStatus: string
  documentRevision: number
  businessDate: string
  legacy: boolean
}

export interface InstanceView extends InstanceListItem {
  startedDefinitionRevision: number
  nodes: NodeInstance[]
}

export interface AuditEvent {
  id: string
  eventType: string
  documentNo?: string
  actorId: string
  requestId: string
  summary: Record<string, unknown>
  occurredAt: string
}

export function useProcessInstanceViewModel() {
  const session = useSessionStore()
  const router = useRouter()
  const items = ref<InstanceListItem[]>([])
  const selected = ref<InstanceView | null>(null)
  const history = ref<AuditEvent[]>([])
  const keyword = ref('')
  const statuses = ref<string[]>([])
  const loading = ref(false)
  const detailOpen = ref(false)
  const errorMessage = ref<string | null>(null)
  const can = (action: string) => session.can(`/wfl/process-instance/${action}`)

  const positionedNodes = computed(() => {
    const nodes = selected.value?.nodes ?? []
    const depth = new Map<string, number>()
    const calculate = (node: NodeInstance): number => {
      if (depth.has(node.nodeInstanceId)) return depth.get(node.nodeInstanceId)!
      const parent = nodes.find(
        (item) => item.nodeInstanceId === node.parentNodeInstanceId,
      )
      const value = parent ? calculate(parent) + 1 : 0
      depth.set(node.nodeInstanceId, value)
      return value
    }
    const rows = new Map<number, number>()
    return nodes.map((node) => {
      const column = calculate(node)
      const row = rows.get(column) ?? 0
      rows.set(column, row + 1)
      return { ...node, x: 40 + column * 280, y: 55 + row * 140 }
    })
  })
  const nodeMap = computed(
    () =>
      new Map(positionedNodes.value.map((node) => [node.nodeInstanceId, node])),
  )

  async function query(): Promise<void> {
    if (!can('query')) return
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<
        { items: InstanceListItem[] },
        {
          page: number
          pageSize: number
          keyword?: string
          statuses?: string[]
        }
      >('wfl/process-instance/query', {
        page: 1,
        pageSize: 100,
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
        ...(statuses.value.length ? { statuses: statuses.value } : {}),
      })
      items.value = data.items ?? []
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  async function open(item: InstanceListItem): Promise<void> {
    if (!can('get')) return
    loading.value = true
    errorMessage.value = null
    try {
      const [detail, audit] = await Promise.all([
        apiClient.post<InstanceView, { processId: string }>(
          'wfl/process-instance/get',
          {
            processId: item.processId,
          },
        ),
        can('audit-history')
          ? apiClient.post<
              { items: AuditEvent[] },
              { processId: string; page: number; pageSize: number }
            >('wfl/process-instance/audit-history', {
              processId: item.processId,
              page: 1,
              pageSize: 100,
            })
          : Promise.resolve({
              data: { items: [] as AuditEvent[] },
              requestId: '',
            }),
      ])
      selected.value = detail.data
      history.value = audit.data.items ?? []
      detailOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function openDocument(node: NodeInstance): void {
    void router.push({
      path: `/vou/${node.documentEntity}`,
      query: { documentId: node.documentId },
    })
  }

  onMounted(() => void query())
  return {
    items,
    selected,
    history,
    keyword,
    statuses,
    loading,
    detailOpen,
    errorMessage,
    positionedNodes,
    nodeMap,
    query,
    open,
    openDocument,
  }
}
