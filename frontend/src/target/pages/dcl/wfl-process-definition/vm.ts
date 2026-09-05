import { computed, ref } from 'vue'

import type { ApprovalAction, ApprovalStatus, VouEntity } from '@zerp/model'

import {
  deleteTargetWflDefinition,
  getTargetWflDefinition,
  queryTargetWflDefinitions,
  queryTargetVou,
  reviewTargetWflDefinition,
  setTargetWflDefinitionEnabled,
  submitTargetWflDefinition,
  trialTargetWflDefinition,
} from '../../../api.ts'
import {
  TargetDraftRepository,
  type TargetDraftRecord,
} from '../../../draft-storage.ts'
import { useTargetSession } from '../../../session/vm.ts'
import { createTargetId } from '../../../warehouse-drafts.ts'
import type { DclWorkbenchDeepLink } from '../shared/vm.ts'

export interface WflDefinitionGraph {
  code: string
  name: string
  rootKey: string
  nodes: { key: string; name: string; entity: string }[]
  edges: {
    sourceKey: string
    targetKey: string
    actionName: string
    relation: string
  }[]
}

export interface WflDefinitionSubmission {
  subjectId: string
  code: string
  submissionId: string
  versionNo: number | null
  status: ApprovalStatus
  revision: string
  script: string
  compiledGraph: WflDefinitionGraph
  enabled: boolean
  runtimeRevision: string | null
  availableApprovalActions: readonly ApprovalAction[]
  availableRuntimeActions: ReadonlyArray<'enable' | 'disable'>
  canDelete: boolean
}

export interface WflDefinitionQueryItem {
  subjectId: string
  code: string
  latestApproved: WflDefinitionSubmission | null
  openCandidate: WflDefinitionSubmission | null
}

export interface WflDefinitionDraft extends TargetDraftRecord {
  entity: 'wfl-process-definition'
  mode: 'NEW' | 'CHANGE'
  subjectId: string
  submissionId: string
  idempotencyKey: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
  script: string
  trialDocument: { entity: VouEntity; documentId: string }
}

export interface WflTrialDocumentCandidate {
  documentId: string
  documentNo: string
  status: ApprovalStatus
}

export interface DclWflDefinitionContext {
  ownerUserId: string
  csrfToken: string
  permissions: readonly string[]
}

export interface DclWflDefinitionPorts {
  drafts: {
    list(
      ownerUserId: string,
      entity: 'wfl-process-definition',
    ): Promise<WflDefinitionDraft[]>
    save(draft: WflDefinitionDraft): Promise<void>
    delete(
      ownerUserId: string,
      entity: 'wfl-process-definition',
      draftId: string,
    ): Promise<void>
  }
  query(
    csrfToken: string,
    input: { page: number; pageSize: 20; keyword?: string },
  ): Promise<{
    items: WflDefinitionQueryItem[]
    total: number
    page: number
    pageSize: number
  }>
  get(csrfToken: string, subjectId: string): Promise<WflDefinitionSubmission>
  submit(
    csrfToken: string,
    mode: 'NEW' | 'CHANGE',
    input: Omit<
      WflDefinitionDraft,
      keyof TargetDraftRecord | 'entity' | 'mode'
    >,
  ): Promise<WflDefinitionSubmission>
  review(
    csrfToken: string,
    action: ApprovalAction,
    input: Record<string, string>,
  ): Promise<WflDefinitionSubmission>
  deleteSubmission(
    csrfToken: string,
    input: {
      subjectId: string
      submissionId: string
      expectedRevision: string
    },
  ): Promise<{ submissionId: string; deleted: true }>
  setEnabled(
    csrfToken: string,
    action: 'enable' | 'disable',
    input: {
      subjectId: string
      approvalEntryId: string
      expectedApprovalRevision: string
      expectedRuntimeRevision: string | null
    },
  ): Promise<{
    subjectId: string
    approvalEntryId: string
    enabled: boolean
    revision: string
  }>
  trial(
    csrfToken: string,
    input: {
      script: string
      document: { entity: VouEntity; documentId: string }
    },
  ): Promise<{
    graph: WflDefinitionGraph
    result: { ok: boolean; error?: string }
    payloadDigest: string
    actorId: string
  }>
  queryDocuments(
    csrfToken: string,
    entity: VouEntity,
  ): Promise<WflTrialDocumentCandidate[]>
  id(): string
  now(): string
}

