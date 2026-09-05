import { reactive, ref } from 'vue'

import type { ApprovalAction, ApprovalStatus } from '@zerp/model'

import {
  deleteTargetArchive,
  getTargetArchive,
  queryTargetArchive,
  queryTargetAuxReference,
  queryTargetBobReference,
  reviewTargetArchive,
  submitTargetArchive,
  targetArchiveAuditHistory,
  targetArchiveVersions,
  type TargetArchiveCommonEntity,
  type TargetArchiveDeleteRequest,
  type TargetArchiveQueryRequest,
  type TargetArchiveReviewRequest,
  type TargetArchiveSubmitRequest,
} from '../../../api.ts'
import {
  archiveSubmitRequest,
  cloneArchiveDraft,
  createArchiveDraft,
  type AnyArchiveDraft,
} from '../../../archive-drafts.ts'
import {
  archiveEntityPresentation,
  canCloneArchive,
  canSubmitArchive,
} from '../../../archive-presentation.ts'
import {
  isLatestSubmission,
  latestApproved,
  parseArchiveQueryPage,
  parseArchiveSubmission,
  parseArchiveSubmissionPage,
  type ArchiveSubmissionListView,
  type ArchiveSubmissionView,
} from '../../../archive-view.ts'
import { TargetDraftRepository } from '../../../draft-storage.ts'
import { useTargetSession } from '../../../session/vm.ts'

export const ordinaryArchiveEntities = [
  'operating-entity',
  'vehicle',
  'fund-account',
  'employee',
  'supplier',
  'other-unit',
  'sales-partner',
] as const satisfies readonly TargetArchiveCommonEntity[]

export type OrdinaryArchiveEntity = (typeof ordinaryArchiveEntities)[number]
export type ArchiveWorkspaceEntity =
  OrdinaryArchiveEntity | 'product' | 'customer'

export interface ArchiveWorkspaceContext {
  ownerUserId: string
  csrfToken: string
  permissions: readonly string[]
}

export interface DclWorkbenchDeepLink {
  objectId?: string
  submissionId?: string
  revision?: string
  mode?: string
}

export interface ArchiveWorkspacePorts {
  drafts: {
    list(
      ownerUserId: string,
      entity: ArchiveWorkspaceEntity,
    ): Promise<AnyArchiveDraft[]>
    save(draft: AnyArchiveDraft): Promise<void>
    delete(
      ownerUserId: string,
      entity: ArchiveWorkspaceEntity,
      draftId: string,
    ): Promise<void>
  }
  api: {
    query(
      csrfToken: string,
      request: TargetArchiveQueryRequest,
    ): Promise<unknown>
    get(
      csrfToken: string,
      entity: ArchiveWorkspaceEntity,
      subjectId: string,
    ): Promise<unknown>
    versions(
      csrfToken: string,
      entity: ArchiveWorkspaceEntity,
      subjectId: string,
    ): Promise<unknown>
    audit(
      csrfToken: string,
      entity: ArchiveWorkspaceEntity,
      subjectId: string,
    ): Promise<unknown>
    submit(
      csrfToken: string,
      request: TargetArchiveSubmitRequest,
    ): Promise<unknown>
    review(
      csrfToken: string,
      request: TargetArchiveReviewRequest,
    ): Promise<unknown>
    deleteSubmission(
      csrfToken: string,
      request: TargetArchiveDeleteRequest,
    ): Promise<unknown>
    auxReference(csrfToken: string, entity: string): Promise<unknown[]>
    bobReference(csrfToken: string, entity: string): Promise<unknown[]>
  }
  now(): string
}

