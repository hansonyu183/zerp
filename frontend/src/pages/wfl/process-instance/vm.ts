import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type { VoucherReference } from '@/components/voucher'
import { useSessionStore } from '@/stores/session'

export interface DocumentNodeReference {
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
  revision: number
  rootDocumentId: string
  rootDocumentNo: string
  rootEntity: string
  partyCode: string
  partyName: string
  updatedAt: string
}

export interface NodeInstance extends DocumentNodeReference {
  parentNodeInstanceId?: string
  nodeKey: string
  documentRevision: number
  businessDate: string
  businessParentEntity?: string
  businessParentDocumentId?: string
  relation?: string
  trigger: string
  action?: string
  evaluatedAt?: string
}

export interface AvailableTarget {
  parentNodeInstanceId: string
  targetNodeKey: string
  targetNodeName: string
  targetEntity: string
  relation: string
}

export interface InstanceView extends InstanceListItem {
  startedDefinitionRevision: number
  nodes: NodeInstance[]
  availableTargets: AvailableTarget[]
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
  const selectedParty = ref<VoucherReference | null>(null)
  const partyOptions = ref<VoucherReference[]>([])
  const partyLoading = ref(false)
  const partyError = ref<string | null>(null)
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const loading = ref(false)
  const detailOpen = ref(false)
  const errorMessage = ref<string | null>(null)
  const selectedNode = ref<NodeInstance | null>(null)
  const selectedTarget = ref<AvailableTarget | null>(null)
  const requestKey = ref('')
  const creatingChild = ref(false)
  let partySearchTimer: ReturnType<typeof setTimeout> | null = null
  let partySearchSequence = 0
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
      const { data } = await apiClient.postContract(
        `wfl/${processName.value}/query`,
        {
          page: page.value,
          pageSize: pageSize.value,
          ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
          ...(selectedParty.value
            ? { partyObjectId: selectedParty.value.objectId }
            : {}),
        },
      )
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

  function searchParty(keywordValue: string): void {
    if (partySearchTimer) clearTimeout(partySearchTimer)
    partySearchTimer = setTimeout(
      () => void loadPartyOptions(keywordValue),
      250,
    )
  }

  async function loadPartyOptions(keywordValue: string): Promise<void> {
    const entities = (['customer-account', 'supplier'] as const).filter(
      (entity) => session.can(`/bob/${entity}/query`),
    )
    if (entities.length === 0) {
      partyOptions.value = []
      partyError.value = '缺少客户或供应商查询权限。'
      return
    }
    const sequence = ++partySearchSequence
    partyLoading.value = true
    partyError.value = null
    try {
      const pages = await Promise.all(
        entities.map(async (entity) => {
          if (entity === 'customer-account') {
            const { data } = await apiClient.postContract(
              'bob/reference/query',
              {
                entity,
                ...(keywordValue.trim()
                  ? { keyword: keywordValue.trim() }
                  : {}),
              },
            )
            return data.map((item): VoucherReference => ({
              objectId: item.objectId,
              versionId: item.versionId,
              entity,
              code: item.code,
              name: item.name,
            }))
          }
          if (entity === 'supplier') {
            const { data } = await apiClient.postContract(
              'bob/reference/query',
              {
                entity,
                ...(keywordValue.trim()
                  ? { keyword: keywordValue.trim() }
                  : {}),
              },
            )
            return data.map((item): VoucherReference => ({ ...item, entity }))
          }
          return []
        }),
      )
      if (sequence === partySearchSequence) {
        const options = pages.flat()
        const selectedPartyOption = selectedParty.value
        partyOptions.value = selectedPartyOption
          ? [
              selectedPartyOption,
              ...options.filter(
                (option) => option.objectId !== selectedPartyOption.objectId,
              ),
            ]
          : options
      }
    } catch (error) {
      if (sequence === partySearchSequence) {
        partyError.value = getErrorMessage(error)
      }
    } finally {
      if (sequence === partySearchSequence) partyLoading.value = false
    }
  }

  async function resetFilters(): Promise<void> {
    keyword.value = ''
    selectedParty.value = null
    await query({ resetPage: true })
  }

  async function open(item: InstanceListItem): Promise<void> {
    if (!can('get')) return
    loading.value = true
    errorMessage.value = null
    try {
      const [detail, audit] = await Promise.all([
        apiClient.postContract(
          `wfl/${processName.value}/get`,
          { processId: item.processId },
        ),
        can('audit-history')
          ? apiClient.postContract(`wfl/${processName.value}/audit-history`, {
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
      selectedNode.value = detail.data.nodes[0] ?? null
      selectedTarget.value = null
      requestKey.value = ''
      history.value = audit.data.items ?? []
      detailOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      loading.value = false
    }
  }

  function selectNode(node: NodeInstance): void {
    selectedNode.value = node
    selectedTarget.value = null
  }

  const nodeTargets = computed(() => {
    const node = selectedNode.value
    if (!node) return []
    return (selected.value?.availableTargets ?? []).filter(
      (target) => target.parentNodeInstanceId === node.nodeInstanceId,
    )
  })

  async function createChild(): Promise<void> {
    const process = selected.value
    const target = selectedTarget.value
    if (!process || !target || !can('create-child')) return
    const key = requestKey.value.trim()
    if (key.length < 16 || key.length > 64) {
      errorMessage.value = '请求键必须为 16 至 64 个字符。'
      return
    }
    creatingChild.value = true
    errorMessage.value = null
    try {
      await apiClient.postContract(`wfl/${processName.value}/create-child`, {
        processId: process.processId,
        parentNodeInstanceId: target.parentNodeInstanceId,
        targetNodeKey: target.targetNodeKey,
        requestKey: key,
      })
      await open(process)
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      creatingChild.value = false
    }
  }

  function openDocument(node: DocumentNodeReference): void {
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

  async function changePage(value: number): Promise<void> {
    page.value = value
    await query()
  }

  watch(processName, () => {
    page.value = 1
    void query()
  })
  onMounted(() => void query())
  onBeforeUnmount(() => {
    if (partySearchTimer) clearTimeout(partySearchTimer)
  })

  return {
    processName,
    items,
    selected,
    history,
    keyword,
    selectedParty,
    partyOptions,
    partyLoading,
    partyError,
    page,
    pageSize,
    total,
    pageCount,
    loading,
    detailOpen,
    errorMessage,
    selectedNode,
    selectedTarget,
    requestKey,
    creatingChild,
    nodeTargets,
    positionedNodes,
    nodeMap,
    can,
    query,
    resetFilters,
    searchParty,
    open,
    openRoot,
    changePage,
    openDocument,
    selectNode,
    createChild,
  }
}