export function createDclWflProcessDefinitionViewModel(
  context: DclWflDefinitionContext,
  ports: DclWflDefinitionPorts,
) {
  const drafts = ref<WflDefinitionDraft[]>([])
  const items = ref<WflDefinitionQueryItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const keyword = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)
  const reason = ref('')
  const trialGraph = ref<WflDefinitionGraph | null>(null)
  const trialDocuments = ref<WflTrialDocumentCandidate[]>([])
  const detail = ref<WflDefinitionSubmission | null>(null)
  let queryVersion = 0
  let trialDocumentVersion = 0
  let detailVersion = 0
  const canCreate = computed(() =>
    context.permissions.includes('/dcl/wfl-process-definition/submit-new'),
  )
  const canCreateChange = computed(() =>
    context.permissions.includes('/dcl/wfl-process-definition/submit-change'),
  )
  const canTrial = computed(() =>
    context.permissions.includes('/wfl/process-definition/trial'),
  )

  async function loadDrafts(): Promise<void> {
    drafts.value = await ports.drafts.list(
      context.ownerUserId,
      'wfl-process-definition',
    )
  }

  async function query(nextPage = page.value): Promise<void> {
    if (!context.permissions.includes('/dcl/wfl-process-definition/query'))
      return
    const version = ++queryVersion
    loading.value = true
    const search = keyword.value.trim()
    try {
      const result = await ports.query(context.csrfToken, {
        page: nextPage,
        pageSize: 20,
        ...(search ? { keyword: search } : {}),
      })
      if (version !== queryVersion) return
      items.value = result.items
      total.value = result.total
      page.value = result.page
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, '流程定义候选查询失败。')
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function newDraft(): Promise<void> {
    if (!canCreate.value) {
      error.value = '没有权限新建流程定义草稿。'
      return
    }
    const submissionId = ports.id()
    const draft: WflDefinitionDraft = {
      entity: 'wfl-process-definition',
      ownerUserId: context.ownerUserId,
      draftId: ports.id(),
      updatedAt: ports.now(),
      mode: 'NEW',
      subjectId: ports.id(),
      submissionId,
      idempotencyKey: submissionId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      script:
        'def process(document):\n  return {"code": "new-process", "name": "新流程", "rootKey": "root", "nodes": [], "edges": []}',
      trialDocument: { entity: 'purchase-order', documentId: '' },
    }
    await ports.drafts.save(draft)
    drafts.value = [draft, ...drafts.value]
  }

  async function saveDraft(draft: WflDefinitionDraft): Promise<void> {
    draft.updatedAt = ports.now()
    await ports.drafts.save(draft)
    message.value = '草稿已保存在当前设备。'
  }

  async function createChange(item: WflDefinitionQueryItem): Promise<void> {
    const approved = item.latestApproved
    if (
      !approved ||
      !context.permissions.includes('/dcl/wfl-process-definition/submit-change')
    ) {
      error.value = '只能基于已批准版本创建变更草稿。'
      return
    }
    const submissionId = ports.id()
    const draft: WflDefinitionDraft = {
      entity: 'wfl-process-definition',
      ownerUserId: context.ownerUserId,
      draftId: ports.id(),
      updatedAt: ports.now(),
      mode: 'CHANGE',
      subjectId: approved.subjectId,
      submissionId,
      idempotencyKey: submissionId,
      expectedLatestApprovedSubmissionId: approved.submissionId,
      expectedLatestApprovedRevision: approved.revision,
      script: approved.script,
      trialDocument: { entity: 'purchase-order', documentId: '' },
    }
    await ports.drafts.save(draft)
    drafts.value = [draft, ...drafts.value]
  }

  function validationError(draft: WflDefinitionDraft): string | null {
    if (!draft.script.trim()) return '请输入 Starlark 流程脚本。'
    if (draft.trialDocument.documentId.length !== 26)
      return '请选择 26 位试算单据 ID。'
    return null
  }

  function submitInput(draft: WflDefinitionDraft) {
    return {
      subjectId: draft.subjectId,
      submissionId: draft.submissionId,
      idempotencyKey: draft.idempotencyKey,
      expectedLatestApprovedSubmissionId:
        draft.expectedLatestApprovedSubmissionId,
      expectedLatestApprovedRevision: draft.expectedLatestApprovedRevision,
      script: draft.script,
      trialDocument: draft.trialDocument,
    }
  }

  async function submitDraft(draft: WflDefinitionDraft): Promise<void> {
    const permission = `/dcl/wfl-process-definition/submit-${draft.mode === 'NEW' ? 'new' : 'change'}`
    if (!context.permissions.includes(permission)) {
      error.value = '没有权限提交流程定义草稿。'
      return
    }
    const invalid = validationError(draft)
    if (invalid) {
      error.value = invalid
      return
    }
    saving.value = true
    try {
      await ports.drafts.save(draft)
      await ports.submit(context.csrfToken, draft.mode, submitInput(draft))
      await ports.drafts.delete(
        draft.ownerUserId,
        'wfl-process-definition',
        draft.draftId,
      )
      drafts.value = drafts.value.filter(
        (item) => item.draftId !== draft.draftId,
      )
      message.value = '流程定义已提交，状态以服务器返回为准。'
      error.value = null
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '提交失败；本地草稿已保留。')
    } finally {
      saving.value = false
    }
  }

  async function trialDraft(draft: WflDefinitionDraft): Promise<void> {
    if (!canTrial.value) {
      error.value = '没有权限试算流程定义。'
      return
    }
    const invalid = validationError(draft)
    if (invalid) {
      error.value = invalid
      return
    }
    try {
      const result = await ports.trial(context.csrfToken, {
        script: draft.script,
        document: draft.trialDocument,
      })
      trialGraph.value = result.graph
      error.value = result.result.ok
        ? null
        : result.result.error || '流程试算失败。'
    } catch (cause) {
      error.value = errorMessage(cause, '流程试算失败。')
    }
  }

  async function loadTrialDocuments(draft: WflDefinitionDraft): Promise<void> {
    const version = ++trialDocumentVersion
    if (
      !context.permissions.includes(`/vou/${draft.trialDocument.entity}/query`)
    ) {
      if (version === trialDocumentVersion) {
        trialDocuments.value = []
        error.value = '没有权限查询该类试算单据。'
      }
      return
    }
    try {
      const result = await ports.queryDocuments(
        context.csrfToken,
        draft.trialDocument.entity,
      )
      if (version !== trialDocumentVersion) return
      trialDocuments.value = result
      if (
        !trialDocuments.value.some(
          (item) => item.documentId === draft.trialDocument.documentId,
        )
      )
        draft.trialDocument.documentId = ''
      error.value = null
    } catch (cause) {
      if (version === trialDocumentVersion)
        error.value = errorMessage(cause, '试算单据候选加载失败。')
    }
  }

  function active(
    item: WflDefinitionQueryItem,
  ): WflDefinitionSubmission | null {
    return item.openCandidate ?? item.latestApproved
  }

  function canReview(
    item: WflDefinitionQueryItem,
    action: ApprovalAction,
  ): boolean {
    const submission = active(item)
    return !!submission && submission.availableApprovalActions.includes(action)
  }

  async function openDetail(subjectId: string): Promise<void> {
    const version = ++detailVersion
    try {
      const submission = await ports.get(context.csrfToken, subjectId)
      if (version === detailVersion) detail.value = submission
    } catch (cause) {
      if (version === detailVersion)
        error.value = errorMessage(cause, '流程定义详情加载失败。')
    }
  }

  async function synchronizeDeepLink(
    deepLink: DclWorkbenchDeepLink,
  ): Promise<void> {
    const version = ++detailVersion
    const objectId = deepLink.objectId?.trim()
    const submissionId = deepLink.submissionId?.trim()
    const revision = deepLink.revision?.trim()
    if (!objectId && !submissionId && !revision && !deepLink.mode) {
      detail.value = null
      return
    }
    if (
      !objectId ||
      !submissionId ||
      !revision ||
      (deepLink.mode !== 'view' && deepLink.mode !== 'edit')
    ) {
      error.value = '工作台深链缺少精确流程定义版本上下文。'
      return
    }
    try {
      const submission = await ports.get(context.csrfToken, objectId)
      if (version !== detailVersion) return
      if (
        submission.subjectId !== objectId ||
        submission.submissionId !== submissionId ||
        submission.revision !== revision
      )
        throw new Error('工作台流程定义版本已变化，请刷新后重试。')
      if (deepLink.mode === 'edit')
        await createChange({
          subjectId: submission.subjectId,
          code: submission.code,
          latestApproved: submission.status === 'APPROVED' ? submission : null,
          openCandidate: submission.status === 'APPROVED' ? null : submission,
        })
      else detail.value = submission
      error.value = null
    } catch (cause) {
      if (version === detailVersion)
        error.value = errorMessage(cause, '工作台流程定义深链加载失败。')
    }
  }

  async function review(
    item: WflDefinitionQueryItem,
    action: ApprovalAction,
  ): Promise<void> {
    const submission = active(item)
    if (!submission || !canReview(item, action)) return
    const submittedReason = reason.value.trim()
    if ((action === 'reject' || action === 'unapprove') && !submittedReason) {
      error.value = '请填写审批原因。'
      return
    }
    let actionError: string | null = null
    try {
      await ports.review(context.csrfToken, action, {
        subjectId: submission.subjectId,
        submissionId: submission.submissionId,
        expectedRevision: submission.revision,
        ...(submittedReason && (action === 'reject' || action === 'unapprove')
          ? { reason: submittedReason }
          : {}),
      })
    } catch (cause) {
      actionError = errorMessage(cause, '审批动作失败。')
    }
    await query(page.value)
    if (detail.value?.subjectId === submission.subjectId)
      await openDetail(submission.subjectId)
    if (actionError) error.value = actionError
  }

  async function setEnabled(
    submission: WflDefinitionSubmission,
    enabled: boolean,
  ): Promise<void> {
    if (!canSetEnabled(submission, enabled)) return
    await ports.setEnabled(context.csrfToken, enabled ? 'enable' : 'disable', {
      subjectId: submission.subjectId,
      approvalEntryId: submission.submissionId,
      expectedApprovalRevision: submission.revision,
      expectedRuntimeRevision: submission.runtimeRevision,
    })
    await query(page.value)
  }

  function canSetEnabled(
    submission: WflDefinitionSubmission,
    enabled: boolean,
  ): boolean {
    return submission.availableRuntimeActions.includes(
      enabled ? 'enable' : 'disable',
    )
  }

  async function removeSubmission(
    submission: WflDefinitionSubmission,
  ): Promise<void> {
    if (!submission.canDelete) return
    await ports.deleteSubmission(context.csrfToken, {
      subjectId: submission.subjectId,
      submissionId: submission.submissionId,
      expectedRevision: submission.revision,
    })
    await query(page.value)
  }

  return {
    drafts,
    items,
    total,
    page,
    keyword,
    loading,
    saving,
    error,
    message,
    reason,
    trialGraph,
    trialDocuments,
    detail,
    canCreate,
    canCreateChange,
    canTrial,
    loadDrafts,
    query,
    newDraft,
    saveDraft,
    createChange,
    validationError,
    submitDraft,
    trialDraft,
    loadTrialDocuments,
    active,
    canReview,
    openDetail,
    synchronizeDeepLink,
    review,
    setEnabled,
    canSetEnabled,
    removeSubmission,
  }
}

