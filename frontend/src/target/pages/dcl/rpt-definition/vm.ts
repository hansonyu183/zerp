import { computed, ref } from 'vue'

import type { ApprovalAction } from '@zerp/model'

import {
  deleteTargetArchive,
  getTargetArchive,
  queryTargetArchive,
  reviewTargetArchive,
  submitTargetArchive,
  targetArchiveAuditHistory,
  targetArchiveVersions,
  type TargetArchiveDeleteRequest,
  type TargetArchiveQueryRequest,
  type TargetArchiveReviewRequest,
  type TargetArchiveSubmitRequest,
} from '../../../api.ts'
import {
  archiveSubmitRequest,
  cloneArchiveDraft,
  createArchiveDraft,
  type ArchiveDraft,
} from '../../../archive-drafts.ts'
import {
  parseArchiveQueryPage,
  parseArchiveSubmission,
  parseArchiveSubmissionPage,
  type ArchiveSubmissionListView,
  type ArchiveSubmissionView,
} from '../../../archive-view.ts'
import { TargetDraftRepository } from '../../../draft-storage.ts'
import { useTargetSession } from '../../../session/vm.ts'
import type { DclWorkbenchDeepLink } from '../shared/vm.ts'

export type RptDefinitionDraft = ArchiveDraft<'rpt-definition'>
type RptParameter = RptDefinitionDraft['snapshot']['parameters'][number]
type RptColumn = RptDefinitionDraft['snapshot']['columns'][number]

export interface DclRptDefinitionContext {
  ownerUserId: string
  csrfToken: string
  permissions: readonly string[]
}

export interface DclRptDefinitionPorts {
  drafts: {
    list(
      ownerUserId: string,
      entity: 'rpt-definition',
    ): Promise<RptDefinitionDraft[]>
    save(draft: RptDefinitionDraft): Promise<void>
    delete(
      ownerUserId: string,
      entity: 'rpt-definition',
      draftId: string,
    ): Promise<void>
  }
  query(
    csrfToken: string,
    request: TargetArchiveQueryRequest,
  ): Promise<{ submissions: ArchiveSubmissionListView[]; total: number }>
  get(
    csrfToken: string,
    entity: 'rpt-definition',
    subjectId: string,
  ): Promise<ArchiveSubmissionView>
  versions(
    csrfToken: string,
    subjectId: string,
  ): Promise<ArchiveSubmissionView[]>
  audit(csrfToken: string, subjectId: string): Promise<unknown>
  submit(csrfToken: string, request: TargetArchiveSubmitRequest): Promise<void>
  review(csrfToken: string, request: TargetArchiveReviewRequest): Promise<void>
  deleteSubmission(
    csrfToken: string,
    request: TargetArchiveDeleteRequest,
  ): Promise<void>
}

