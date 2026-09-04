export const approvalStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const

export type ApprovalStatus = (typeof approvalStatuses)[number]

export const approvalActions = [
  'reject',
  'approve',
  'unreject',
  'unapprove',
] as const

export type ApprovalAction = (typeof approvalActions)[number]

export const approvalStatusPresentation = {
  PENDING: { label: '待批准' },
  APPROVED: { label: '已批准' },
  REJECTED: { label: '已驳回' },
} as const satisfies Record<ApprovalStatus, { label: string }>

export const approvalActionPresentation = {
  reject: { label: '驳回' },
  approve: { label: '批准' },
  unreject: { label: '恢复审核' },
  unapprove: { label: '反批准' },
} as const satisfies Record<ApprovalAction, { label: string }>

export type ApprovalEventAction =
  | 'SUBMITTED'
  | 'REJECTED'
  | 'UNREJECTED'
  | 'APPROVED'
  | 'UNAPPROVED'
  | 'DELETED'

export type ApprovalErrorKey =
  | 'approval_invalid_actor'
  | 'approval_invalid_configuration'
  | 'approval_invalid_action'
  | 'approval_invalid_revision'
  | 'approval_invalid_request'
  | 'approval_invalid_preparation'
  | 'approval_not_found'
  | 'approval_version_not_found'
  | 'approval_stale_revision'
  | 'approval_invalid_transition'
  | 'approval_self_review_forbidden'
  | 'approval_reason_required'
  | 'approval_reason_not_allowed'
  | 'approval_version_history_exists'
  | 'approval_open_version_exists'
  | 'approval_no_approved_version'
  | 'approval_not_latest_approved'
  | 'approval_versioned_entry'
  | 'approval_not_versioned'
  | 'approval_version_number_conflict'
  | 'approval_conflict'
  | 'approval_event_delivery_failed'

export interface ApprovalActor {
  id: string
  permissions: readonly string[]
  trusted?: boolean
}

export interface ApprovalOccurrence {
  actorId: string
  occurredAt: string
}

export interface ApprovalRejection extends ApprovalOccurrence {
  reason: string
}

export interface ApprovalMetadata {
  submitted: ApprovalOccurrence
  approved?: ApprovalOccurrence
  rejected?: ApprovalRejection
}

export interface ApprovalEntry {
  id: string
  domain: string
  entity: string
  subjectId: string
  versionNo: number | null
  status: ApprovalStatus
  revision: string
  metadata: ApprovalMetadata
}

export interface ApprovalDecisionInput {
  action: ApprovalAction
  entry: ApprovalEntry
  actor: ApprovalActor
  expectedRevision: string
  occurredAt: string
  requestId: string
  reason?: string
}

export interface ApprovalEventPlan {
  action: ApprovalEventAction
  fromStatus: ApprovalStatus
  toStatus: ApprovalStatus
  fromRevision: string
  toRevision: string
  actorId: string
  requestId: string
  reason?: string
}

export interface ApprovalTransitionPlan {
  kind: 'approval-transition'
  action: ApprovalAction
  entryId: string
  fromStatus: ApprovalStatus
  toStatus: ApprovalStatus
  fromRevision: string
  toRevision: string
  actorId: string
  requestId: string
  reason?: string
  metadata: ApprovalMetadata
  event: ApprovalEventPlan
}

export type ApprovalDecision =
  | { ok: true; plan: ApprovalTransitionPlan }
  | { ok: false; error: { errorKey: ApprovalErrorKey } }

export interface ApprovalViewState {
  status: ApprovalStatus
  statusLabel: '待批准' | '已批准' | '已驳回'
  availableActions: ApprovalAction[]
  metadata: ApprovalMetadata
}

function routePermission(entry: ApprovalEntry, action: ApprovalAction): string {
  return `/${entry.domain}/${entry.entity}/${action}`
}

