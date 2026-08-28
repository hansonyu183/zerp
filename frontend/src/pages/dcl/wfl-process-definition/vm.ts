import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import type { ApprovalStatus } from '@/api/generated'
import { ApiError, getErrorMessage } from '@/api/types'
import { documentEntityText } from '@/components/wfl/config'
import {
  type ApprovalAction,
  visibleApprovalActions,
} from '@/shared/approval'
import { useSessionStore } from '@/stores/session'
import {
  approveDclWflProcessDefinition,
  createDclWflProcessDefinition,
  createNextDclWflProcessDefinitionVersion,
  deleteDclWflProcessDefinitionVersion,
  getDclWflProcessDefinition,
  getDclWflProcessDefinitionAuditHistory,
  getDclWflProcessDefinitionVersions,
  queryDclWflProcessDefinitions,
  rejectDclWflProcessDefinition,
  saveDclWflProcessDefinition,
  setDclWflProcessDefinitionEnabled,
  submitDclWflProcessDefinition,
  trialWflProcessDefinition,
  unapproveDclWflProcessDefinition,
  unsubmitDclWflProcessDefinition,
  type DclWflProcessDefinition,
  type DclWflProcessDefinitionAuditEvent,
  type DclWflProcessDefinitionListItem,
  type DclWflProcessDefinitionVersionView,
  type VouEntity,
  type WflDefinitionDiagnostic,
  type WflDefinitionTrialResult,
} from './api'

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

const actions = [
  'query',
  'get',
  'create',
  'save',
  'submit',
  'unsubmit',
  'reject',
  'approve',
  'unapprove',
  'create-next',
  'delete-version',
  'enable',
  'disable',
  'versions',
  'audit-history',
  'trial',
] as const

function diagnosticFromString(diagnostic?: string): WflDefinitionDiagnostic | null {
  if (!diagnostic) return null
  const location = /workflow\.star:(\d+):(\d+)/u.exec(diagnostic)
  return {
    message: diagnostic,
    line: Number(location?.[1] ?? 1),
    column: Number(location?.[2] ?? 1),
  }
}

