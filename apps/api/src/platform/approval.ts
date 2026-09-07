import {
  decideApproval,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalErrorKey,
} from '@zerp/model'
import type { Kysely, Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { DB } from '../db/generated.ts'

type ApprovalExecutor = Kysely<DB> | Transaction<DB>

export interface ApprovalEntryLocator {
  entryId: string
  domain: string
  entity: string
  subjectId: string
}

export type ApprovalSubjectScope = Omit<ApprovalEntryLocator, 'entryId'>

export interface ApprovalAuditEvent {
  id: string
  entryId: string
  domain: string
  entity: string
  subjectId: string
  versionNo: number | null
  action:
    | 'SUBMITTED'
    | 'REJECTED'
    | 'UNREJECTED'
    | 'APPROVED'
    | 'UNAPPROVED'
    | 'DELETED'
  fromStatus: ApprovalEntry['status'] | null
  toStatus: ApprovalEntry['status'] | null
  fromRevision: string | null
  toRevision: string | null
  actorId: string
  reason: string | null
  requestId: string
  createdAt: string
}

export interface ApprovalCreateInput extends ApprovalEntryLocator {
  versionNo: number | null
  actorId: string
  occurredAt: Date
  requestId: string
}

export interface ApprovalTransitionInput {
  entry: ApprovalEntry
  action: ApprovalAction
  actor: ApprovalActor
  expectedRevision: string
  occurredAt: Date
  requestId: string
  reason?: string
}

export interface ApprovalDeleteInput {
  entry: ApprovalEntry
  actor: ApprovalActor
  expectedRevision: string
  occurredAt: Date
  requestId: string
}

export class ApprovalPersistenceError extends Error {
  readonly errorKey: ApprovalErrorKey

  constructor(errorKey: ApprovalErrorKey) {
    super(errorKey)
    this.name = 'ApprovalPersistenceError'
    this.errorKey = errorKey
  }
}

function entryFromRow(row: {
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
}): ApprovalEntry {
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
 * Persists the complete shared Approval lifecycle on a caller-owned transaction.
 * Domain services keep their blockers and effects around this seam; this class
 * never opens or commits a transaction of its own.
 */
export class ApprovalPersistence {
  async auditHistory(
    tx: ApprovalExecutor,
    scope: ApprovalSubjectScope,
  ): Promise<ApprovalAuditEvent[]> {
    const rows = await tx
      .selectFrom('approval_events')
      .selectAll()
      .where('domain', '=', scope.domain)
      .where('entity', '=', scope.entity)
      .where('subject_id', '=', scope.subjectId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute()
    return rows.map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      domain: row.domain,
      entity: row.entity,
      subjectId: row.subject_id,
      versionNo: row.version_no,
      action: row.action as ApprovalAuditEvent['action'],
      fromStatus: row.from_status as ApprovalEntry['status'] | null,
      toStatus: row.to_status as ApprovalEntry['status'] | null,
      fromRevision:
        row.from_revision === null ? null : String(row.from_revision),
      toRevision: row.to_revision === null ? null : String(row.to_revision),
      actorId: row.actor_id,
      reason: row.reason,
      requestId: row.request_id,
      createdAt: row.created_at.toISOString(),
    }))
  }

  async load(
    tx: ApprovalExecutor,
    locator: ApprovalEntryLocator,
    lock = false,
  ): Promise<ApprovalEntry> {
    let query = tx
      .selectFrom('approval_entries')
      .selectAll()
      .where('id', '=', locator.entryId)
      .where('domain', '=', locator.domain)
      .where('entity', '=', locator.entity)
      .where('subject_id', '=', locator.subjectId)
    if (lock) query = query.forUpdate()
    const row = await query.executeTakeFirst()
    if (!row) throw new ApprovalPersistenceError('approval_not_found')
    return entryFromRow(row)
  }

  async create(
    tx: Transaction<DB>,
    input: ApprovalCreateInput,
  ): Promise<ApprovalEntry> {
    const submitted = {
      actorId: input.actorId,
      occurredAt: input.occurredAt.toISOString(),
    }
    await tx
      .insertInto('approval_entries')
      .values({
        id: input.entryId,
        domain: input.domain,
        entity: input.entity,
        subject_id: input.subjectId,
        version_no: input.versionNo,
        status: 'PENDING',
        revision: '1',
        submitted_by: input.actorId,
        submitted_at: input.occurredAt,
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        updated_by: input.actorId,
        updated_at: input.occurredAt,
      })
      .execute()
    await tx
      .insertInto('approval_events')
      .values({
        id: ulid(),
        entry_id: input.entryId,
        domain: input.domain,
        entity: input.entity,
        subject_id: input.subjectId,
        version_no: input.versionNo,
        action: 'SUBMITTED',
        from_status: null,
        to_status: 'PENDING',
        from_revision: null,
        to_revision: '1',
        actor_id: input.actorId,
        reason: null,
        request_id: input.requestId,
        created_at: input.occurredAt,
      })
      .execute()
    return {
      id: input.entryId,
      domain: input.domain,
      entity: input.entity,
      subjectId: input.subjectId,
      versionNo: input.versionNo,
      status: 'PENDING',
      revision: '1',
      metadata: { submitted },
    }
  }

  async transition(
    tx: Transaction<DB>,
    input: ApprovalTransitionInput,
  ): Promise<ApprovalEntry> {
    const decision = decideApproval({
      action: input.action,
      entry: input.entry,
      actor: input.actor,
      expectedRevision: input.expectedRevision,
      occurredAt: input.occurredAt.toISOString(),
      requestId: input.requestId,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    })
    if (!decision.ok)
      throw new ApprovalPersistenceError(decision.error.errorKey)
    const plan = decision.plan
    const updated = await tx
      .updateTable('approval_entries')
      .set({
        status: plan.toStatus,
        revision: plan.toRevision,
        approved_by: plan.metadata.approved?.actorId ?? null,
        approved_at: plan.metadata.approved
          ? new Date(plan.metadata.approved.occurredAt)
          : null,
        rejected_by: plan.metadata.rejected?.actorId ?? null,
        rejected_at: plan.metadata.rejected
          ? new Date(plan.metadata.rejected.occurredAt)
          : null,
        rejection_reason: plan.metadata.rejected?.reason ?? null,
        updated_by: input.actor.id,
        updated_at: input.occurredAt,
      })
      .where('id', '=', input.entry.id)
      .where('revision', '=', plan.fromRevision)
      .executeTakeFirst()
    if (Number(updated.numUpdatedRows) !== 1)
      throw new ApprovalPersistenceError('approval_stale_revision')
    await tx
      .insertInto('approval_events')
      .values({
        id: ulid(),
        entry_id: input.entry.id,
        domain: input.entry.domain,
        entity: input.entry.entity,
        subject_id: input.entry.subjectId,
        version_no: input.entry.versionNo,
        action: plan.event.action,
        from_status: plan.fromStatus,
        to_status: plan.toStatus,
        from_revision: plan.fromRevision,
        to_revision: plan.toRevision,
        actor_id: input.actor.id,
        reason: plan.reason ?? null,
        request_id: input.requestId,
        created_at: input.occurredAt,
      })
      .execute()
    return {
      ...input.entry,
      status: plan.toStatus,
      revision: plan.toRevision,
      metadata: plan.metadata,
    }
  }

  async delete(tx: Transaction<DB>, input: ApprovalDeleteInput): Promise<void> {
    const { actor, entry } = input
    if (input.expectedRevision !== entry.revision)
      throw new ApprovalPersistenceError('approval_stale_revision')
    if (entry.status !== 'PENDING' && entry.status !== 'REJECTED')
      throw new ApprovalPersistenceError('approval_invalid_transition')
    if (entry.metadata.submitted.actorId !== actor.id)
      throw new ApprovalPersistenceError('approval_invalid_actor')
    if (
      actor.trusted !== true &&
      !actor.permissions.includes(`/${entry.domain}/${entry.entity}/delete`)
    )
      throw new ApprovalPersistenceError('approval_invalid_action')
    const deleted = await tx
      .deleteFrom('approval_entries')
      .where('id', '=', entry.id)
      .where('revision', '=', entry.revision)
      .executeTakeFirst()
    if (Number(deleted.numDeletedRows) !== 1)
      throw new ApprovalPersistenceError('approval_stale_revision')
    await tx
      .insertInto('approval_events')
      .values({
        id: ulid(),
        entry_id: entry.id,
        domain: entry.domain,
        entity: entry.entity,
        subject_id: entry.subjectId,
        version_no: entry.versionNo,
        action: 'DELETED',
        from_status: entry.status,
        to_status: null,
        from_revision: entry.revision,
        to_revision: null,
        actor_id: actor.id,
        reason: null,
        request_id: input.requestId,
        created_at: input.occurredAt,
      })
      .execute()
  }
}