function hasPermission(
  actor: ApprovalActor,
  entry: ApprovalEntry,
  action: ApprovalAction,
): boolean {
  return (
    actor.trusted === true ||
    actor.permissions.includes(routePermission(entry, action))
  )
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function hasValidMetadata(entry: ApprovalEntry): boolean {
  if (
    !isNonEmpty(entry.metadata.submitted.actorId) ||
    !isNonEmpty(entry.metadata.submitted.occurredAt)
  )
    return false

  const approved = entry.metadata.approved
  const rejected = entry.metadata.rejected
  if (entry.status === 'PENDING')
    return approved === undefined && rejected === undefined
  if (entry.status === 'APPROVED')
    return (
      rejected === undefined &&
      approved !== undefined &&
      isNonEmpty(approved.actorId) &&
      isNonEmpty(approved.occurredAt)
    )
  return (
    approved === undefined &&
    rejected !== undefined &&
    isNonEmpty(rejected.actorId) &&
    isNonEmpty(rejected.occurredAt) &&
    isNonEmpty(rejected.reason)
  )
}

function actionIsValidForStatus(
  action: ApprovalAction,
  status: ApprovalStatus,
): boolean {
  return (
    (status === 'PENDING' && (action === 'reject' || action === 'approve')) ||
    (status === 'REJECTED' && action === 'unreject') ||
    (status === 'APPROVED' && action === 'unapprove')
  )
}

function actionRequiresIndependentReviewer(action: ApprovalAction): boolean {
  return action === 'reject' || action === 'approve' || action === 'unreject'
}

function eventAction(action: ApprovalAction): ApprovalEventAction {
  if (action === 'reject') return 'REJECTED'
  if (action === 'approve') return 'APPROVED'
  if (action === 'unreject') return 'UNREJECTED'
  return 'UNAPPROVED'
}

function targetStatus(action: ApprovalAction): ApprovalStatus {
  if (action === 'reject') return 'REJECTED'
  if (action === 'approve') return 'APPROVED'
  return 'PENDING'
}

function nextMetadata(
  input: ApprovalDecisionInput,
  reason: string | undefined,
): ApprovalMetadata {
  const { entry } = input
  if (input.action === 'approve')
    return {
      submitted: entry.metadata.submitted,
      approved: { actorId: input.actor.id, occurredAt: input.occurredAt },
    }
  if (input.action === 'reject')
    return {
      submitted: entry.metadata.submitted,
      rejected: {
        actorId: input.actor.id,
        occurredAt: input.occurredAt,
        reason: reason ?? '',
      },
    }
  if (input.action === 'unreject')
    return { submitted: entry.metadata.submitted }
  return { submitted: entry.metadata.submitted }
}

/**
 * Returns an advisory lifecycle snapshot. Mutation callers must still use
 * decideApproval with freshly loaded facts.
 */
export function availableApprovalActions(
  entry: ApprovalEntry,
  actor: ApprovalActor,
): ApprovalAction[] {
  if (!isNonEmpty(actor.id)) return []
  const isSubmitter = actor.id === entry.metadata.submitted.actorId
  return approvalActions.filter((action) => {
    if (!actionIsValidForStatus(action, entry.status)) return false
    if (actionRequiresIndependentReviewer(action) && isSubmitter) return false
    return hasPermission(actor, entry, action)
  })
}

export function projectApprovalViewState(
  entry: ApprovalEntry,
  actor: ApprovalActor,
): ApprovalViewState {
  return {
    status: entry.status,
    statusLabel: approvalStatusPresentation[entry.status].label,
    availableActions: availableApprovalActions(entry, actor),
    metadata: entry.metadata,
  }
}

/**
 * Decides one persisted Approval transition from explicit facts. It performs
 * no I/O and returns only a typed persistence plan or stable error key.
 */
export function decideApproval(input: ApprovalDecisionInput): ApprovalDecision {
  const { actor, entry } = input
  if (!isNonEmpty(actor.id))
    return { ok: false, error: { errorKey: 'approval_invalid_actor' } }
  if (
    !isNonEmpty(entry.id) ||
    !isNonEmpty(entry.domain) ||
    !isNonEmpty(entry.entity) ||
    !isNonEmpty(entry.subjectId) ||
    !isNonEmpty(input.occurredAt) ||
    !isNonEmpty(input.requestId)
  )
    return { ok: false, error: { errorKey: 'approval_invalid_request' } }
  if (!hasValidMetadata(entry) || !isPositiveRevision(entry.revision))
    return { ok: false, error: { errorKey: 'approval_invalid_preparation' } }
  if (input.expectedRevision !== entry.revision)
    return { ok: false, error: { errorKey: 'approval_stale_revision' } }
  if (!actionIsValidForStatus(input.action, entry.status))
    return { ok: false, error: { errorKey: 'approval_invalid_transition' } }
  if (
    actionRequiresIndependentReviewer(input.action) &&
    actor.id === entry.metadata.submitted.actorId
  )
    return { ok: false, error: { errorKey: 'approval_self_review_forbidden' } }
  if (!hasPermission(actor, entry, input.action))
    return { ok: false, error: { errorKey: 'approval_invalid_action' } }

  const trimmedReason = input.reason?.trim()
  const reasonRequired =
    input.action === 'reject' || input.action === 'unapprove'
  if (reasonRequired && !trimmedReason)
    return { ok: false, error: { errorKey: 'approval_reason_required' } }
  if (!reasonRequired && input.reason !== undefined)
    return { ok: false, error: { errorKey: 'approval_reason_not_allowed' } }

  const toStatus = targetStatus(input.action)
  const toRevision = (BigInt(entry.revision) + 1n).toString()
  const reason = reasonRequired ? trimmedReason : undefined
  const event: ApprovalEventPlan = {
    action: eventAction(input.action),
    fromStatus: entry.status,
    toStatus,
    fromRevision: entry.revision,
    toRevision,
    actorId: actor.id,
    requestId: input.requestId,
    ...(reason === undefined ? {} : { reason }),
  }
  return {
    ok: true,
    plan: {
      kind: 'approval-transition',
      action: input.action,
      entryId: entry.id,
      fromStatus: entry.status,
      toStatus,
      fromRevision: entry.revision,
      toRevision,
      actorId: actor.id,
      requestId: input.requestId,
      ...(reason === undefined ? {} : { reason }),
      metadata: nextMetadata(input, reason),
      event,
    },
  }
}

function isPositiveRevision(value: string): boolean {
  return /^[1-9]\d*$/.test(value)
}