export function useDclWflProcessDefinitionViewModel() {
  const session = useTargetSession()
  if (!session.csrfToken || !session.user)
    throw new Error('DCL WFL definition requires an authenticated session.')
  const repository = new TargetDraftRepository()
  return createDclWflProcessDefinitionViewModel(
    {
      ownerUserId: session.user.id,
      csrfToken: session.csrfToken,
      permissions: session.permissions,
    },
    {
      drafts: {
        list: (ownerUserId, entity) =>
          repository.list<WflDefinitionDraft>(ownerUserId, entity),
        save: (draft) => repository.save(draft),
        delete: (ownerUserId, entity, draftId) =>
          repository.delete(ownerUserId, entity, draftId),
      },
      query: queryTargetWflDefinitions,
      get: getTargetWflDefinition,
      submit: (csrfToken, mode, input) =>
        submitTargetWflDefinition(csrfToken, mode, { ...input }),
      review: reviewTargetWflDefinition,
      deleteSubmission: deleteTargetWflDefinition,
      setEnabled: (csrfToken, action, input) =>
        setTargetWflDefinitionEnabled(csrfToken, action, { ...input }),
      trial: (csrfToken, input) =>
        trialTargetWflDefinition(csrfToken, { ...input }),
      queryDocuments: async (csrfToken, entity) => {
        return parseTrialDocuments(
          await queryTargetVou(csrfToken, entity, {
            page: 1,
            pageSize: 20,
            sort: [{ field: 'updatedAt', order: 'desc' }],
          }),
        )
      },
      id: createTargetId,
      now: () => new Date().toISOString(),
    },
  )
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

function parseTrialDocuments(value: unknown): WflTrialDocumentCandidate[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return []
  return value.items.flatMap((item) => {
    if (
      !isRecord(item) ||
      typeof item.documentId !== 'string' ||
      typeof item.documentNo !== 'string' ||
      !isApprovalStatus(item.status)
    )
      return []
    return [
      {
        documentId: item.documentId,
        documentNo: item.documentNo,
        status: item.status,
      },
    ]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED'
}
