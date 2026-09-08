import { describeBobArchiveFailure } from './blockers.ts'
import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue'
import type { OtherUnitData, SalesPartnerData, SupplierData } from '@zerp/model'

import { TargetApiError } from '../../../api.ts'

export type ArchiveApprovalAction =
  'approve' | 'reject' | 'unreject' | 'unapprove'
export type ArchiveReviewAction = ArchiveApprovalAction | 'delete'
export type IdentityArchiveSnapshot =
  SupplierData | OtherUnitData | SalesPartnerData

export const archiveAuditActionPresentation = {
  SUBMITTED: '已提交',
  REJECTED: '已驳回',
  UNREJECTED: '已恢复审核',
  APPROVED: '已批准',
  UNAPPROVED: '已反批准',
  DELETED: '已删除',
} as const

export type ArchiveSubmission = {
  entity: 'supplier' | 'other-unit' | 'sales-partner' | 'product' | 'customer'
  subjectId: string
  submissionId: string
  versionNo: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  revision: string
  submittedAt: string
  availableApprovalActions: readonly ArchiveApprovalAction[]
  canDelete: boolean
  snapshot: unknown
}

export type ArchiveSubmissionQueryItem<
  Submission extends Omit<ArchiveSubmission, 'snapshot'>,
> = {
  subjectId: string
  code: string | null
  latestApproved: Submission | null
  openCandidate: Submission | null
}

export type ArchiveAuditEvent = {
  id: string
  action: string
  createdAt: string
  actorId: string
  reason: string | null
}

type ReviewCommand = {
  subjectId: string
  submissionId: string
  expectedRevision: string
}
type ReviewWithReasonCommand = ReviewCommand & { reason: string }
type SubmissionReference = Pick<ArchiveSubmission, 'subjectId' | 'submissionId'>
type UnknownMutation = {
  action: ArchiveReviewAction
  submission: SubmissionReference
}

export type ArchiveSubmissionLifecycle<Submission extends ArchiveSubmission> = {
  open: ShallowRef<boolean>
  loading: ShallowRef<boolean>
  mutating: ShallowRef<boolean>
  error: ShallowRef<string | null>
  refreshError: ShallowRef<string | null>
  items: ShallowRef<
    readonly ArchiveSubmissionQueryItem<Omit<Submission, 'snapshot'>>[]
  >
  page: ShallowRef<number>
  pageSize: ShallowRef<number>
  total: ShallowRef<number>
  keyword: ShallowRef<string>
  selectedSubjectId: ShallowRef<string | null>
  selected: ShallowRef<Submission | null>
  versions: ShallowRef<readonly Submission[]>
  auditHistory: ShallowRef<readonly ArchiveAuditEvent[]>
  outcomeUnknown: ShallowRef<boolean>
  canVerifyOutcome: ComputedRef<boolean>
  canAction: (action: ArchiveReviewAction) => boolean
  openList: () => Promise<void>
  search: (keyword: string) => Promise<void>
  goToPage: (page: number) => Promise<void>
  select: (
    item: ArchiveSubmissionQueryItem<Omit<Submission, 'snapshot'>>,
  ) => Promise<void>
  selectVersion: (submission: Submission) => Promise<void>
  review: (
    action: ArchiveReviewAction,
    reason?: string,
  ) => Promise<'changed' | undefined>
  verifyOutcome: () => Promise<'changed' | 'not-changed' | undefined>
  close: () => void
  dispose: () => void
}

export function useArchiveSubmissionLifecycle<
  Submission extends ArchiveSubmission,