export function createArchiveWorkspaceViewModel(
  entity: ArchiveWorkspaceEntity,
  context: ArchiveWorkspaceContext,
  ports: ArchiveWorkspacePorts,
) {
  const filters = reactive({
    keyword: '',
    status: '' as '' | ApprovalStatus,
    enabled: '' as '' | 'true' | 'false',
  })
  const drafts = ref<AnyArchiveDraft[]>([])
  const submissions = ref<ArchiveSubmissionListView[]>([])
  const referenceOptions = ref<Record<string, Record<string, unknown>[]>>({})
  const history = ref<{
    detail: ArchiveSubmissionView
    versions: ArchiveSubmissionView[]
    audit: unknown
  } | null>(null)
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const message = ref('')
  const reason = ref('')
  const canCreate = canSubmitArchive(context.permissions, entity, 'NEW')
  let queryVersion = 0
  let historyVersion = 0
  let referenceVersion = 0
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const saveQueues = new Map<string, Promise<void>>()

  function queryRequest(nextPage: number): TargetArchiveQueryRequest {
    return {
      entity,
      input: {
        page: nextPage,
        pageSize: 20,
        filters: {
          ...(filters.keyword.trim()
            ? { keyword: filters.keyword.trim() }
            : {}),
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.enabled ? { enabled: filters.enabled === 'true' } : {}),
        },
      },
    }
  }

  async function query(nextPage = page.value): Promise<void> {
    const version = ++queryVersion
    loading.value = true
    try {
      const result = parseArchiveQueryPage(
        entity,
        await ports.api.query(context.csrfToken, queryRequest(nextPage)),
      )
      if (version !== queryVersion) return
      submissions.value = result.submissions
      total.value = result.total
      page.value = nextPage
      error.value = ''
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(
          cause,
          `${archiveEntityPresentation[entity].label}查询失败。`,
        )
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function loadDrafts(): Promise<void> {
    drafts.value = await ports.drafts.list(context.ownerUserId, entity)
  }

  async function newDraft(): Promise<void> {
    if (!canCreate) {
      error.value = '无权新建该业务档案草稿。'
      return
    }
    const draft = createArchiveDraft(context.ownerUserId, entity)
    await ports.drafts.save(draft)
    drafts.value = [draft, ...drafts.value]
    message.value = '已创建仅保存在当前设备的本地草稿。'
  }

  async function persistDraft(draft: AnyArchiveDraft): Promise<void> {
    draft.updatedAt = ports.now()
    const previous = saveQueues.get(draft.draftId) ?? Promise.resolve()
    const next = previous.then(() => ports.drafts.save(draft))
    saveQueues.set(draft.draftId, next)
    try {
      await next
    } finally {
      if (saveQueues.get(draft.draftId) === next)
        saveQueues.delete(draft.draftId)
    }
  }

  function scheduleSave(draft: AnyArchiveDraft): void {
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

  async function flushSave(draft: AnyArchiveDraft): Promise<void> {
    const pending = saveTimers.get(draft.draftId)
    if (pending) {
      clearTimeout(pending)
      saveTimers.delete(draft.draftId)
      await persistDraft(draft)
      return
    }
    await saveQueues.get(draft.draftId)
  }

  async function deleteDraft(draft: AnyArchiveDraft): Promise<void> {
    const pending = saveTimers.get(draft.draftId)
    if (pending) clearTimeout(pending)
    saveTimers.delete(draft.draftId)
    await ports.drafts.delete(
      draft.ownerUserId,
      draft.entity as ArchiveWorkspaceEntity,
      draft.draftId,
    )
    drafts.value = drafts.value.filter(
      (candidate) => candidate.draftId !== draft.draftId,
    )
  }

  async function submitDraft(draft: AnyArchiveDraft): Promise<void> {
    if (!canSubmitArchive(context.permissions, entity, draft.mode)) {
      error.value = '无权提交该业务档案草稿。'
      return
    }
    saving.value = true
    error.value = ''
    try {
      await flushSave(draft)
      await ports.api.submit(context.csrfToken, archiveSubmitRequest(draft))
      await ports.drafts.delete(
        draft.ownerUserId,
        draft.entity as ArchiveWorkspaceEntity,
        draft.draftId,
      )
      drafts.value = drafts.value.filter(
        (candidate) => candidate.draftId !== draft.draftId,
      )
      if (context.permissions.includes(`/dcl/${entity}/query`))
        await query(page.value)
      message.value = '业务档案草稿已提交，状态以服务器返回为准。'
    } catch (cause) {
      error.value = errorMessage(cause, '提交失败；本地草稿已保留。')
    } finally {
      saving.value = false
    }
  }

  function approvedFor(submission: ArchiveSubmissionListView) {
    return latestApproved(
      submissions.value.filter(
        (candidate) => candidate.subjectId === submission.subjectId,
      ),
    )
  }

  function canClone(submission: ArchiveSubmissionListView): boolean {
    return (
      isLatestSubmission(submission, submissions.value) &&
      canCloneArchive(
        context.permissions,
        entity,
        approvedFor(submission) ? 'CHANGE' : 'NEW',
      )
    )
  }

  async function cloneSubmission(
    submission: ArchiveSubmissionListView,
  ): Promise<void> {
    if (!canClone(submission)) {
      error.value = '无权克隆该业务档案。'
      return
    }
    try {
      const detail = parseArchiveSubmission(
        entity,
        await ports.api.get(context.csrfToken, entity, submission.subjectId),
      )
      if (!detail || detail.submissionId !== submission.submissionId)
        throw new Error('当前 Submission 已变化，请刷新后重试。')
      const draft = cloneArchiveDraft(
        context.ownerUserId,
        entity,
        submission.subjectId,
        detail.snapshot,
        approvedFor(submission),
      )
      await ports.drafts.save(draft)
      drafts.value = [draft, ...drafts.value]
    } catch (cause) {
      error.value = errorMessage(cause, '读取档案详情并克隆失败。')
    }
  }

  async function viewHistory(
    submission: ArchiveSubmissionListView,
  ): Promise<void> {
    const version = ++historyVersion
    try {
      const [detailPayload, versionsPayload, audit] = await Promise.all([
        ports.api.get(context.csrfToken, entity, submission.subjectId),
        ports.api.versions(context.csrfToken, entity, submission.subjectId),
        ports.api.audit(context.csrfToken, entity, submission.subjectId),
      ])
      const detail = parseArchiveSubmission(entity, detailPayload)
      if (!detail) throw new Error('服务器返回了无效档案详情。')
      if (version !== historyVersion) return
      history.value = {
        detail,
        versions: parseArchiveSubmissionPage(entity, versionsPayload),
        audit,
      }
    } catch (cause) {
      if (version === historyVersion)
        error.value = errorMessage(cause, '详情与历史加载失败。')
    }
  }

  async function synchronizeDeepLink(
    deepLink: DclWorkbenchDeepLink,
    cloneExact?: (
      detail: ArchiveSubmissionView,
      versions: ArchiveSubmissionView[],
    ) => Promise<void>,
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
      error.value = '工作台深链缺少精确档案版本上下文。'
      return
    }
    try {
      const [detailPayload, versionsPayload, audit] = await Promise.all([
        ports.api.get(context.csrfToken, entity, objectId),
        ports.api.versions(context.csrfToken, entity, objectId),
        ports.api.audit(context.csrfToken, entity, objectId),
      ])
      if (version !== historyVersion) return
      const detail = parseArchiveSubmission(entity, detailPayload)
      const versions = parseArchiveSubmissionPage(entity, versionsPayload)
      const exact = versions.find(
        (candidate) => candidate.submissionId === submissionId,
      )
      if (
        !detail ||
        detail.subjectId !== objectId ||
        detail.submissionId !== submissionId ||
        detail.revision !== revision ||
        !exact ||
        exact.revision !== revision
      )
        throw new Error('工作台档案版本已变化，请刷新工作台后重试。')
      if (deepLink.mode === 'view') {
        history.value = { detail: exact, versions, audit }
        error.value = ''
        return
      }
      if (cloneExact) await cloneExact(exact, versions)
      else {
        const approved = latestApproved(versions)
        if (
          !canCloneArchive(
            context.permissions,
            entity,
            approved ? 'CHANGE' : 'NEW',
          )
        )
          throw new Error('无权从该工作台档案版本创建本地草稿。')
        const draft = cloneArchiveDraft(
          context.ownerUserId,
          entity,
          exact.subjectId,
          exact.snapshot,
          approved,
        )
        await ports.drafts.save(draft)
        if (version !== historyVersion) return
        drafts.value = [draft, ...drafts.value]
      }
      error.value = ''
    } catch (cause) {
      if (version === historyVersion)
        error.value = errorMessage(cause, '工作台档案深链加载失败。')
    }
  }

  async function review(
    submission: ArchiveSubmissionListView,
    action: ApprovalAction,
  ): Promise<void> {
    if (!submission.availableApprovalActions.includes(action)) {
      error.value = '服务器未提供该审批动作，请刷新后重试。'
      return
    }
    const needsReason = action === 'reject' || action === 'unapprove'
    const submittedReason = reason.value.trim()
    if (needsReason && !submittedReason) {
      error.value = '请填写审批原因。'
      return
    }
    const identity = {
      subjectId: submission.subjectId,
      submissionId: submission.submissionId,
      expectedRevision: submission.revision,
    }
    let actionError = ''
    try {
      await ports.api.review(
        context.csrfToken,
        needsReason
          ? { entity, action, input: { ...identity, reason: submittedReason } }
          : {
              entity,
              action: action as 'approve' | 'unreject',
              input: identity,
            },
      )
      reason.value = ''
    } catch (cause) {
      actionError = errorMessage(cause, '审批动作失败。')
    }
    const openSubjectId = history.value?.detail.subjectId
    await query(page.value)
    if (openSubjectId === submission.subjectId) await viewHistory(submission)
    if (actionError) error.value = actionError
  }

  async function withdraw(
    submission: ArchiveSubmissionListView,
  ): Promise<void> {
    try {
      await ports.api.deleteSubmission(context.csrfToken, {
        entity,
        input: {
          subjectId: submission.subjectId,
          submissionId: submission.submissionId,
          expectedRevision: submission.revision,
        },
      } as TargetArchiveDeleteRequest)
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '撤回失败。')
      await query(page.value)
    }
  }

  async function loadReferences(): Promise<void> {
    const version = ++referenceVersion
    const options: Record<string, Record<string, unknown>[]> = {}
    const auxByEntity: Partial<
      Record<ArchiveWorkspaceEntity, readonly [string, string][]>
    > = {
      vehicle: [['vehicleType', 'dictionary-item']],
      employee: [
        ['employeeCategory', 'employee-category'],
        ['department', 'department'],
        ['position', 'position'],
      ],
      supplier: [['settlementMethod', 'settlement-method']],
      'other-unit': [['settlementMethod', 'settlement-method']],
      product: [
        ['productType', 'product-type'],
        ['productCategory', 'product-category'],
        ['measurementUnit', 'measurement-unit'],
      ],
      customer: [
        ['customerType', 'dictionary-item'],
        ['settlementMethod', 'settlement-method'],
        ['paymentMethod', 'payment-method'],
      ],
    }
    const bobByEntity: Partial<
      Record<ArchiveWorkspaceEntity, readonly [string, string][]>
    > = {
      vehicle: [
        ['operatingEntity', 'operating-entity'],
        ['otherUnit', 'other-unit'],
      ],
      'fund-account': [['operatingEntity', 'operating-entity']],
      employee: [['operatingEntity', 'operating-entity']],
      supplier: [
        ['operatingEntity', 'operating-entity'],
        ['employee', 'employee'],
      ],
      'other-unit': [['operatingEntity', 'operating-entity']],
      'sales-partner': [['operatingEntity', 'operating-entity']],
      product: [['product', 'product']],
      customer: [
        ['operatingEntity', 'operating-entity'],
        ['employee', 'employee'],
        ['salesPartner', 'sales-partner'],
      ],
    }
    if (context.permissions.includes('/aux/reference/query'))
      await Promise.all(
        (auxByEntity[entity] ?? []).map(async ([key, target]) => {
          options[key] = (await ports.api.auxReference(
            context.csrfToken,
            target,
          )) as Record<string, unknown>[]
        }),
      )
    if (context.permissions.includes('/bob/reference/query'))
      await Promise.all(
        (bobByEntity[entity] ?? []).map(async ([key, target]) => {
          options[key] = (await ports.api.bobReference(
            context.csrfToken,
            target,
          )) as Record<string, unknown>[]
        }),
      )
    if (version === referenceVersion) referenceOptions.value = options
  }

  return {
    entity,
    presentation: archiveEntityPresentation[entity],
    filters,
    drafts,
    submissions,
    referenceOptions,
    history,
    total,
    page,
    loading,
    saving,
    error,
    message,
    reason,
    canCreate,
    query,
    loadDrafts,
    loadReferences,
    newDraft,
    scheduleSave,
    flushSave,
    deleteDraft,
    submitDraft,
    canClone,
    cloneSubmission,
    viewHistory,
    synchronizeDeepLink,
    review,
    withdraw,
  }
}