export function createDclRptDefinitionViewModel(
  context: DclRptDefinitionContext,
  ports: DclRptDefinitionPorts,
) {
  const drafts = ref<RptDefinitionDraft[]>([])
  const submissions = ref<ArchiveSubmissionListView[]>([])
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const message = ref<string | null>(null)
  const reason = ref('')
  const detail = ref<{
    submission: ArchiveSubmissionView
    versions: ArchiveSubmissionView[]
    audit: unknown
  } | null>(null)
  let queryVersion = 0
  let detailVersion = 0
  const canCreate = computed(() =>
    context.permissions.includes('/dcl/rpt-definition/submit-new'),
  )

  async function loadDrafts(): Promise<void> {
    drafts.value = await ports.drafts.list(
      context.ownerUserId,
      'rpt-definition',
    )
  }

  async function query(nextPage = page.value): Promise<void> {
    if (!context.permissions.includes('/dcl/rpt-definition/query')) return
    const version = ++queryVersion
    loading.value = true
    try {
      const result = await ports.query(context.csrfToken, {
        entity: 'rpt-definition',
        input: { page: nextPage, pageSize: 20, filters: {} },
      })
      if (version !== queryVersion) return
      submissions.value = result.submissions
      total.value = result.total
      page.value = nextPage
      error.value = null
    } catch (cause) {
      if (version === queryVersion)
        error.value = errorMessage(cause, '报表定义候选查询失败。')
    } finally {
      if (version === queryVersion) loading.value = false
    }
  }

  async function newDraft(): Promise<void> {
    if (!canCreate.value) {
      error.value = '没有权限新建报表定义草稿。'
      return
    }
    const draft = rptDraft(
      createArchiveDraft(context.ownerUserId, 'rpt-definition'),
    )
    await ports.drafts.save(draft)
    drafts.value = [draft, ...drafts.value]
  }

  async function saveDraft(draft: RptDefinitionDraft): Promise<void> {
    draft.updatedAt = new Date().toISOString()
    await ports.drafts.save(draft)
    message.value = '草稿已保存在当前设备。'
  }

  async function createChange(item: ArchiveSubmissionListView): Promise<void> {
    if (
      item.status !== 'APPROVED' ||
      !context.permissions.includes('/dcl/rpt-definition/submit-change')
    ) {
      error.value = '只能基于已批准版本创建变更草稿。'
      return
    }
    try {
      const detail = await ports.get(
        context.csrfToken,
        'rpt-definition',
        item.subjectId,
      )
      if (detail.submissionId !== item.submissionId)
        throw new Error('正式版本已变化，请刷新后重试。')
      const draft = rptDraft(
        cloneArchiveDraft(
          context.ownerUserId,
          'rpt-definition',
          item.subjectId,
          detail.snapshot,
          { submissionId: item.submissionId, revision: item.revision },
        ),
      )
      await ports.drafts.save(draft)
      drafts.value = [draft, ...drafts.value]
    } catch (cause) {
      error.value = errorMessage(cause, '创建变更草稿失败。')
    }
  }

  function addParameter(draft: RptDefinitionDraft): void {
    const parameter: RptParameter = {
      key: `parameter${draft.snapshot.parameters.length + 1}`,
      name: `参数 ${draft.snapshot.parameters.length + 1}`,
      type: 'TEXT',
      required: false,
    }
    draft.snapshot.parameters = [...draft.snapshot.parameters, parameter]
  }

  function addColumn(draft: RptDefinitionDraft): void {
    const next = draft.snapshot.columns.length + 1
    const column: RptColumn = {
      alias: `column_${next}`,
      name: `列 ${next}`,
      order: next,
      type: 'TEXT',
      width: 120,
      visible: true,
    }
    draft.snapshot.columns = [...draft.snapshot.columns, column]
  }

  function validationError(draft: RptDefinitionDraft): string | null {
    if (!draft.snapshot.name.trim()) return '请输入报表名称。'
    if (!draft.snapshot.sql.trim()) return '请输入查询 SQL。'
    if (draft.snapshot.columns.length === 0) return '至少声明一个结果列。'
    if (
      new Set(draft.snapshot.parameters.map((item) => item.key)).size !==
      draft.snapshot.parameters.length
    )
      return '参数键不能重复。'
    if (
      new Set(draft.snapshot.columns.map((item) => item.alias)).size !==
      draft.snapshot.columns.length
    )
      return '结果列别名不能重复。'
    return null
  }

  async function submitDraft(draft: RptDefinitionDraft): Promise<void> {
    const permission = `/dcl/rpt-definition/submit-${draft.mode === 'NEW' ? 'new' : 'change'}`
    if (!context.permissions.includes(permission)) {
      error.value = '没有权限提交报表定义草稿。'
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
      await ports.submit(context.csrfToken, archiveSubmitRequest(draft))
      await ports.drafts.delete(
        draft.ownerUserId,
        'rpt-definition',
        draft.draftId,
      )
      drafts.value = drafts.value.filter(
        (item) => item.draftId !== draft.draftId,
      )
      message.value = '报表定义已提交，状态以服务器返回为准。'
      error.value = null
      await query(page.value)
    } catch (cause) {
      error.value = errorMessage(cause, '提交失败；本地草稿已保留。')
    } finally {
      saving.value = false
    }
  }

  function canReview(
    item: ArchiveSubmissionListView,
    action: ApprovalAction,
  ): boolean {
    return item.availableApprovalActions.includes(action)
  }

  async function openDetail(subjectId: string): Promise<void> {
    const version = ++detailVersion
    try {
      const [submission, versions, audit] = await Promise.all([
        ports.get(context.csrfToken, 'rpt-definition', subjectId),
        ports.versions(context.csrfToken, subjectId),
        ports.audit(context.csrfToken, subjectId),
      ])
      if (version === detailVersion)
        detail.value = { submission, versions, audit }
    } catch (cause) {
      if (version === detailVersion)
        error.value = errorMessage(cause, '报表定义详情加载失败。')
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
      error.value = '工作台深链缺少精确报表定义版本上下文。'
      return
    }
    try {
      const [current, versions, audit] = await Promise.all([
        ports.get(context.csrfToken, 'rpt-definition', objectId),
        ports.versions(context.csrfToken, objectId),
        ports.audit(context.csrfToken, objectId),
      ])
      if (version !== detailVersion) return
      const exact = versions.find(
        (candidate) => candidate.submissionId === submissionId,
      )
      if (
        current.subjectId !== objectId ||
        current.submissionId !== submissionId ||
        current.revision !== revision ||
        !exact ||
        exact.revision !== revision
      )
        throw new Error('工作台报表定义版本已变化，请刷新后重试。')
      if (deepLink.mode === 'edit') await createChange(exact)
      else detail.value = { submission: exact, versions, audit }
      error.value = null
    } catch (cause) {
      if (version === detailVersion)
        error.value = errorMessage(cause, '工作台报表定义深链加载失败。')
    }
  }

  async function review(
    item: ArchiveSubmissionListView,
    action: ApprovalAction,
  ): Promise<void> {
    if (!canReview(item, action)) return
    const submittedReason = reason.value.trim()
    if ((action === 'reject' || action === 'unapprove') && !submittedReason) {
      error.value = '请填写审批原因。'
      return
    }
    const identity = {
      subjectId: item.subjectId,
      submissionId: item.submissionId,
      expectedRevision: item.revision,
    }
    let actionError: string | null = null
    try {
      await ports.review(
        context.csrfToken,
        action === 'reject' || action === 'unapprove'
          ? {
              entity: 'rpt-definition',
              action,
              input: { ...identity, reason: submittedReason },
            }
          : { entity: 'rpt-definition', action, input: identity },
      )
    } catch (cause) {
      actionError = errorMessage(cause, '审批动作失败。')
    }
    await query(page.value)
    if (detail.value?.submission.subjectId === item.subjectId)
      await openDetail(item.subjectId)
    if (actionError) error.value = actionError
  }

  async function removeSubmission(
    item: ArchiveSubmissionListView,
  ): Promise<void> {
    if (
      !item.canDelete ||
      !context.permissions.includes('/dcl/rpt-definition/delete')
    )
      return
    await ports.deleteSubmission(context.csrfToken, {
      entity: 'rpt-definition',
      input: {
        subjectId: item.subjectId,
        submissionId: item.submissionId,
        expectedRevision: item.revision,
      },
    })
    await query(page.value)
  }

  return {
    drafts,
    submissions,
    total,
    page,
    loading,
    saving,
    error,
    message,
    reason,
    detail,
    canCreate,
    loadDrafts,
    query,
    newDraft,
    saveDraft,
    createChange,
    addParameter,
    addColumn,
    validationError,
    submitDraft,
    canReview,
    openDetail,
    synchronizeDeepLink,
    review,
    removeSubmission,
  }
}

