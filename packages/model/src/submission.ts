import type { ApprovalActor, ApprovalStatus } from './approval.ts'

export type SubmitAction = 'submit-new' | 'submit-change'

export interface VersionFact {
  entryId: string
  versionNo: number
  revision: string
  status: ApprovalStatus
}

export interface VersionedSubjectFacts {
  exists: boolean
  history: readonly VersionFact[]
}

export interface SubmissionCommand {
  action: SubmitAction
  actor: ApprovalActor
  requestId: string
  occurredAt: string
  submissionId: string
  idempotencyKey: string
  subjectId: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
}

export interface SubmissionFacts {
  subject: VersionedSubjectFacts
}

export type SubmissionMechanicsErrorKey =
  | 'approval_invalid_actor'
  | 'approval_invalid_action'
  | 'approval_no_approved_version'
  | 'approval_open_version_exists'
  | 'archive_invalid_history'
  | 'archive_stale_facts'
  | 'archive_submit_mode_mismatch'
  | 'archive_invalid_command'

export interface SubmissionMechanicsPlan {
  mode: 'new' | 'change'
  createSubject: boolean
  allocateCode: boolean
  subjectId: string
  submissionId: string
  idempotencyKey: string
  versionNo: number
  approval: {
    status: 'PENDING'
    revision: '1'
    submitted: { actorId: string; occurredAt: string }
    event: {
      action: 'SUBMITTED'
      actorId: string
      requestId: string
      toStatus: 'PENDING'
      toRevision: '1'
    }
  }
}

export type SubmissionMechanicsDecision =
  | { ok: true; plan: SubmissionMechanicsPlan }
  | { ok: false; error: { errorKey: SubmissionMechanicsErrorKey } }

const text = (value: string): string => value.trim()
const hasText = (value: string): boolean => text(value).length > 0

function validHistory(history: readonly VersionFact[]): boolean {
  const versions = new Set<number>()
  let open = 0
  for (const version of history) {
    if (
      !hasText(version.entryId) ||
      !Number.isInteger(version.versionNo) ||
      version.versionNo < 1 ||
      !/^[1-9]\d*$/.test(version.revision) ||
      versions.has(version.versionNo)
    )
      return false
    versions.add(version.versionNo)
    if (version.status === 'PENDING' || version.status === 'REJECTED') open += 1
  }
  return open <= 1
}

/**
 * Shared submission mechanics only: explicit actor/permission, open-version,
 * latest-approved and revision facts. Entity validation never lives here.
 */
export function prepareSubmissionMechanics(
  entity: string,
  command: SubmissionCommand,
  facts: SubmissionFacts,
): SubmissionMechanicsDecision {
  if (!hasText(command.actor.id))
    return { ok: false, error: { errorKey: 'approval_invalid_actor' } }
  if (
    command.actor.trusted !== true &&
    !command.actor.permissions.includes(`/dcl/${entity}/${command.action}`)
  )
    return { ok: false, error: { errorKey: 'approval_invalid_action' } }
  if (
    !hasText(command.requestId) ||
    !hasText(command.occurredAt) ||
    !hasText(command.submissionId) ||
    !hasText(command.idempotencyKey) ||
    !hasText(command.subjectId) ||
    text(command.submissionId) !== text(command.idempotencyKey)
  )
    return { ok: false, error: { errorKey: 'archive_invalid_command' } }
  if (!validHistory(facts.subject.history))
    return { ok: false, error: { errorKey: 'archive_invalid_history' } }

  const mode = facts.subject.exists ? 'change' : 'new'
  if (command.action !== `submit-${mode}`)
    return { ok: false, error: { errorKey: 'archive_submit_mode_mismatch' } }
  if (!facts.subject.exists && facts.subject.history.length !== 0)
    return { ok: false, error: { errorKey: 'archive_invalid_history' } }

  const approved = facts.subject.history.filter(
    (version) => version.status === 'APPROVED',
  )
  const open = facts.subject.history.find(
    (version) => version.status === 'PENDING' || version.status === 'REJECTED',
  )
  if (facts.subject.exists && approved.length === 0)
    return { ok: false, error: { errorKey: 'approval_no_approved_version' } }
  if (open)
    return { ok: false, error: { errorKey: 'approval_open_version_exists' } }
  const latest = approved.reduce<VersionFact | undefined>(
    (previous, version) =>
      previous === undefined || version.versionNo > previous.versionNo
        ? version
        : previous,
    undefined,
  )
  if (
    (mode === 'new' &&
      (command.expectedLatestApprovedSubmissionId !== null ||
        command.expectedLatestApprovedRevision !== null)) ||
    (mode === 'change' &&
      (latest === undefined ||
        command.expectedLatestApprovedSubmissionId !== latest.entryId ||
        command.expectedLatestApprovedRevision !== latest.revision))
  )
    return { ok: false, error: { errorKey: 'archive_stale_facts' } }

  return {
    ok: true,
    plan: {
      mode,
      createSubject: mode === 'new',
      allocateCode: mode === 'new',
      subjectId: text(command.subjectId),
      submissionId: text(command.submissionId),
      idempotencyKey: text(command.idempotencyKey),
      versionNo: latest === undefined ? 1 : latest.versionNo + 1,
      approval: {
        status: 'PENDING',
        revision: '1',
        submitted: {
          actorId: text(command.actor.id),
          occurredAt: text(command.occurredAt),
        },
        event: {
          action: 'SUBMITTED',
          actorId: text(command.actor.id),
          requestId: text(command.requestId),
          toStatus: 'PENDING',
          toRevision: '1',
        },
      },
    },
  }
}
