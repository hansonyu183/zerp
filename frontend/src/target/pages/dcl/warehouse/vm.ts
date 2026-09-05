import { ref, reactive } from 'vue'

import type { ApprovalAction, ApprovalStatus } from '@zerp/model'

import {
  deleteTargetWarehouseSubmission,
  getTargetWarehouse,
  queryTargetBobReference,
  queryTargetWarehouses,
  reviewTargetWarehouse,
  submitTargetWarehouse,
  targetWarehouseAuditHistory,
  targetWarehouseManagerReference,
  targetWarehouseVersions,
} from '../../../api.ts'
import { useTargetSession } from '../../../session/vm.ts'
import type { WarehouseDraft } from '../../../warehouse-drafts.ts'
import {
  createWarehouseDraft,
  WarehouseDraftRepository,
} from '../../../warehouse-drafts.ts'
import type { DclWorkbenchDeepLink } from '../shared/vm.ts'

export interface WarehouseSubmission {
  subjectId: string
  code: string
  submissionId: string
  versionNo: number
  status: ApprovalStatus
  revision: string
  snapshot: {
    name: string
    address: string | null
    contactName: string | null
    contactPhone: string | null
    managerEmployeeId: string | null
    managerEmployeeApprovalEntryId: string | null
    managerEmployeeCode: string | null
    managerEmployeeName: string | null
    remark: string | null
    enabled: boolean
  }
  availableApprovalActions: ApprovalAction[]
  canDelete: boolean
}

export type WarehouseSubmissionListItem = Omit<WarehouseSubmission, 'snapshot'>

export interface WarehouseQueryItem {
  entity: 'warehouse'
  subjectId: string
  code: string
  name: string
  enabled: boolean
  managerName: string | null
  latestApproved: WarehouseSubmissionListItem | null
  openCandidate: WarehouseSubmissionListItem | null
}

export interface WarehouseQueryInput {
  page: number
  pageSize: 20
  filters: {
    keyword?: string
    status?: ApprovalStatus
    enabled?: boolean
  }
}

export interface WarehouseSubmitRequest {
  subjectId: string
  submissionId: string
  idempotencyKey: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
  snapshot: WarehouseSubmission['snapshot']
}

export interface WarehouseActionRequest {
  subjectId: string
  submissionId: string
  expectedRevision: string
  reason?: string
}

export interface WarehouseManagerCandidate {
  objectId: string
  approvalEntryId: string
  code: string
  name: string
}

export interface WarehouseViewModelContext {
  ownerUserId: string
  csrfToken: string
  permissions: readonly string[]
}

export interface WarehouseViewModelPorts {
  drafts: {
    list(ownerUserId: string): Promise<WarehouseDraft[]>
    save(draft: WarehouseDraft): Promise<void>
    delete(ownerUserId: string, draftId: string): Promise<void>
  }
  api: {
    query(
      csrfToken: string,
      input: WarehouseQueryInput,
    ): Promise<{
      items: WarehouseQueryItem[]
      total: number
      page: number
      pageSize: 20
    }>
    get(csrfToken: string, subjectId: string): Promise<WarehouseSubmission>
    versions(
      csrfToken: string,
      subjectId: string,
    ): Promise<{ items: WarehouseSubmission[]; total: number }>
    audit(csrfToken: string, subjectId: string): Promise<unknown>
    managerReference(
      csrfToken: string,
      employeeId: string,
      action: 'submit-new' | 'submit-change',
    ): Promise<unknown>
    managerCandidates(csrfToken: string): Promise<WarehouseManagerCandidate[]>
    submit(
      csrfToken: string,
      mode: WarehouseDraft['mode'],
      input: WarehouseSubmitRequest,
    ): Promise<WarehouseSubmission>
    review(
      csrfToken: string,
      action: ApprovalAction,
      input: WarehouseActionRequest,
    ): Promise<WarehouseSubmission>
    deleteSubmission(
      csrfToken: string,
      input: Omit<WarehouseActionRequest, 'reason'>,
    ): Promise<unknown>
  }
  now(): string
}

