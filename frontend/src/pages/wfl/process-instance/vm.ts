import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import { useSessionStore } from '@/stores/session'

export interface CurrentNode {
  nodeInstanceId: string
  nodeName: string
  documentId: string
  documentNo: string
  documentEntity: string
  documentStatus: string
}

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
  currentNodes: CurrentNode[]
  updatedAt: string
}

export interface NodeInstance extends CurrentNode {
  parentNodeInstanceId?: string
  nodeKey: string
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
  const route = useRoute()
  const router = useRouter()
  const processName = computed(() => String(route.meta.processName ?? ''))
  const items = ref<InstanceListItem[]>([])
  const selected = ref<InstanceView | null>(null)
  const history = ref<AuditEvent[]>([])
  const keyword = ref('')
  const statuses = ref<string[]>([])
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const loading = ref(false)
  const detailOpen = ref(false)
  const chooserOpen = ref(false)
  const chooserNodes = ref<CurrentNode[]>([])
  const errorMessage = ref<string | null>(null)
  const can = (action: string) =>
    Boolean(processName.value) &&
    session.can(`/wfl/${processName.value}/${action}`)

  const pageCount = computed(() =>
    Math.max(1, Math.ceil(total.value / pageSize.value)),
  )
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

  async function query(options: { resetPage?: boolean } = {}): Promise<void> {
    if (!can('query')) return
    if (options.resetPage) page.value = 1
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<
        {
          items: InstanceListItem[]
          total: number
          page: number
          pageSize: number
        },
        {
          page: number
          pageSize: number
          keyword?: string
          statuses?: string[]
        }
      >(`wfl/${processName.value}/query`, {
        page: page.value,
        pageSize: pageSize.value,
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
        ...(statuses.value.length ? { statuses: statuses.value } : {}),
      })
      items.value = data.items ?? []
      total.value = data.total ?? 0
      page.value = data.page ?? page.value
      pageSize.value = data.pageSize ?? pageSize.value
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
          `wfl/${processName.value}/get`,
          { processId: item.processId },
        ),
        can('audit-history')
          ? apiClient.post<
              { items: AuditEvent[] },
              { processId: string; page: number; pageSize: number }
            >(`wfl/${processName.value}/audit-history`, {
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

  function openDocument(node: CurrentNode): void {
    void router.push({
      path: `/vou/${node.documentEntity}`,
      query: { documentId: node.documentId },
    })
  }

  function openRoot(item: InstanceListItem): void {
    openDocument({
      nodeInstanceId: '',
      nodeName: '',
      documentId: item.rootDocumentId,
      documentNo: item.rootDocumentNo,
      documentEntity: item.rootEntity,
      documentStatus: '',
    })
  }

  function processCurrent(item: InstanceListItem): void {
    if (item.currentNodes.length === 1 && item.currentNodes[0]) {
      openDocument(item.currentNodes[0])
      return
    }
    if (item.currentNodes.length > 1) {
      chooserNodes.value = item.currentNodes
      chooserOpen.value = true
    }
  }

  function chooseNode(node: CurrentNode): void {
    chooserOpen.value = false
    openDocument(node)
  }

  async function changePage(value: number): Promise<void> {
    page.value = value
    await query()
  }

  watch(processName, () => {
    page.value = 1
    void query()
  })
  onMounted(() => void query())

  return {
    processName,
    items,
    selected,
    history,
    keyword,
    statuses,
    page,
    pageSize,
    total,
    pageCount,
    loading,
    detailOpen,
    chooserOpen,
    chooserNodes,
    errorMessage,
    positionedNodes,
    nodeMap,
    can,
    query,
    open,
    openRoot,
    processCurrent,
    chooseNode,
    changePage,
    openDocument,
  }
}
