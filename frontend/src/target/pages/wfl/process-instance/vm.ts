import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import type { ApprovalStatus, VouEntity } from '@zerp/model'

import {
  actionTargetWflInstance,
  getTargetWflInstance,
  queryTargetWflInstances,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { createTargetId } from '../../../warehouse-drafts.ts'

export type WflNodeAction =
  | 'OPEN_DOCUMENT'
  | 'CREATE_CHILD'
  | 'APPROVE_CHILD'
  | 'REJECT_CHILD'
  | 'RETRY_CHILD'
  | 'CANCEL_CHILD'

export interface WflProcessNode {
  nodeId: string
  nodeKey: string
  nodeName: string
  documentId: string | null
  documentNo: string | null
  entity: VouEntity | null
  submissionId: string | null
  status: ApprovalStatus | null
  revision: string | null
  parentNodeId: string | null
  relation: string | null
  createdAt: string
  availableActions: WflNodeAction[]
}
export interface WflAvailableTarget {
  parentNodeId: string
  targetNodeKey: string
  targetNodeName: string
  targetEntity: VouEntity
  relation: string
  actionName: string
  initial: unknown
}

export interface WflProcessInstance {
  processId: string
  definitionSubjectId: string
  approvalEntryId: string
  definitionCode: string
  definitionName: string
  rootDocumentId: string
  rootDocumentNo: string
  rootEntity: VouEntity
  createdAt: string
  nodes: WflProcessNode[]
  availableTargets: WflAvailableTarget[]
}

export interface WflInstancePage {
  items: WflProcessInstance[]
  total: number
  page: number
  pageSize: number
}

export interface WflInstanceQueryInput {
  page: number
  pageSize: 20
  code?: string
  keyword?: string
}

export interface WflInstanceActionInput {
  processId: string
  nodeId: string
  action: WflNodeAction
  targetNodeKey?: string
  requestKey?: string
  expectedRevision?: string
  reason?: string
}

export interface WflProcessInstanceContext {
  csrfToken: string
  permissions: readonly string[]
  definitionCode?: string
}

export interface WflProcessInstancePorts {
  query(
    csrfToken: string,
    input: WflInstanceQueryInput,
  ): Promise<WflInstancePage>
  get(csrfToken: string, processId: string): Promise<WflProcessInstance>
  action(
    csrfToken: string,
    input: WflInstanceActionInput,
  ): Promise<WflProcessInstance>
  requestKey(): string
  openDocument(entity: VouEntity, documentId: string): Promise<void> | void
}

const actionPermissions: Record<WflNodeAction, string> = {
  OPEN_DOCUMENT: '/wfl/process-instance/open-document',
  CREATE_CHILD: '/wfl/process-instance/create-child',
  APPROVE_CHILD: '/wfl/process-instance/approve-child',
  REJECT_CHILD: '/wfl/process-instance/reject-child',
  RETRY_CHILD: '/wfl/process-instance/retry-child',
  CANCEL_CHILD: '/wfl/process-instance/cancel-child',
}

export function wflNodeActionLabel(action: WflNodeAction): string {
  return {
    OPEN_DOCUMENT: '打开单据',
    CREATE_CHILD: '创建下级',
    APPROVE_CHILD: '批准下级',
    REJECT_CHILD: '驳回下级',
    RETRY_CHILD: '重试下级',
    CANCEL_CHILD: '取消下级',
  }[action]
}

export function createWflProcessInstanceViewModel(
  context: WflProcessInstanceContext,
  ports: WflProcessInstancePorts,
) {
  const definitionCode = ref(context.definitionCode)
  const items = ref<WflProcessInstance[]>([])
  const total = ref(0)
  const page = ref(1)
  const keyword = ref('')
  const selected = ref<WflProcessInstance | null>(null)
  const availableTargets = ref<WflAvailableTarget[]>([])
  const selectedTarget = ref<WflAvailableTarget | null>(null)
  const reason = ref('')
  const detailOpen = ref(false)
  const queryLoading = ref(false)
  const detailLoading = ref(false)
  const loading = computed(() => queryLoading.value || detailLoading.value)
  const acting = ref(false)
  const error = ref<string | null>(null)
  let queryVersion = 0
  let detailVersion = 0
  let selectionVersion = 0
  let actionVersion = 0
  let createChildIntent: {
    nodeId: string
    targetNodeKey: string
    requestKey: string
  } | null = null

  const canQuery = computed(() =>
    context.permissions.includes('/wfl/process-instance/query'),
  )
  const canGet = computed(() =>
    context.permissions.includes('/wfl/process-instance/get'),
  )

  async function query(nextPage = page.value): Promise<void> {
    if (!canQuery.value) return
    const version = ++queryVersion
    const code = definitionCode.value
    queryLoading.value = true
    const search = keyword.value.trim()
    try {
      const result = await ports.query(context.csrfToken, {
        page: nextPage,
        pageSize: 20,
        ...(code ? { code } : {}),
        ...(search ? { keyword: search } : {}),
      })
      if (version !== queryVersion) return
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, '流程实例查询失败。')
    } finally {
      if (version === queryVersion) queryLoading.value = false
    }
  }

  async function switchDefinition(code?: string): Promise<void> {
    if (code === definitionCode.value) return
    definitionCode.value = code
    queryVersion += 1
    detailVersion += 1
    selectionVersion += 1
    actionVersion += 1
    queryLoading.value = false
    detailLoading.value = false
    acting.value = false
    items.value = []
    total.value = 0
    page.value = 1
    selected.value = null
    availableTargets.value = []
    selectedTarget.value = null
    createChildIntent = null
    reason.value = ''
    detailOpen.value = false
    error.value = null
    await query(1)
  }

  async function open(item: WflProcessInstance): Promise<void> {
    if (!canGet.value) {
      error.value = '没有权限查看流程实例。'
      return
    }
    const request = ++detailVersion
    const selection = ++selectionVersion
    detailLoading.value = true
    try {
      const detail = await ports.get(context.csrfToken, item.processId)
      if (
        request !== detailVersion ||
        selection !== selectionVersion ||
        (definitionCode.value && detail.definitionCode !== definitionCode.value)
      )
        return
      selected.value = detail
      availableTargets.value = [...detail.availableTargets]
      selectedTarget.value = null
      createChildIntent = null
      reason.value = ''
      detailOpen.value = true
      error.value = null
    } catch (cause) {
      if (request === detailVersion && selection === selectionVersion)
        error.value = errorMessage(cause, '流程实例详情加载失败。')
    } finally {
      if (request === detailVersion) detailLoading.value = false
    }
  }

  function canRun(node: WflProcessNode, action: WflNodeAction): boolean {
    const currentNode = selected.value?.nodes.find(
      (candidate) => candidate.nodeId === node.nodeId,
    )
    return (
      currentNode?.availableActions.includes(action) === true &&
      context.permissions.includes(actionPermissions[action])
    )
  }

  async function runAction(
    node: WflProcessNode,
    action: WflNodeAction,
  ): Promise<void> {
    const process = selected.value
    const currentNode = process?.nodes.find(
      (candidate) => candidate.nodeId === node.nodeId,
    )
    if (!process || !currentNode || !canRun(currentNode, action)) return
    const target = selectedTarget.value
      ? process.availableTargets.find(
          (candidate) =>
            candidate.parentNodeId === currentNode.nodeId &&
            candidate.targetNodeKey === selectedTarget.value?.targetNodeKey,
        )
      : null
    const submittedReason = reason.value.trim()
    if (action === 'CREATE_CHILD' && !target) {
      error.value = '请选择要创建的下级单据。'
      return
    }
    if (
      action === 'CREATE_CHILD' &&
      target &&
      (createChildIntent?.nodeId !== currentNode.nodeId ||
        createChildIntent.targetNodeKey !== target.targetNodeKey)
    )
      createChildIntent = {
        nodeId: currentNode.nodeId,
        targetNodeKey: target.targetNodeKey,
        requestKey: ports.requestKey(),
      }
    const request = createChildIntent?.requestKey ?? ''
    if (
      action === 'CREATE_CHILD' &&
      (request.length < 16 || request.length > 64)
    ) {
      error.value = '无法生成有效的下级单据请求键。'
      return
    }
    if (
      (action === 'REJECT_CHILD' || action === 'CANCEL_CHILD') &&
      !submittedReason
    ) {
      error.value = '请填写操作原因。'
      return
    }
    acting.value = true
    error.value = null
    const actionRequest = ++actionVersion
    const selection = selectionVersion
    const code = definitionCode.value
    const input: WflInstanceActionInput = {
      processId: process.processId,
      nodeId: currentNode.nodeId,
      action,
      ...(action === 'CREATE_CHILD' && target
        ? { targetNodeKey: target.targetNodeKey, requestKey: request }
        : {}),
      ...(currentNode.revision && action !== 'OPEN_DOCUMENT'
        ? { expectedRevision: currentNode.revision }
        : {}),
      ...(submittedReason &&
      (action === 'REJECT_CHILD' || action === 'CANCEL_CHILD')
        ? { reason: submittedReason }
        : {}),
    }
    try {
      const detail = await ports.action(context.csrfToken, input)
      if (
        actionRequest !== actionVersion ||
        selection !== selectionVersion ||
        code !== definitionCode.value
      )
        return
      selected.value = detail
      availableTargets.value = [...detail.availableTargets]
      selectedTarget.value = null
      reason.value = ''
      if (action === 'CREATE_CHILD') createChildIntent = null
      if (action === 'OPEN_DOCUMENT') {
        const returnedNode = detail.nodes.find(
          (candidate) => candidate.nodeId === currentNode.nodeId,
        )
        if (!returnedNode?.entity || !returnedNode.documentId)
          throw new Error('服务器未返回可打开的单据。')
        await ports.openDocument(returnedNode.entity, returnedNode.documentId)
      }
    } catch (cause) {
      if (
        actionRequest !== actionVersion ||
        selection !== selectionVersion ||
        code !== definitionCode.value
      )
        return
      const failure = errorMessage(cause, '流程动作执行失败。')
      try {
        const refreshed = await ports.get(context.csrfToken, process.processId)
        if (
          actionRequest === actionVersion &&
          selection === selectionVersion &&
          code === definitionCode.value
        ) {
          selected.value = refreshed
          availableTargets.value = [...refreshed.availableTargets]
          selectedTarget.value = null
          reason.value = ''
        }
      } catch {
        // Keep the original action failure: it is the relevant server fact.
      }
      if (
        actionRequest === actionVersion &&
        selection === selectionVersion &&
        code === definitionCode.value
      )
        error.value = failure
    } finally {
      if (actionRequest === actionVersion) acting.value = false
    }
  }

  function targetsFor(node: WflProcessNode): WflAvailableTarget[] {
    return availableTargets.value.filter(
      (target) => target.parentNodeId === node.nodeId,
    )
  }

  return {
    definitionCode,
    items,
    total,
    page,
    keyword,
    selected,
    availableTargets,
    selectedTarget,
    reason,
    detailOpen,
    loading,
    acting,
    error,
    canQuery,
    canGet,
    query,
    switchDefinition,
    open,
    canRun,
    runAction,
    targetsFor,
  }
}

export function useWflProcessInstanceViewModel(definitionCode?: string) {
  const session = useTargetSession()
  const router = useRouter()
  if (!session.csrfToken)
    throw new Error('WFL instance page requires an authenticated session.')
  return createWflProcessInstanceViewModel(
    {
      csrfToken: session.csrfToken,
      permissions: session.permissions,
      ...(definitionCode ? { definitionCode } : {}),
    },
    {
      query: queryTargetWflInstances,
      get: async (csrfToken, processId) =>
        getTargetWflInstance(csrfToken, processId),
      action: (csrfToken, input) =>
        actionTargetWflInstance(csrfToken, { ...input }),
      requestKey: createTargetId,
      openDocument: async (entity, documentId) => {
        await router.push(vouDocumentLocation(entity, documentId))
      },
    },
  )
}

export function vouDocumentLocation(entity: VouEntity, documentId: string) {
  return {
    path: `/vou/${entity}`,
    query: { documentId, mode: 'view' },
  } as const
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