export function createWarehouseViewModel(
  context: WarehouseViewModelContext,
  ports: WarehouseViewModelPorts,
) {
  const filters = reactive({
    keyword: '',
    status: '' as '' | ApprovalStatus,
    enabled: '' as '' | 'true' | 'false',
  })
  const subjects = ref<WarehouseQueryItem[]>([])
  const drafts = ref<WarehouseDraft[]>([])
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const saving = ref(false)
  const message = ref('')
  const error = ref('')
  const history = ref<{
    detail: WarehouseSubmission
    versions: WarehouseSubmission[]
    audit: unknown
  } | null>(null)
  const reason = ref('')
  const managerCandidates = ref<WarehouseManagerCandidate[]>([])
  const canCreate = context.permissions.includes('/dcl/warehouse/submit-new')
  let queryVersion = 0
  let historyVersion = 0
  let managerReferenceVersion = 0
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const saveQueues = new Map<string, Promise<void>>()

  function queryInput(nextPage: number): WarehouseQueryInput {
    return {
      page: nextPage,
      pageSize: 20,
      filters: {
        ...(filters.keyword.trim() ? { keyword: filters.keyword.trim() } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.enabled ? { enabled: filters.enabled === 'true' } : {}),
      },
    }
  }

  async function query(nextPage = page.value): Promise<void> {
    const version = ++queryVersion
    loading.value = true
    try {
      const result = await ports.api.query(
        context.csrfToken,
        queryInput(nextPage),
      )
      if (version !== queryVersion) return
      subjects.value = result.items
      total.value = result.total
      page.value = nextPage
      error.value = ''
    } catch (cause) {
      if (version === queryVersion)
        error.value = cause instanceof Error ? cause.message : '仓库查询失败。'
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function loadDrafts(): Promise<void> {
    drafts.value = await ports.drafts.list(context.ownerUserId)
  }

  async function loadManagerCandidates(): Promise<void> {
    if (!context.permissions.includes('/bob/reference/query')) return
    const version = ++managerReferenceVersion
    try {
      const candidates = await ports.api.managerCandidates(context.csrfToken)
      if (version === managerReferenceVersion)
        managerCandidates.value = candidates
    } catch (cause) {
      if (version === managerReferenceVersion)
        error.value = errorMessage(cause, '仓库负责人候选加载失败。')
    }
  }

  function selectManager(
    draft: WarehouseDraft,
    candidate: WarehouseManagerCandidate | null,
  ): void {
    draft.snapshot.managerEmployeeId = candidate?.objectId ?? ''
    draft.snapshot.managerEmployeeApprovalEntryId =
      candidate?.approvalEntryId ?? ''
    draft.snapshot.managerEmployeeCode = candidate?.code ?? ''
    draft.snapshot.managerEmployeeName = candidate?.name ?? ''
    scheduleSave(draft)
  }

  async function persistDraft(draft: WarehouseDraft): Promise<void> {
    draft.updatedAt = ports.now()
    const previous = saveQueues.get(draft.draftId) ?? Promise.resolve()
    const next = previous.then(() => ports.drafts.save(draft))
    saveQueues.set(draft.draftId, next)
    try {
      await next
      message.value = '草稿已保存在当前设备。'
    } finally {
      if (saveQueues.get(draft.draftId) === next)
        saveQueues.delete(draft.draftId)
    }
  }

  function scheduleSave(draft: WarehouseDraft): void {
    const pending = saveTimers.get(draft.draftId)
    if (pending) clearTimeout(pending)
    saveTimers.set(
      draft.draftId,
      setTimeout(() => {
        saveTimers.delete(draft.draftId)
        void persistDraft(draft).catch((cause) => {
          error.value = errorMessage(cause, '本地草稿保存失败。')
        })
      }, 300),
    )
  }

  async function flushSave(draft: WarehouseDraft): Promise<void> {
    const pending = saveTimers.get(draft.draftId)
    if (pending) {
      clearTimeout(pending)
      saveTimers.delete(draft.draftId)
      await persistDraft(draft)
      return
    }
    await saveQueues.get(draft.draftId)
  }

  async function newDraft(): Promise<void> {
    if (!canCreate) {
      error.value = '无权新建仓库草稿。'
      return
    }
    const draft = createWarehouseDraft(context.ownerUserId)
    await ports.drafts.save(draft)
    await loadDrafts()
    message.value = '已创建仅保存在当前设备的仓库草稿。'
  }

  async function deleteDraft(draft: WarehouseDraft): Promise<void> {
    const timer = saveTimers.get(draft.draftId)
    if (timer) clearTimeout(timer)
    saveTimers.delete(draft.draftId)
    await ports.drafts.delete(draft.ownerUserId, draft.draftId)
    drafts.value = drafts.value.filter(
      (candidate) => candidate.draftId !== draft.draftId,
    )
    message.value = '本地草稿已删除，未发送服务器请求。'
  }

  async function submitDraft(draft: WarehouseDraft): Promise<void> {
    if (
      !context.permissions.includes(
        `/dcl/warehouse/${
          draft.mode === 'NEW' ? 'submit-new' : 'submit-change'
        }`,
      )
    ) {
      error.value = '无权提交该仓库草稿。'
      return
    }
    saving.value = true
    error.value = ''
    try {
      await flushSave(draft)
      if (draft.snapshot.managerEmployeeId.trim()) {
        const manager = await ports.api.managerReference(
          context.csrfToken,
          draft.snapshot.managerEmployeeId.trim(),
          draft.mode === 'NEW' ? 'submit-new' : 'submit-change',
        )
        if (isRecord(manager)) {
          draft.snapshot.managerEmployeeApprovalEntryId = String(
            manager.latestApprovedEntryId ?? '',
          )
          draft.snapshot.managerEmployeeCode = String(manager.code ?? '')
          draft.snapshot.managerEmployeeName = String(manager.displayName ?? '')
        }
      }
      await ports.api.submit(context.csrfToken, draft.mode, {
        subjectId: draft.subjectId,
        submissionId: draft.submissionId,
        idempotencyKey: draft.idempotencyKey,
        expectedLatestApprovedSubmissionId:
          draft.expectedLatestApprovedSubmissionId,
        expectedLatestApprovedRevision: draft.expectedLatestApprovedRevision,
        snapshot: {
          name: draft.snapshot.name.trim(),
          address: nullable(draft.snapshot.address),
          contactName: nullable(draft.snapshot.contactName),
          contactPhone: nullable(draft.snapshot.contactPhone),
          managerEmployeeId: nullable(draft.snapshot.managerEmployeeId),
          managerEmployeeApprovalEntryId: nullable(
            draft.snapshot.managerEmployeeApprovalEntryId,
          ),
          managerEmployeeCode: nullable(draft.snapshot.managerEmployeeCode),
          managerEmployeeName: nullable(draft.snapshot.managerEmployeeName),
          remark: nullable(draft.snapshot.remark),
          enabled: draft.snapshot.enabled,
        },
      })
      await ports.drafts.delete(draft.ownerUserId, draft.draftId)
      drafts.value = drafts.value.filter(
        (candidate) => candidate.draftId !== draft.draftId,
      )
      if (context.permissions.includes('/dcl/warehouse/query'))
        await query(page.value)
      message.value = '仓库草稿已提交，状态以服务器返回为准。'
    } catch (cause) {
      error.value = errorMessage(cause, '仓库提交失败；本地草稿已保留。')
    } finally {
      saving.value = false
    }
  }

  async function cloneSubmission(
    item: WarehouseSubmissionListItem,
  ): Promise<void> {
    if (!canClone()) {
      error.value = '无权克隆仓库正式版本。'
      return
    }
    const versions = await ports.api.versions(context.csrfToken, item.subjectId)
    const approved = versions.items
      .filter((candidate) => candidate.status === 'APPROVED')
      .sort((left, right) => right.versionNo - left.versionNo)[0]
    const source =
      approved ??
      versions.items.find(
        (candidate) => candidate.submissionId === item.submissionId,
      )
    if (!source) throw new Error('仓库 Submission 已变化，请刷新后重试。')
    const draft = createWarehouseDraft(context.ownerUserId, {
      mode: approved ? 'CHANGE' : 'NEW',
      subjectId: item.subjectId,
      expectedLatestApprovedSubmissionId: approved?.submissionId ?? null,
      expectedLatestApprovedRevision: approved?.revision ?? null,
      snapshot: {
        ...source.snapshot,
        address: source.snapshot.address ?? '',
        contactName: source.snapshot.contactName ?? '',
        contactPhone: source.snapshot.contactPhone ?? '',
        managerEmployeeId: source.snapshot.managerEmployeeId ?? '',
        managerEmployeeApprovalEntryId:
          source.snapshot.managerEmployeeApprovalEntryId ?? '',
        managerEmployeeCode: source.snapshot.managerEmployeeCode ?? '',
        managerEmployeeName: source.snapshot.managerEmployeeName ?? '',
        remark: source.snapshot.remark ?? '',
      },
    })
    await ports.drafts.save(draft)
    await loadDrafts()
    message.value = '已从最新正式版本克隆本地草稿。'
  }

  function canClone(): boolean {
    return (
      context.permissions.includes('/dcl/warehouse/get') &&
      context.permissions.includes('/dcl/warehouse/submit-change')
    )
  }

  async function viewHistory(item: WarehouseSubmissionListItem): Promise<void> {
    const version = ++historyVersion
    const [detail, versions, audit] = await Promise.all([
      ports.api.get(context.csrfToken, item.subjectId),
      ports.api.versions(context.csrfToken, item.subjectId),
      ports.api.audit(context.csrfToken, item.subjectId),
    ])
    if (version === historyVersion)
      history.value = { detail, versions: versions.items, audit }
  }

  async function synchronizeDeepLink(
    deepLink: DclWorkbenchDeepLink,
  ): Promise<void> {
    const version = ++historyVersion
    const objectId = deepLink.objectId?.trim()
    const submissionId = deepLink.submissionId?.trim()
    const revision = deepLink.revision?.trim()
    if (!objectId && !submissionId && !revision && !deepLink.mode) {
      history.value = null
      return
    }
    if (
      !objectId ||
      !submissionId ||
      !revision ||
      (deepLink.mode !== 'view' && deepLink.mode !== 'edit')
    ) {
      error.value = '工作台深链缺少精确仓库版本上下文。'
      return
    }
    try {
      const [detail, versions, audit] = await Promise.all([
        ports.api.get(context.csrfToken, objectId),
        ports.api.versions(context.csrfToken, objectId),
        ports.api.audit(context.csrfToken, objectId),
      ])
      if (version !== historyVersion) return
      const exact = versions.items.find(
        (candidate) => candidate.submissionId === submissionId,
      )
      if (
        detail.subjectId !== objectId ||
        detail.submissionId !== submissionId ||
        detail.revision !== revision ||
        !exact ||
        exact.revision !== revision
      )
        throw new Error('工作台仓库版本已变化，请刷新工作台后重试。')
      if (deepLink.mode === 'edit') await cloneSubmission(exact)
      else history.value = { detail: exact, versions: versions.items, audit }
      error.value = ''
    } catch (cause) {
      if (version === historyVersion)
        error.value = errorMessage(cause, '工作台仓库深链加载失败。')
    }
  }

  async function review(
    item: WarehouseSubmissionListItem,
    action: ApprovalAction,
  ): Promise<void> {
    if (!item.availableApprovalActions.includes(action)) {
      error.value = '服务器未提供该审批动作，请刷新后重试。'
      return
    }
    const needsReason = action === 'reject' || action === 'unapprove'
    const submittedReason = reason.value.trim()
    if (needsReason && !submittedReason) {
      error.value = '请填写审批原因。'
      return
    }
    let actionError = ''
    try {
      await ports.api.review(context.csrfToken, action, {
        subjectId: item.subjectId,
        submissionId: item.submissionId,
        expectedRevision: item.revision,
        ...(needsReason ? { reason: submittedReason } : {}),
      })
      reason.value = ''
    } catch (cause) {
      actionError = errorMessage(cause, '审批动作失败。')
    }
    const historySubjectId = history.value?.detail.subjectId
    await query(page.value)
    if (historySubjectId === item.subjectId) await viewHistory(item)
    if (actionError) error.value = actionError
  }

  async function withdraw(item: WarehouseSubmissionListItem): Promise<void> {
    try {
      await ports.api.deleteSubmission(context.csrfToken, {
        subjectId: item.subjectId,
        submissionId: item.submissionId,
        expectedRevision: item.revision,
      })
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '撤回失败。')
      await query(page.value)
    }
  }

  return {
    filters,
    subjects,
    submissions: subjects,
    drafts,
    total,
    page,
    loading,
    saving,
    message,
    error,
    history,
    reason,
    managerCandidates,
    canCreate,
    query,
    loadDrafts,
    loadManagerCandidates,
    selectManager,
    newDraft,
    scheduleSave,
    flushSave,
    deleteDraft,
    submitDraft,
    cloneSubmission,
    canClone,
    viewHistory,
    synchronizeDeepLink,
    review,
    withdraw,
  }
}

export function useWarehouseViewModel() {
  const session = useTargetSession()
  if (!session.user || !session.csrfToken)
    throw new Error('Warehouse page requires an authenticated session.')
  const repository = new WarehouseDraftRepository()
  return createWarehouseViewModel(
    {
      ownerUserId: session.user.id,
      csrfToken: session.csrfToken,
      permissions: session.permissions,
    },
    {
      drafts: repository,
      api: {
        query: queryTargetWarehouses,
        get: getTargetWarehouse,
        versions: targetWarehouseVersions,
        audit: targetWarehouseAuditHistory,
        managerReference: targetWarehouseManagerReference,
        managerCandidates: (csrfToken) =>
          queryTargetBobReference(csrfToken, 'employee'),
        submit: submitTargetWarehouse,
        review: reviewTargetWarehouse,
        deleteSubmission: deleteTargetWarehouseSubmission,
      },
      now: () => new Date().toISOString(),
    },
  )
}

function nullable(value: string): string | null {
  const normalized = value.trim()
  return normalized ? normalized : null
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