>(options: {
  canQuery: () => boolean
  canGet: () => boolean
  canVersions: () => boolean
  canAudit: () => boolean
  canAction: (action: ArchiveReviewAction) => boolean
  query: (input: {
    page: number
    pageSize: number
    keyword: string
  }) => Promise<{
    items: readonly ArchiveSubmissionQueryItem<Omit<Submission, 'snapshot'>>[]
    total: number
    page?: number
    pageSize?: number
  }>
  get: (input: SubmissionReference) => Promise<Submission>
  versions: (subjectId: string) => Promise<{ items: readonly Submission[] }>
  auditHistory: (subjectId: string) => Promise<readonly ArchiveAuditEvent[]>
  approve: (input: ReviewCommand) => Promise<Submission>
  reject: (input: ReviewWithReasonCommand) => Promise<Submission>
  unreject: (input: ReviewCommand) => Promise<Submission>
  unapprove: (input: ReviewWithReasonCommand) => Promise<Submission>
  delete: (input: ReviewCommand) => Promise<unknown>
  onChanged?: () => Promise<void> | void
}): ArchiveSubmissionLifecycle<Submission> {
  const open = shallowRef(false)
  const loading = shallowRef(false)
  const mutating = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const refreshError = shallowRef<string | null>(null)
  const items = shallowRef<
    readonly ArchiveSubmissionQueryItem<Omit<Submission, 'snapshot'>>[]
  >([])
  const page = shallowRef(1)
  const pageSize = shallowRef(20)
  const total = shallowRef(0)
  const keyword = shallowRef('')
  const selectedSubjectId = shallowRef<string | null>(null)
  const selected = shallowRef<Submission | null>(
    null,
  ) as ShallowRef<Submission | null>
  const versions = shallowRef<readonly Submission[]>([])
  const auditHistory = shallowRef<readonly ArchiveAuditEvent[]>([])
  const outcomeUnknown = shallowRef(false)
  const unknownMutation = shallowRef<UnknownMutation | null>(null)
  let listGeneration = 0
  let detailGeneration = 0

  const messageOf = (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback
  const canVerifyOutcome = computed(
    () => outcomeUnknown.value && options.canGet() && !mutating.value,
  )
  const canAction = (action: ArchiveReviewAction) => {
    const submission = selected.value
    if (!submission || mutating.value || outcomeUnknown.value) return false
    if (!options.canAction(action)) return false
    return action === 'delete'
      ? submission.canDelete
      : submission.availableApprovalActions.includes(action)
  }

  const loadList = async (requestedPage: number, requestedKeyword: string) => {
    if (!options.canQuery()) return
    const generation = ++listGeneration
    loading.value = true
    error.value = null
    try {
      const result = await options.query({
        page: requestedPage,
        pageSize: pageSize.value,
        keyword: requestedKeyword,
      })
      if (generation !== listGeneration) return
      items.value = result.items
      total.value = result.total
      page.value = result.page ?? requestedPage
      pageSize.value = result.pageSize ?? pageSize.value
      keyword.value = requestedKeyword
      open.value = true
    } catch (cause) {
      if (generation === listGeneration)
        error.value = messageOf(cause, '提交记录读取失败。')
    } finally {
      if (generation === listGeneration) loading.value = false
    }
  }

  const refreshSecondary = async (subjectId: string | null) => {
    const generation = detailGeneration
    const failures: string[] = []
    if (subjectId) {
      const tasks: Promise<void>[] = []
      if (options.canVersions())
        tasks.push(
          options.versions(subjectId).then(
            (result) => {
              if (generation === detailGeneration) versions.value = result.items
            },
            (cause) => {
              failures.push(messageOf(cause, '版本记录刷新失败。'))
            },
          ),
        )
      if (options.canAudit())
        tasks.push(
          options.auditHistory(subjectId).then(
            (result) => {
              if (generation === detailGeneration) auditHistory.value = result
            },
            (cause) => {
              failures.push(messageOf(cause, '审核记录刷新失败。'))
            },
          ),
        )
      await Promise.all(tasks)
    }
    if (generation !== detailGeneration) return
    if (options.canQuery()) {
      const refreshListGeneration = ++listGeneration
      try {
        const result = await options.query({
          page: page.value,
          pageSize: pageSize.value,
          keyword: keyword.value,
        })
        if (
          generation !== detailGeneration ||
          refreshListGeneration !== listGeneration
        )
          return
        items.value = result.items
        total.value = result.total
      } catch (cause) {
        if (
          generation !== detailGeneration ||
          refreshListGeneration !== listGeneration
        )
          return
        failures.push(messageOf(cause, '提交列表刷新失败。'))
      }
    }
    if (generation !== detailGeneration) return
    try {
      await options.onChanged?.()
    } catch (cause) {
      failures.push(messageOf(cause, '档案列表刷新失败。'))
    }
    if (generation !== detailGeneration) return
    refreshError.value = failures.length
      ? `操作已成功，但${failures.join('；')}`
      : null
  }

  const selectVersion = async (submission: Submission) => {
    const generation = ++detailGeneration
    selected.value = submission
    error.value = null
    if (!options.canGet()) return
    loading.value = true
    try {
      const result = await options.get({
        subjectId: submission.subjectId,
        submissionId: submission.submissionId,
      })
      if (generation === detailGeneration) selected.value = result
    } catch (cause) {
      if (generation === detailGeneration)
        error.value = messageOf(cause, '提交详情读取失败。')
    } finally {
      if (generation === detailGeneration) loading.value = false
    }
  }

  const select = async (
    item: ArchiveSubmissionQueryItem<Omit<Submission, 'snapshot'>>,
  ) => {
    const candidate = item.openCandidate ?? item.latestApproved
    const generation = ++detailGeneration
    selectedSubjectId.value = item.subjectId
    selected.value = null
    versions.value = []
    auditHistory.value = []
    error.value = null
    loading.value = true
    const failures: string[] = []
    const tasks: Promise<void>[] = []
    if (candidate && options.canGet())
      tasks.push(
        options
          .get({
            subjectId: item.subjectId,
            submissionId: candidate.submissionId,
          })
          .then(
            (result) => {
              if (generation === detailGeneration) selected.value = result
            },
            (cause) => {
              failures.push(messageOf(cause, '提交详情读取失败。'))
            },
          ),
      )
    if (options.canVersions())
      tasks.push(
        options.versions(item.subjectId).then(
          (result) => {
            if (generation === detailGeneration) versions.value = result.items
          },
          (cause) => {
            failures.push(messageOf(cause, '版本记录读取失败。'))
          },
        ),
      )
    if (options.canAudit())
      tasks.push(
        options.auditHistory(item.subjectId).then(
          (result) => {
            if (generation === detailGeneration) auditHistory.value = result
          },
          (cause) => {
            failures.push(messageOf(cause, '审核记录读取失败。'))
          },
        ),
      )
    await Promise.all(tasks)
    if (generation === detailGeneration) {
      error.value = failures.length ? failures.join('；') : null
      loading.value = false
    }
  }

  const review = async (action: ArchiveReviewAction, reason?: string) => {
    const submission = selected.value
    if (!submission || !canAction(action)) return
    if ((action === 'reject' || action === 'unapprove') && !reason?.trim()) {
      error.value = '请填写原因。'
      return
    }
    const input = {
      subjectId: submission.subjectId,
      submissionId: submission.submissionId,
      expectedRevision: submission.revision,
    }
    const generation = detailGeneration
    mutating.value = true
    error.value = null
    refreshError.value = null
    try {
      if (action === 'delete') {
        await options.delete(input)
        if (generation !== detailGeneration) return
        selected.value = null
      } else {
        const next =
          action === 'approve'
            ? await options.approve(input)
            : action === 'reject'
              ? await options.reject({ ...input, reason: reason!.trim() })
              : action === 'unreject'
                ? await options.unreject(input)
                : await options.unapprove({ ...input, reason: reason!.trim() })
        if (generation !== detailGeneration) return
        selected.value = next
      }
      unknownMutation.value = null
      outcomeUnknown.value = false
      await refreshSecondary(submission.subjectId)
      return 'changed' as const
    } catch (cause) {
      if (generation !== detailGeneration) return
      error.value =
        describeBobArchiveFailure(cause) ?? messageOf(cause, '审批操作失败。')
      if (
        !(cause instanceof TargetApiError) ||
        cause.errorKey === 'invalid_response'
      ) {
        unknownMutation.value = { action, submission: input }
        outcomeUnknown.value = true
        error.value = `${error.value} 操作结果未知，请先核实后再继续。`
      }
    } finally {
      if (generation === detailGeneration) mutating.value = false
    }
  }

  const verifyOutcome = async () => {
    const pending = unknownMutation.value
    if (!pending || !canVerifyOutcome.value) return
    const generation = detailGeneration
    mutating.value = true
    error.value = null
    try {
      const result = await options.get(pending.submission)
      if (generation !== detailGeneration) return
      const expectedStatus =
        pending.action === 'approve'
          ? 'APPROVED'
          : pending.action === 'reject'
            ? 'REJECTED'
            : 'PENDING'
      const applied =
        pending.action !== 'delete' && result.status === expectedStatus
      selected.value = result
      outcomeUnknown.value = false
      unknownMutation.value = null
      if (!applied) {
        error.value = '已核实操作未生效，可以重试。'
        return 'not-changed' as const
      }
      await refreshSecondary(result.subjectId)
      return 'changed' as const
    } catch (cause) {
      if (generation !== detailGeneration) return
      if (
        pending.action === 'delete' &&
        cause instanceof TargetApiError &&
        cause.errorKey === 'approval_not_found'
      ) {
        selected.value = null
        outcomeUnknown.value = false
        unknownMutation.value = null
        await refreshSecondary(pending.submission.subjectId)
        return 'changed' as const
      }
      error.value = `${messageOf(cause, '操作结果核实失败。')} 结果仍未知。`
    } finally {
      if (generation === detailGeneration) mutating.value = false
    }
  }

  const reset = () => {
    ++listGeneration
    ++detailGeneration
    open.value = false
    loading.value = false
    mutating.value = false
    error.value = null
    refreshError.value = null
    items.value = []
    total.value = 0
    page.value = 1
    keyword.value = ''
    selectedSubjectId.value = null
    selected.value = null
    versions.value = []
    auditHistory.value = []
    outcomeUnknown.value = false
    unknownMutation.value = null
  }

  return {
    open,
    loading,
    mutating,
    error,
    refreshError,
    items,
    page,
    pageSize,
    total,
    keyword,
    selectedSubjectId,
    selected,
    versions,
    auditHistory,
    outcomeUnknown,
    canVerifyOutcome,
    canAction,
    openList: () => loadList(1, keyword.value),
    search: (value) => loadList(1, value.trim()),
    goToPage: (value) => loadList(Math.max(1, value), keyword.value),
    select,
    selectVersion,
    review,
    verifyOutcome,
    close: reset,
    dispose: reset,
  }
}
