import {
  prepareSubmissionMechanics,
  type ApprovalEntry,
  type ApprovalErrorKey,
  type SubmissionCommand,
  type SubmissionMechanicsErrorKey,
  type SubmissionMechanicsPlan,
} from '@zerp/model'
import type { Transaction } from 'kysely'

import type { DB } from '../db/generated.ts'

export interface VersionedArchiveScope<
  Domain extends string = string,
  Entity extends string = string,
> {
  domain: Domain
  entity: Entity
  subjectId: string
}

type VersionedArchiveErrorKey =
  | SubmissionMechanicsErrorKey
  | Extract<ApprovalErrorKey, 'approval_not_found' | 'approval_not_versioned'>

export class VersionedArchiveError extends Error {
  readonly errorKey: VersionedArchiveErrorKey

  constructor(errorKey: VersionedArchiveErrorKey) {
    super(errorKey)
    this.name = 'VersionedArchiveError'
    this.errorKey = errorKey
  }
}

type ApprovalRow = {
  id: string
  domain: string
  entity: string
  subject_id: string
  version_no: number | null
  status: string
  revision: string | number | bigint
  submitted_by: string
  submitted_at: Date
  approved_by: string | null
  approved_at: Date | null
  rejected_by: string | null
  rejected_at: Date | null
  rejection_reason: string | null
}

function entryFromRow(row: ApprovalRow): ApprovalEntry {
  if (row.version_no === null)
    throw new VersionedArchiveError('approval_not_versioned')
  return {
    id: row.id,
    domain: row.domain,
    entity: row.entity,
    subjectId: row.subject_id,
    versionNo: row.version_no,
    status: row.status as ApprovalEntry['status'],
    revision: String(row.revision),
    metadata: {
      submitted: {
        actorId: row.submitted_by,
        occurredAt: row.submitted_at.toISOString(),
      },
      ...(row.approved_by && row.approved_at
        ? {
            approved: {
              actorId: row.approved_by,
              occurredAt: row.approved_at.toISOString(),
            },
          }
        : {}),
      ...(row.rejected_by && row.rejected_at && row.rejection_reason
        ? {
            rejected: {
              actorId: row.rejected_by,
              occurredAt: row.rejected_at.toISOString(),
              reason: row.rejection_reason,
            },
          }
        : {}),
    },
  }
}

/**
 * Shared version selection and submission mechanics over approval_entries.
 * Every method uses the caller's transaction and an explicit resource scope,
 * so BOB and WFL can compose it without a registry or domain adapter.
 */
export class VersionedArchives {
  async history(
    tx: Transaction<DB>,
    scope: VersionedArchiveScope,
    lock = false,
  ): Promise<ApprovalEntry[]> {
    let query = tx
      .selectFrom('approval_entries')
      .selectAll()
      .where('domain', '=', scope.domain)
      .where('entity', '=', scope.entity)
      .where('subject_id', '=', scope.subjectId)
      .orderBy('version_no', 'desc')
    if (lock) query = query.forUpdate()
    return (await query.execute()).map(entryFromRow)
  }

  async exact(
    tx: Transaction<DB>,
    scope: VersionedArchiveScope,
    submissionId: string,
    lock = false,
  ): Promise<ApprovalEntry | null> {
    let query = tx
      .selectFrom('approval_entries')
      .selectAll()
      .where('id', '=', submissionId)
      .where('domain', '=', scope.domain)
      .where('entity', '=', scope.entity)
      .where('subject_id', '=', scope.subjectId)
    if (lock) query = query.forUpdate()
    const row = await query.executeTakeFirst()
    return row ? entryFromRow(row) : null
  }

  async open(
    tx: Transaction<DB>,
    scope: VersionedArchiveScope,
    lock = false,
  ): Promise<ApprovalEntry | null> {
    const history = await this.history(tx, scope, lock)
    const open = history.filter(
      (entry) => entry.status === 'PENDING' || entry.status === 'REJECTED',
    )
    if (open.length > 1)
      throw new VersionedArchiveError('archive_invalid_history')
    return open[0] ?? null
  }

  async latestApproved(
    tx: Transaction<DB>,
    scope: VersionedArchiveScope,
    lock = false,
  ): Promise<ApprovalEntry | null> {
    const history = await this.history(tx, scope, lock)
    return history.find((entry) => entry.status === 'APPROVED') ?? null
  }

  async prepareSubmission(
    tx: Transaction<DB>,
    scope: VersionedArchiveScope,
    subjectExists: boolean,
    command: SubmissionCommand,
  ): Promise<SubmissionMechanicsPlan> {
    if (command.subjectId.trim() !== scope.subjectId.trim())
      throw new VersionedArchiveError('archive_invalid_command')
    const history = await this.history(tx, scope, true)
    const decision = prepareSubmissionMechanics(
      { domain: scope.domain, entity: scope.entity },
      command,
      {
        subject: {
          exists: subjectExists,
          history: history.map((entry) => ({
            entryId: entry.id,
            versionNo: entry.versionNo ?? 0,
            status: entry.status,
            revision: entry.revision,
          })),
        },
      },
    )
    if (!decision.ok) throw new VersionedArchiveError(decision.error.errorKey)
    return decision.plan
  }
}
