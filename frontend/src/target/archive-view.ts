import type { ApprovalAction, ApprovalStatus } from '@zerp/model'

import type { TargetArchiveEntity } from './api.ts'

export interface ArchiveSubmissionListView {
  entity: TargetArchiveEntity
  subjectId: string
  code: string | null
  submissionId: string
  versionNo: number
  status: ApprovalStatus
  revision: string
  availableApprovalActions: ApprovalAction[]
  canDelete: boolean
  validity: ArchiveValidity | null
}

export interface ArchiveSubmissionView extends ArchiveSubmissionListView {
  snapshot: unknown
}

export interface ArchiveValidity {
  status: 'VALID' | 'INVALID'
  diagnostic: string | null
}

export function archiveValidityPresentation(validity: ArchiveValidity) {
  return {
    label: validity.status === 'VALID' ? '技术有效' : '技术失效',
    diagnostic: validity.diagnostic,
  }
}

export function parseArchiveSubmissionPage(
  entity: TargetArchiveEntity,
  payload: unknown,
): ArchiveSubmissionView[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return []
  return payload.items.flatMap((item) => {
    const submission = parseArchiveSubmission(entity, item)
    return submission ? [submission] : []
  })
}

export function parseArchiveQueryPage(
  entity: TargetArchiveEntity,
  payload: unknown,
): { submissions: ArchiveSubmissionListView[]; total: number } {
  if (!isRecord(payload) || !Array.isArray(payload.items))
    return { submissions: [], total: 0 }
  return {
    submissions: payload.items.flatMap((item) => {
      if (!isRecord(item)) return []
      return [item.latestApproved, item.openCandidate].flatMap((candidate) => {
        const submission = parseArchiveSubmissionListItem(entity, candidate)
        return submission ? [submission] : []
      })
    }),
    total:
      typeof payload.total === 'number' && payload.total >= 0
        ? payload.total
        : 0,
  }
}

export function parseArchiveSubmission(
  entity: TargetArchiveEntity,
  value: unknown,
): ArchiveSubmissionView | null {
  const listItem = parseArchiveSubmissionListItem(entity, value)
  if (!listItem || !isRecord(value) || !('snapshot' in value)) return null
  return { ...listItem, snapshot: value.snapshot }
}

function parseArchiveSubmissionListItem(
  entity: TargetArchiveEntity,
  value: unknown,
): ArchiveSubmissionListView | null {
  if (!isRecord(value)) return null
  if (
    typeof value.subjectId !== 'string' ||
    typeof value.submissionId !== 'string' ||
    typeof value.versionNo !== 'number' ||
    typeof value.revision !== 'string' ||
    !isApprovalStatus(value.status) ||
    !Array.isArray(value.availableApprovalActions) ||
    !value.availableApprovalActions.every(isApprovalAction) ||
    typeof value.canDelete !== 'boolean'
  )
    return null
  return {
    entity,
    subjectId: value.subjectId,
    code: typeof value.code === 'string' ? value.code : null,
    submissionId: value.submissionId,
    versionNo: value.versionNo,
    status: value.status,
    revision: value.revision,
    availableApprovalActions: value.availableApprovalActions,
    canDelete: value.canDelete,
    validity:
      entity === 'rpt-definition' ? parseArchiveValidity(value.validity) : null,
  }
}

function parseArchiveValidity(value: unknown): ArchiveValidity | null {
  if (value === null || value === undefined) return null
  if (
    !isRecord(value) ||
    (value.status !== 'VALID' && value.status !== 'INVALID') ||
    (value.diagnostic !== null && typeof value.diagnostic !== 'string')
  )
    return null
  return { status: value.status, diagnostic: value.diagnostic }
}

export function latestApproved<View extends ArchiveSubmissionListView>(
  submissions: readonly View[],
): View | null {
  return (
    submissions
      .filter((submission) => submission.status === 'APPROVED')
      .sort((left, right) => right.versionNo - left.versionNo)[0] ?? null
  )
}

export function isLatestSubmission(
  submission: ArchiveSubmissionListView,
  submissions: readonly ArchiveSubmissionListView[],
): boolean {
  const latest = submissions
    .filter((candidate) => candidate.subjectId === submission.subjectId)
    .sort((left, right) => right.versionNo - left.versionNo)[0]
  return latest?.submissionId === submission.submissionId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isApprovalStatus(value: unknown): value is ApprovalStatus {
  return value === 'PENDING' || value === 'APPROVED' || value === 'REJECTED'
}

function isApprovalAction(value: unknown): value is ApprovalAction {
  return (
    value === 'approve' ||
    value === 'reject' ||
    value === 'unreject' ||
    value === 'unapprove'
  )
}