export function useArchiveWorkspaceViewModel(entity: OrdinaryArchiveEntity) {
  const session = useTargetSession()
  if (!session.user || !session.csrfToken)
    throw new Error('Archive page requires an authenticated session.')
  const repository = new TargetDraftRepository()
  return createArchiveWorkspaceViewModel(
    entity,
    {
      ownerUserId: session.user.id,
      csrfToken: session.csrfToken,
      permissions: session.permissions,
    },
    {
      drafts: {
        list: (ownerUserId, targetEntity) =>
          repository.list(ownerUserId, targetEntity),
        save: (draft) => repository.save(draft),
        delete: (ownerUserId, targetEntity, draftId) =>
          repository.delete(ownerUserId, targetEntity, draftId),
      },
      api: {
        query: queryTargetArchive,
        get: getTargetArchive,
        versions: targetArchiveVersions,
        audit: targetArchiveAuditHistory,
        submit: submitTargetArchive,
        review: reviewTargetArchive,
        deleteSubmission: deleteTargetArchive,
        auxReference: (csrfToken, targetEntity) =>
          queryTargetAuxReference(
            csrfToken,
            targetEntity as Parameters<typeof queryTargetAuxReference>[1],
          ),
        bobReference: (csrfToken, targetEntity) =>
          queryTargetBobReference(
            csrfToken,
            targetEntity as Parameters<typeof queryTargetBobReference>[1],
          ),
      },
      now: () => new Date().toISOString(),
    },
  )
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
