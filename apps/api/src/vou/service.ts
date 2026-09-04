import { createHash } from 'node:crypto'

import {
  availableApprovalActions,
  prepareVouApproval,
  prepareVouSubmission,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
  type VouEntity,
  type VouPayload,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { DB, JsonValue } from '../db/generated.ts'
import {
  ApplicationTransactionCoordinator,
  type AccApplicationPlan,
  type PlanExecutor,
  type WflApplicationPlan,
} from '../platform/transaction-coordinator.ts'

type Executor = Kysely<DB> | Transaction<DB>

export interface VouSubmitInput {
  documentId: string
  submissionId: string
  idempotencyKey: string
  expectedRevision: string | null
  payload: VouPayload
}

export interface VouReviewInput {
  documentId: string
  submissionId: string
  expectedRevision: string
  reason?: string
}

export interface VouView {
  entity: VouEntity
  documentId: string
  documentNo: string
  stableRevision: string
  submissionId: string
  status: ApprovalStatus
  revision: string
  submittedBy: string
  submittedAt: string
  approvedBy: string | null
  approvedAt: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  payload: VouPayload
  availableApprovalActions: ApprovalAction[]
  canDelete: boolean
}

export interface VouAttachmentStageInput {
  stagingId: string
  fileId: string
  fileName: string
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
  size: number
  digest: string
  contentBase64: string
}

export class VouApplicationError extends Error {
  readonly errorKey: string
  readonly data: { blockers: unknown[] } | null

  constructor(errorKey: string, blockers: unknown[] = []) {
    super(errorKey)
    this.name = 'VouApplicationError'
    this.errorKey = errorKey
    this.data = blockers.length === 0 ? null : { blockers }
  }
}

function requirePermission(actor: ApprovalActor, path: string): void {
  if (actor.trusted !== true && !actor.permissions.includes(path))
    throw new VouApplicationError('approval_invalid_action')
}

function requestHash(action: string, entity: VouEntity, input: VouSubmitInput) {
  return createHash('sha256')
    .update(stableJson({ action, entity, input }))
    .digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function json(value: unknown): JsonValue {
  return value as JsonValue
}

function contentMatches(
  mimeType: VouAttachmentStageInput['mimeType'],
  content: Buffer,
): boolean {
  if (mimeType === 'application/pdf') return content.subarray(0, 5).toString() === '%PDF-'
  if (mimeType === 'image/png')
    return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return content[0] === 0xff && content[1] === 0xd8 && content[content.length - 2] === 0xff && content[content.length - 1] === 0xd9
}

function entryFromRow(row: {
  id: string
  entity: string
  subject_id: string
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
  const status = row.status as ApprovalStatus
  return {
    id: row.id,
    domain: 'vou',
    entity: row.entity,
    subjectId: row.subject_id,
    versionNo: null,
    status,
    revision: String(row.revision),
    metadata: {
      submitted: { actorId: row.submitted_by, occurredAt: row.submitted_at.toISOString() },
      ...(status === 'APPROVED' && row.approved_by && row.approved_at
        ? { approved: { actorId: row.approved_by, occurredAt: row.approved_at.toISOString() } }
        : {}),
      ...(status === 'REJECTED' && row.rejected_by && row.rejected_at && row.rejection_reason
        ? { rejected: { actorId: row.rejected_by, occurredAt: row.rejected_at.toISOString(), reason: row.rejection_reason } }
        : {}),
    },
  }
}

export class VouService {
  private readonly db: Kysely<DB>
  private readonly accEffects: PlanExecutor<AccApplicationPlan>
  private readonly wflEffects: PlanExecutor<WflApplicationPlan>

  constructor(
    db: Kysely<DB>,
    effects: {
      acc?: PlanExecutor<AccApplicationPlan>
      wfl?: PlanExecutor<WflApplicationPlan>
    } = {},
  ) {
    this.db = db
    const noop = { async apply() {} }
    this.accEffects = effects.acc ?? noop
    this.wflEffects = effects.wfl ?? noop
  }

  async stageAttachment(input: VouAttachmentStageInput, actor: ApprovalActor) {
    if (!actor.id.trim()) throw new VouApplicationError('approval_invalid_actor')
    const content = Buffer.from(input.contentBase64, 'base64')
    if (content.length !== input.size || input.size < 1 || input.size > 10_485_760)
      throw new VouApplicationError('vou_attachment_size_invalid')
    if (!contentMatches(input.mimeType, content))
      throw new VouApplicationError('vou_attachment_type_invalid')
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== input.digest)
      throw new VouApplicationError('vou_attachment_digest_invalid')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000)
    await this.db.transaction().execute(async (tx) => {
      const existing = await tx.selectFrom('vou_attachment_staging').selectAll()
        .where('id', '=', input.stagingId).forUpdate().executeTakeFirst()
      if (existing) {
        if (existing.owner_user_id !== actor.id || existing.file_id !== input.fileId || existing.digest !== digest || existing.mime_type !== input.mimeType || existing.size_bytes !== input.size)
          throw new VouApplicationError('vou_attachment_staging_conflict')
        await tx.updateTable('vou_attachment_staging').set({ expires_at: expiresAt })
          .where('id', '=', input.stagingId).execute()
        return
      }
      await tx.insertInto('vou_attachment_staging').values({
        id: input.stagingId,
        file_id: input.fileId,
        owner_user_id: actor.id,
        file_name: input.fileName,
        mime_type: input.mimeType,
        size_bytes: input.size,
        digest,
        content,
        created_at: now,
        expires_at: expiresAt,
      }).execute()
    })
    return { ...input, contentBase64: undefined, expiresAt: expiresAt.toISOString() }
  }

  async cleanupAttachments(actor: ApprovalActor): Promise<number> {
    if (actor.trusted !== true)
      throw new VouApplicationError('approval_invalid_action')
    const result = await this.db.deleteFrom('vou_attachment_staging')
      .where('expires_at', '<=', new Date()).executeTakeFirst()
    return Number(result.numDeletedRows)
  }

  async submit(
    entity: VouEntity,
    action: 'submit-new' | 'submit-change',
    input: VouSubmitInput,
    actor: ApprovalActor,
    requestId: string,
    trustedSystemActor = false,
  ): Promise<VouView> {
    requirePermission(actor, `/vou/${entity}/${action}`)
    const hash = requestHash(action, entity, input)
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:idempotency:${entity}:${input.idempotencyKey}`}, 0))`.execute(tx)
      const prior = await tx.selectFrom('vou_idempotency').select(['request_hash', 'response'])
        .where('entity', '=', entity).where('idempotency_key', '=', input.idempotencyKey).executeTakeFirst()
      if (prior) {
        if (prior.request_hash !== hash)
          throw new VouApplicationError('vou_idempotency_conflict')
        return prior.response as unknown as VouView
      }
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:document:${input.documentId}`}, 0))`.execute(tx)
      const document = await tx.selectFrom('vou_documents').selectAll()
        .where('id', '=', input.documentId).forUpdate().executeTakeFirst()
      if (document && document.entity !== entity)
        throw new VouApplicationError('vou_document_entity_mismatch')
      const current = await tx.selectFrom('approval_entries').select('id')
        .where('domain', '=', 'vou').where('subject_id', '=', input.documentId).executeTakeFirst()
      const periodMonth = input.payload.businessDate.slice(0, 7)
      const locked = await tx.selectFrom('acc_periods').select('book_id')
        .where('period_month', '=', periodMonth).where('locked', '=', true).executeTakeFirst()
      if (input.payload.parentDocumentId) {
        const parent = await tx.selectFrom('vou_documents').select(['id', 'entity'])
          .where('id', '=', input.payload.parentDocumentId).executeTakeFirst()
        if (!parent || parent.entity !== input.payload.parentEntity || parent.id === input.documentId)
          throw new VouApplicationError('vou_parent_invalid')
      }
      const decision = prepareVouSubmission({ action, entity, ...input }, {
        actor,
        documentExists: document !== undefined,
        currentSubmissionId: current?.id ?? null,
        currentRevision: document ? String(document.stable_revision) : null,
        referencesValid: true,
        periodOpen: locked === undefined,
        trustedSystemActor,
      })
      if (!decision.ok) throw new VouApplicationError(decision.errorKey)
      const now = new Date()
      let documentNo = document?.document_no
      if (!document) {
        const counter = await tx.selectFrom('object_number_counters').select('last_value')
          .where('domain', '=', 'vou').where('entity', '=', entity).forUpdate().executeTakeFirst()
        const next = (counter?.last_value ?? 0) + 1
        if (counter)
          await tx.updateTable('object_number_counters').set({ last_value: next })
            .where('domain', '=', 'vou').where('entity', '=', entity).execute()
        else
          await tx.insertInto('object_number_counters').values({ domain: 'vou', entity, last_value: next }).execute()
        documentNo = `${entity.toUpperCase().replaceAll('-', '').slice(0, 16)}-${input.payload.businessDate.replaceAll('-', '')}-${String(next).padStart(4, '0')}`
        await tx.insertInto('vou_documents').values({
          id: input.documentId, entity, document_no: documentNo,
          created_at: now, created_by: actor.id,
        }).execute()
      }
      await this.validateStaging(tx, input.payload, actor.id)
      await tx.insertInto('approval_entries').values({
        id: input.submissionId, domain: 'vou', entity, subject_id: input.documentId,
        version_no: null, status: 'PENDING', revision: 1,
        submitted_by: actor.id, submitted_at: now, updated_by: actor.id, updated_at: now,
      }).execute()
      await tx.insertInto('vou_document_payloads').values({
        approval_entry_id: input.submissionId, document_id: input.documentId,
        business_date: new Date(`${input.payload.businessDate}T00:00:00.000Z`),
        currency: input.payload.currency, amount: input.payload.amount,
        parent_entity: input.payload.parentEntity ?? null,
        parent_document_id: input.payload.parentDocumentId ?? null,
        payload: json(input.payload),
      }).execute()
      await this.promoteAttachments(tx, input.submissionId, input.payload, actor.id, now)
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: input.submissionId, domain: 'vou', entity,
        subject_id: input.documentId, version_no: null, action: 'SUBMITTED',
        from_status: null, to_status: 'PENDING', from_revision: null, to_revision: 1,
        actor_id: actor.id, reason: null, request_id: requestId, created_at: now,
      }).execute()
      const view = await this.readView(tx, entity, input.documentId, actor)
      await tx.insertInto('vou_idempotency').values({
        entity, idempotency_key: input.idempotencyKey, request_hash: hash,
        document_id: input.documentId, submission_id: input.submissionId,
        response: json(view), created_at: now,
      }).execute()
      return view
    })
  }

  async review(
    entity: VouEntity,
    action: ApprovalAction,
    input: VouReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<VouView> {
    requirePermission(actor, `/vou/${entity}/${action}`)
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:document:${input.documentId}`}, 0))`.execute(tx)
      const row = await tx.selectFrom('approval_entries').selectAll()
        .where('id', '=', input.submissionId).where('domain', '=', 'vou')
        .where('entity', '=', entity).where('subject_id', '=', input.documentId)
        .forUpdate().executeTakeFirst()
      if (!row) throw new VouApplicationError('approval_not_found')
      if (String(row.revision) !== input.expectedRevision)
        throw new VouApplicationError('approval_stale_revision')
      const blockers = action === 'unapprove'
        ? await this.downstreamBlockers(tx, input.documentId)
        : []
      const payloadRow = await tx.selectFrom('vou_document_payloads as p')
        .innerJoin('vou_documents as d', 'd.id', 'p.document_id')
        .select(['p.payload', 'd.document_no']).where('p.approval_entry_id', '=', row.id).executeTakeFirstOrThrow()
      const effectAction = action === 'approve' ? 'approve' : action === 'unapprove' ? 'unapprove' : null
      const occurredAtIso = new Date().toISOString()
      const decision = prepareVouApproval(action, entryFromRow(row), actor, {
        irreversibleBlockers: blockers,
        accounting: { kind: action === 'approve' ? 'POST' : action === 'unapprove' ? 'REVERSE' : 'NONE', bookIds: [] },
        inventory: { kind: 'NONE', lineCount: 0 },
        workflow: { kind: action === 'approve' ? 'START_OR_CONTINUE' : action === 'unapprove' ? 'REVERSE' : 'NONE' },
      }, input.reason, { occurredAt: occurredAtIso, requestId })
      if (!decision.ok)
        throw new VouApplicationError(decision.errorKey, [...(decision.blockers ?? [])])
      const plan = decision.plan.approval
      const occurredAt = new Date(occurredAtIso)
      const coordinator = new ApplicationTransactionCoordinator({
        approval: { apply: async (transaction) => {
          await transaction.updateTable('approval_entries').set({
            status: plan.toStatus, revision: BigInt(plan.toRevision), updated_by: actor.id, updated_at: occurredAt,
            approved_by: plan.metadata.approved?.actorId ?? null,
            approved_at: plan.metadata.approved ? new Date(plan.metadata.approved.occurredAt) : null,
            rejected_by: plan.metadata.rejected?.actorId ?? null,
            rejected_at: plan.metadata.rejected ? new Date(plan.metadata.rejected.occurredAt) : null,
            rejection_reason: plan.metadata.rejected?.reason ?? null,
          }).where('id', '=', row.id).where('revision', '=', plan.fromRevision).executeTakeFirstOrThrow()
          await transaction.insertInto('approval_events').values({
            id: ulid(), entry_id: row.id, domain: 'vou', entity, subject_id: input.documentId,
            version_no: null, action: plan.event.action, from_status: plan.fromStatus,
            to_status: plan.toStatus, from_revision: BigInt(plan.fromRevision), to_revision: BigInt(plan.toRevision),
            actor_id: actor.id, reason: plan.reason ?? null, request_id: requestId, created_at: occurredAt,
          }).execute()
        } },
        vou: { async apply() {} },
        acc: this.accEffects,
        wfl: this.wflEffects,
        rpt: { async apply() {} },
      })
      await coordinator.execute(tx, {
        approval: { kind: 'approval', transition: plan, entity, documentId: input.documentId },
        vou: { kind: 'vou', ...(effectAction ? { action: effectAction } : {}), documentId: input.documentId },
        ...(effectAction ? {
          acc: { kind: 'acc', action: effectAction, entity, documentId: input.documentId, documentNo: payloadRow.document_no, approvalEntryId: row.id, approvalRevision: plan.toRevision, payload: payloadRow.payload as unknown as VouPayload, occurredAt: occurredAt.toISOString() },
          wfl: { kind: 'wfl', action: effectAction, entity, documentId: input.documentId, approvalEntryId: row.id, payload: payloadRow.payload as unknown as VouPayload, actorId: actor.id, occurredAt: occurredAt.toISOString() },
        } : {}),
      })
      return this.readView(tx, entity, input.documentId, actor)
    })
  }

  async get(entity: VouEntity, documentId: string, actor: ApprovalActor) {
    requirePermission(actor, `/vou/${entity}/get`)
    return this.readView(this.db, entity, documentId, actor)
  }

  async query(entity: VouEntity, actor: ApprovalActor): Promise<VouView[]> {
    requirePermission(actor, `/vou/${entity}/query`)
    const rows = await this.db.selectFrom('vou_documents').select('id')
      .where('entity', '=', entity).orderBy('document_no', 'desc').execute()
    return Promise.all(rows.map((row) => this.readView(this.db, entity, row.id, actor)))
  }

  async auditHistory(entity: VouEntity, documentId: string, actor: ApprovalActor) {
    requirePermission(actor, `/vou/${entity}/audit-history`)
    const rows = await this.db.selectFrom('approval_events').selectAll()
      .where('domain', '=', 'vou').where('entity', '=', entity)
      .where('subject_id', '=', documentId).orderBy('created_at', 'asc').execute()
    return rows.map((row) => ({
      id: row.id, submissionId: row.entry_id, action: row.action,
      fromStatus: row.from_status, toStatus: row.to_status,
      fromRevision: row.from_revision === null ? null : String(row.from_revision),
      toRevision: row.to_revision === null ? null : String(row.to_revision),
      actorId: row.actor_id, reason: row.reason, createdAt: row.created_at.toISOString(),
    }))
  }

  async delete(entity: VouEntity, input: VouReviewInput, actor: ApprovalActor, requestId: string) {
    requirePermission(actor, `/vou/${entity}/delete`)
    return this.db.transaction().execute(async (tx) => {
      const row = await tx.selectFrom('approval_entries').selectAll()
        .where('id', '=', input.submissionId).where('domain', '=', 'vou')
        .where('entity', '=', entity).where('subject_id', '=', input.documentId)
        .forUpdate().executeTakeFirst()
      if (!row) throw new VouApplicationError('approval_not_found')
      if (String(row.revision) !== input.expectedRevision)
        throw new VouApplicationError('approval_stale_revision')
      if (row.status === 'APPROVED') throw new VouApplicationError('vou_delete_blocked')
      if (actor.trusted !== true && row.submitted_by !== actor.id)
        throw new VouApplicationError('approval_invalid_action')
      const blockers = await this.downstreamBlockers(tx, input.documentId)
      if (blockers.length > 0) throw new VouApplicationError('vou_delete_blocked', blockers)
      const now = new Date()
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: row.id, domain: 'vou', entity, subject_id: input.documentId,
        version_no: null, action: 'DELETED', from_status: row.status, to_status: null,
        from_revision: row.revision, to_revision: null, actor_id: actor.id,
        reason: null, request_id: requestId, created_at: now,
      }).execute()
      await tx.deleteFrom('approval_entries').where('id', '=', row.id).execute()
      await tx.updateTable('vou_documents').set({ stable_revision: sql`stable_revision + 1` })
        .where('id', '=', input.documentId).execute()
      return { documentId: input.documentId, submissionId: input.submissionId, deleted: true }
    })
  }

  private async readView(executor: Executor, entity: VouEntity, documentId: string, actor: ApprovalActor): Promise<VouView> {
    const row = await executor.selectFrom('vou_documents as d')
      .innerJoin('approval_entries as e', (join) => join.onRef('e.subject_id', '=', 'd.id').on('e.domain', '=', 'vou'))
      .innerJoin('vou_document_payloads as p', 'p.approval_entry_id', 'e.id')
      .select(['d.id as document_id', 'd.entity', 'd.document_no', 'd.stable_revision',
        'e.id', 'e.status', 'e.revision', 'e.submitted_by', 'e.submitted_at', 'e.approved_by', 'e.approved_at',
        'e.rejected_by', 'e.rejected_at', 'e.rejection_reason', 'p.payload'])
      .where('d.id', '=', documentId).where('d.entity', '=', entity).executeTakeFirst()
    if (!row) throw new VouApplicationError('vou_not_found')
    const entry = entryFromRow({ ...row, entity: row.entity, subject_id: row.document_id })
    return {
      entity, documentId: row.document_id, documentNo: row.document_no,
      stableRevision: String(row.stable_revision), submissionId: row.id,
      status: row.status as ApprovalStatus, revision: String(row.revision),
      submittedBy: row.submitted_by, submittedAt: row.submitted_at.toISOString(),
      approvedBy: row.approved_by, approvedAt: row.approved_at?.toISOString() ?? null,
      rejectedBy: row.rejected_by, rejectedAt: row.rejected_at?.toISOString() ?? null,
      rejectionReason: row.rejection_reason, payload: row.payload as unknown as VouPayload,
      availableApprovalActions: availableApprovalActions(entry, actor),
      canDelete: (row.status === 'PENDING' || row.status === 'REJECTED') &&
        (actor.trusted === true || actor.id === row.submitted_by) &&
        (actor.trusted === true || actor.permissions.includes(`/vou/${entity}/delete`)),
    }
  }

  private async validateStaging(executor: Executor, payload: VouPayload, ownerId: string) {
    if (payload.attachments.length > 10)
      throw new VouApplicationError('vou_attachment_limit_exceeded')
    for (const attachment of payload.attachments) {
      const row = await executor.selectFrom('vou_attachment_staging').selectAll()
        .where('id', '=', attachment.stagingId).where('file_id', '=', attachment.id)
        .where('owner_user_id', '=', ownerId).where('expires_at', '>', new Date()).forUpdate().executeTakeFirst()
      if (!row || row.digest !== attachment.sha256 || row.mime_type !== attachment.contentType || row.size_bytes !== attachment.sizeBytes)
        throw new VouApplicationError('vou_attachment_staging_invalid')
    }
  }

  private async promoteAttachments(executor: Executor, entryId: string, payload: VouPayload, ownerId: string, now: Date) {
    for (const attachment of payload.attachments) {
      const row = await executor.selectFrom('vou_attachment_staging').selectAll()
        .where('id', '=', attachment.stagingId).where('owner_user_id', '=', ownerId).executeTakeFirstOrThrow()
      await executor.insertInto('vou_attachments').values({
        approval_entry_id: entryId, file_id: row.file_id, file_name: row.file_name,
        mime_type: row.mime_type, size_bytes: row.size_bytes, digest: row.digest,
        content: row.content, created_at: now,
      }).execute()
      await executor.deleteFrom('vou_attachment_staging').where('id', '=', row.id).execute()
    }
  }

  private async downstreamBlockers(executor: Executor, documentId: string) {
    const rows = await executor.selectFrom('vou_document_payloads as p')
      .innerJoin('approval_entries as e', 'e.id', 'p.approval_entry_id')
      .select('p.document_id').where('p.parent_document_id', '=', documentId)
      .where('e.status', '=', 'APPROVED').execute()
    return rows.map((row) => ({ kind: 'DOWNSTREAM_DOCUMENT' as const, id: row.document_id }))
  }
}