function diagnosticFromError(error: unknown): WflDefinitionDiagnostic | null {
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

export function createDclWflProcessDefinitionViewModel() {
  const session = useSessionStore()
  const rows = ref<DclWflProcessDefinitionListItem[]>([])
  const selected = ref<DclWflProcessDefinition | null>(null)
  const versions = ref<DclWflProcessDefinitionVersionView[]>([])
  const auditEvents = ref<DclWflProcessDefinitionAuditEvent[]>([])
  const keyword = ref('')
  const status = ref<ApprovalStatus[]>([])
  const includeDisabled = ref(true)
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const loading = ref(false)
  const saving = ref(false)
  const trialing = ref(false)
  const editorOpen = ref(false)
  const versionsOpen = ref(false)
  const auditOpen = ref(false)
  const errorMessage = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const reason = ref('')
  const scriptText = ref(DEFAULT_STARLARK_SCRIPT)
  const scriptDiagnostic = ref<WflDefinitionDiagnostic | null>(null)
  const trialEntity = ref<VouEntity | ''>('')
  const trialEntityText = computed(() => documentEntityText(trialEntity.value))
  const trialEntityItems = computed(() =>
    (selected.value?.nodes ?? []).map((node) => ({
      title: documentEntityText(node.documentEntity),
      value: node.documentEntity,
    })),
  )
  const trialDocumentId = ref('')
  const trialResult = ref<WflDefinitionTrialResult | null>(null)

  const permissions = computed(() => {
    const granted = Object.fromEntries(
      actions.map((action) => [
        action,
        action === 'trial'
          ? session.can('/wfl/process-definition/trial')
          : session.can(`/dcl/wfl-process-definition/${action}`),
      ]),
    ) as Record<(typeof actions)[number], boolean>
    const canReload = granted.get && granted.query
    for (const action of [
      'create',
      'save',
      'submit',
      'unsubmit',
      'reject',
      'approve',
      'unapprove',
      'create-next',
      'enable',
      'disable',
    ] as const) {
      granted[action] = granted[action] && canReload
    }
    granted['delete-version'] = granted['delete-version'] && granted.query
    return granted
  })

  const nodeMap = computed(
    () =>
      new Map(
        (selected.value?.nodes ?? []).map((node) => [node.key, node]),
      ),
  )

  const lifecycleActions = computed<ApprovalAction[]>(() => {
    const definition = selected.value
    if (!definition || !session.user) return []
    return visibleApprovalActions(definition.approval, session.user.id, (action) =>
      permissions.value[action],
    )
  })

  let sequence = 0
  let active = true
  if (getCurrentScope()) {
    onScopeDispose(() => {
      active = false
      sequence += 1
    })
  }

  function applyDefinition(definition: DclWflProcessDefinition): void {
    selected.value = definition
    scriptText.value = definition.script
    scriptDiagnostic.value = definition.diagnostic ?? null
    trialEntity.value = definition.nodes[0]?.documentEntity ?? ''
    trialDocumentId.value = ''
    trialResult.value = null
  }

  function resetEditor(): void {
    selected.value = null
    scriptText.value = DEFAULT_STARLARK_SCRIPT
    scriptDiagnostic.value = null
    trialEntity.value = ''
    trialDocumentId.value = ''
    trialResult.value = null
    reason.value = ''
  }

  async function query(): Promise<void> {
    if (!permissions.value.query) return
    const current = ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const result = await queryDclWflProcessDefinitions({
        keyword: keyword.value.trim(),
        status: status.value,
        includeDisabled: includeDisabled.value,
        page: page.value,
        pageSize: pageSize.value,
      })
      if (!active || current !== sequence) return
      rows.value = result.data.items ?? []
      total.value = result.data.total ?? 0
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  async function openCreate(): Promise<void> {
    if (!permissions.value.create) return
    resetEditor()
    editorOpen.value = true
  }

  async function openDefinition(
    item: DclWflProcessDefinitionListItem,
    approvalEntryId?: string,
  ): Promise<void> {
    if (!permissions.value.get) return
    const current = ++sequence
    loading.value = true
    errorMessage.value = null
    try {
      const targetEntry =
        approvalEntryId ??
        item.openVersion?.approval.approvalEntryId ??
        item.latestApproved?.approval.approvalEntryId
      const result = await getDclWflProcessDefinition(
        item.code,
        targetEntry,
      )
      if (!active || current !== sequence) return
      applyDefinition(result.data)
      editorOpen.value = true
    } catch (error) {
      if (active && current === sequence)
        errorMessage.value = getErrorMessage(error)
    } finally {
      if (active && current === sequence) loading.value = false
    }
  }

  async function openByTarget(
    code: string,
    approvalEntryId?: string,
  ): Promise<void> {
    const item = rows.value.find((row) => row.code === code)
    if (item) await openDefinition(item, approvalEntryId)
  }

  async function resetFilters(): Promise<void> {
    keyword.value = ''
    status.value = []
    includeDisabled.value = true
    page.value = 1
    await query()
  }

  async function changePage(nextPage: number): Promise<void> {
    page.value = nextPage
    await query()
  }

  async function save(): Promise<void> {
    saving.value = true
    errorMessage.value = null
    scriptDiagnostic.value = null
    try {
      if (selected.value) {
        if (
          !permissions.value.save ||
          selected.value.approval.status !== 'DRAFT'
        )
          return
        const result = await saveDclWflProcessDefinition({
          code: selected.value.code,
          approvalEntryId: selected.value.approval.approvalEntryId,
          approvalRevision: selected.value.approval.revision,
          script: scriptText.value,
        })
        if (!active) return
        const refreshed = await getDclWflProcessDefinition(
          result.data.code,
          result.data.approval.approvalEntryId,
        )
        if (!active) return
        applyDefinition(refreshed.data)
        successMessage.value = '流程定义草稿已保存。'
      } else {
        if (!permissions.value.create) return
        const result = await createDclWflProcessDefinition(scriptText.value)
        if (!active) return
        const refreshed = await getDclWflProcessDefinition(
          result.data.code,
          result.data.approval.approvalEntryId,
        )
        if (!active) return
        applyDefinition(refreshed.data)
        successMessage.value = '流程定义已创建。'
      }
      await query()
    } catch (error) {
      scriptDiagnostic.value = diagnosticFromError(error)
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function run(
    action:
      | 'submit'
      | 'unsubmit'
      | 'reject'
      | 'approve'
      | 'unapprove'
      | 'create-next'
      | 'delete-version',
  ): Promise<void> {
    const definition = selected.value
    if (!definition || !permissions.value[action]) return
    const requiresReason = action === 'reject' || action === 'unapprove'
    if (requiresReason && !reason.value.trim()) {
      errorMessage.value = '请填写审核意见。'
      return
    }
    saving.value = true
    errorMessage.value = null
    try {
      let result: { data: { code: string; approval: { approvalEntryId: string } } } | null = null
      switch (action) {
        case 'submit':
          result = await submitDclWflProcessDefinition(definition)
          break
        case 'unsubmit':
          result = await unsubmitDclWflProcessDefinition(definition)
          break
        case 'reject':
          result = await rejectDclWflProcessDefinition(
            definition,
            reason.value.trim(),
          )
          break
        case 'approve':
          result = await approveDclWflProcessDefinition(definition)
          break
        case 'unapprove':
          result = await unapproveDclWflProcessDefinition(
            definition,
            reason.value.trim(),
          )
          break
        case 'create-next':
          result = await createNextDclWflProcessDefinitionVersion(definition)
          break
        case 'delete-version':
          await deleteDclWflProcessDefinitionVersion(definition)
          if (!active) return
          successMessage.value = '流程定义版本已删除。'
          editorOpen.value = false
          selected.value = null
          await query()
          return
      }
      if (!active) return
      reason.value = ''
      if (result) {
        const refreshed = await getDclWflProcessDefinition(
          result.data.code,
          result.data.approval.approvalEntryId,
        )
        if (!active) return
        applyDefinition(refreshed.data)
      }
      successMessage.value = '流程定义操作已完成。'
      await query()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function changeEnabled(enabled: boolean): Promise<void> {
    if (!selected.value || !permissions.value[enabled ? 'enable' : 'disable'])
      return
    saving.value = true
    errorMessage.value = null
    try {
      const result = await setDclWflProcessDefinitionEnabled(
        selected.value.code,
        selected.value.revision,
        enabled,
      )
      if (!active) return
      const refreshed = await getDclWflProcessDefinition(
        result.data.code,
        result.data.approval.approvalEntryId,
      )
      if (!active) return
      applyDefinition(refreshed.data)
      successMessage.value = enabled ? '流程已启用。' : '流程已停用。'
      await query()
    } catch (error) {
      if (active) errorMessage.value = getErrorMessage(error)
    } finally {
      if (active) saving.value = false
    }
  }

  async function trial(): Promise<void> {
    const definition = selected.value
    if (!definition?.definitionId || !permissions.value.trial) return
    if (definition.approval.status !== 'DRAFT') return
    const entity = trialEntity.value
    if (!entity || !trialDocumentId.value.trim()) {
      errorMessage.value = '请选择源单据类型并填写已有单据 ID。'
      return
    }
    trialing.value = true
    errorMessage.value = null
    trialResult.value = null
    try {
      const { data } = await trialWflProcessDefinition({
        definitionId: definition.definitionId,
        approvalEntryId: definition.approval.approvalEntryId,
        revision: definition.approval.revision,
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

  async function loadVersions(): Promise<void> {
    if (!selected.value || !permissions.value.versions) return
    try {
      const result = await getDclWflProcessDefinitionVersions(
        selected.value.code,
      )
      versions.value = result.data.items ?? []
      versionsOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  async function loadAudit(): Promise<void> {
    if (!selected.value || !permissions.value['audit-history']) return
    try {
      const result = await getDclWflProcessDefinitionAuditHistory(
        selected.value.code,
      )
      auditEvents.value = result.data.items ?? []
      auditOpen.value = true
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    }
  }

  return {
    rows,
    selected,
    versions,
    auditEvents,
    keyword,
    status,
    includeDisabled,
    page,
    pageSize,
    total,
    loading,
    saving,
    trialing,
    editorOpen,
    versionsOpen,
    auditOpen,
    errorMessage,
    successMessage,
    reason,
    scriptText,
    scriptDiagnostic,
    trialEntity,
    trialEntityText,
    trialEntityItems,
    trialDocumentId,
    trialResult,
    permissions,
    nodeMap,
    lifecycleActions,
    query,
    openCreate,
    openDefinition,
    openByTarget,
    resetFilters,
    changePage,
    save,
    run,
    changeEnabled,
    trial,
    loadVersions,
    loadAudit,
  }
}