export function useDclRptDefinitionViewModel() {
  const session = useTargetSession()
  if (!session.csrfToken || !session.user)
    throw new Error('DCL RPT definition requires an authenticated session.')
  const repository = new TargetDraftRepository()
  return createDclRptDefinitionViewModel(
    {
      ownerUserId: session.user.id,
      csrfToken: session.csrfToken,
      permissions: session.permissions,
    },
    {
      drafts: {
        list: (ownerUserId, entity) =>
          repository.list<RptDefinitionDraft>(ownerUserId, entity),
        save: (draft) => repository.save(draft),
        delete: (ownerUserId, entity, draftId) =>
          repository.delete(ownerUserId, entity, draftId),
      },
      query: async (csrfToken, request) =>
        parseArchiveQueryPage(
          'rpt-definition',
          await queryTargetArchive(csrfToken, request),
        ),
      get: async (csrfToken, entity, subjectId) => {
        const detail = parseArchiveSubmission(
          entity,
          await getTargetArchive(csrfToken, entity, subjectId),
        )
        if (!detail) throw new Error('服务器返回了无效报表定义详情。')
        return detail
      },
      versions: async (csrfToken, subjectId) =>
        parseArchiveSubmissionPage(
          'rpt-definition',
          await targetArchiveVersions(csrfToken, 'rpt-definition', subjectId),
        ),
      audit: (csrfToken, subjectId) =>
        targetArchiveAuditHistory(csrfToken, 'rpt-definition', subjectId),
      submit: async (csrfToken, request) => {
        await submitTargetArchive(csrfToken, request)
      },
      review: async (csrfToken, request) => {
        await reviewTargetArchive(csrfToken, request)
      },
      deleteSubmission: async (csrfToken, request) => {
        await deleteTargetArchive(csrfToken, request)
      },
    },
  )
}

function rptDraft(
  draft: ReturnType<typeof createArchiveDraft>,
): RptDefinitionDraft {
  if (draft.entity !== 'rpt-definition')
    throw new Error('Invalid RPT definition Draft.')
  return draft
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
