import { ApprovalPersistence } from '../platform/approval.ts'
import { openingRequestHash } from './opening-input.ts'
import {
  availableApprovalActions,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalStatus,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB, JsonValue } from '../db/generated.ts'
import {
  AccService,
  AccApplicationError,
  type AccOpeningInput,
  type AccOpeningReviewInput,
} from '../acc/service.ts'
type Executor = Kysely<DB> | Transaction<DB>
function requirePermission(actor: ApprovalActor, path: string) {
  if (!actor.trusted && !actor.permissions.includes(path))
    throw new AccApplicationError('approval_invalid_action')
}
function asJson(value: unknown): JsonValue {
  return value as JsonValue
}
export class VouOpeningService {
  private readonly approval = new ApprovalPersistence()
  private readonly db: Kysely<DB>
  private readonly acc: AccService
  constructor(db: Kysely<DB>, acc = new AccService(db)) {
    this.db = db
    this.acc = acc
  }
  async submitOpening(
    input: AccOpeningInput,
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, '/vou/opening/submit-new')
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`acc:opening:${input.bookId}`}, 0))`.execute(
        tx,
      )
      await this.acc.requireBookAccess(tx, input.bookId, actor, true)
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:idempotency:opening:${input.idempotencyKey}`}, 0))`.execute(
        tx,
      )
      const hash = openingRequestHash(input, actor.id)
      const accepted = await tx
        .selectFrom('vou_idempotency')
        .select(['request_hash', 'response'])
        .where('entity', '=', 'opening')
        .where('idempotency_key', '=', input.idempotencyKey)
        .executeTakeFirst()
      if (accepted) {
        if (accepted.request_hash !== hash)
          throw new AccApplicationError('vou_idempotency_conflict')
        return accepted.response as unknown as Awaited<
          ReturnType<VouOpeningService['readOpening']>
        >
      }
      const prior = await tx
        .selectFrom('approval_entries')
        .select('id')
        .where('domain', '=', 'vou')
        .where('entity', '=', 'opening')
        .where('subject_id', '=', input.bookId)
        .executeTakeFirst()
      if (prior) {
        throw new AccApplicationError('approval_open_version_exists')
      }
      const opening = await this.acc.normalizeOpening(tx, input)
      await this.acc.validateOpening(tx, opening)
      const now = new Date()
      await this.approval.create(tx, {
        entryId: opening.submissionId,
        domain: 'vou',
        entity: 'opening',
        subjectId: opening.bookId,
        versionNo: null,
        actorId: actor.id,
        occurredAt: now,
        requestId,
      })
      await tx
        .insertInto('acc_opening_snapshots')
        .values({
          approval_entry_id: opening.submissionId,
          book_id: opening.bookId,
          payload: asJson(opening),
        })
        .execute()
      await this.acc.writeOpeningAuxReferenceFacts(tx, opening)
      const view = await this.readOpening(tx, opening.bookId, actor)
      await tx
        .insertInto('vou_idempotency')
        .values({
          entity: 'opening',
          idempotency_key: input.idempotencyKey,
          request_hash: hash,
          document_id: input.bookId,
          submission_id: input.submissionId,
          response: asJson(view),
          created_at: now,
        })
        .execute()
      return view
    })
  }

  async reviewOpening(
    action: ApprovalAction,
    input: AccOpeningReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, `/vou/opening/${action}`)
    return this.db.transaction().execute(async (tx) => {
      const entry = await this.approval.load(
        tx,
        {
          entryId: input.submissionId,
          domain: 'vou',
          entity: 'opening',
          subjectId: input.bookId,
        },
        true,
      )
      await this.acc.requireBookAccess(tx, input.bookId, actor, true)
      const occurredAt = new Date()
      await this.approval.transition(tx, {
        entry,
        action,
        actor,
        expectedRevision: input.expectedRevision,
        occurredAt,
        requestId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })
      if (action === 'approve') {
        const snapshot = await tx
          .selectFrom('acc_opening_snapshots')
          .select('payload')
          .where('approval_entry_id', '=', entry.id)
          .executeTakeFirstOrThrow()
        await this.acc.validateOpening(
          tx,
          snapshot.payload as unknown as AccOpeningInput,
        )
        await this.acc.persistOpeningFacts(
          tx,
          entry.id,
          snapshot.payload as unknown as AccOpeningInput,
          occurredAt,
        )
      }
      if (action === 'unapprove') {
        await this.acc.deleteOpeningFacts(tx, entry.id)
      }
      return this.readOpening(tx, input.bookId, actor)
    })
  }

  private async readOpening(
    executor: Executor,
    bookId: string,
    actor: ApprovalActor,
  ) {
    const row = await executor
      .selectFrom('approval_entries as e')
      .innerJoin('acc_opening_snapshots as s', 's.approval_entry_id', 'e.id')
      .innerJoin('acc_books as b', 'b.id', 's.book_id')
      .select(['e.id', 's.payload', 'b.code', 'b.name', 'b.start_month'])
      .where('e.domain', '=', 'vou')
      .where('e.entity', '=', 'opening')
      .where('e.subject_id', '=', bookId)
      .executeTakeFirst()
    if (!row) throw new AccApplicationError('approval_not_found')
    const entry = await this.approval.load(executor, {
      entryId: row.id,
      domain: 'vou',
      entity: 'opening',
      subjectId: bookId,
    })
    const canOperate =
      actor.trusted ||
      Boolean(
        await executor
          .selectFrom('acc_book_access')
          .select('book_id')
          .where('book_id', '=', bookId)
          .where('user_id', '=', actor.id)
          .where('can_operate', '=', true)
          .executeTakeFirst(),
      )
    return {
      bookId,
      documentId: bookId,
      documentNo: `OPN-${row.code}`,
      entity: 'opening' as const,
      status: entry.status,
      revision: entry.revision,
      submittedBy: entry.metadata.submitted.actorId,
      submittedAt: entry.metadata.submitted.occurredAt,
      approvedBy: entry.metadata.approved?.actorId ?? null,
      approvedAt: entry.metadata.approved?.occurredAt ?? null,
      rejectedBy: entry.metadata.rejected?.actorId ?? null,
      rejectedAt: entry.metadata.rejected?.occurredAt ?? null,
      rejectionReason: entry.metadata.rejected?.reason ?? null,
      bookName: row.name,
      businessDate: `${row.start_month}-01`,
      submissionId: row.id,
      approval: entry,
      payload: row.payload as unknown as AccOpeningInput,
      availableApprovalActions: canOperate
        ? availableApprovalActions(entry, actor)
        : [],
    }
  }

  async queryOpenings(
    input: {
      page: number
      pageSize: 20
      bookId?: string
      documentNo?: string
      dateFrom?: string
      dateTo?: string
      status?: ApprovalStatus
    },
    actor: ApprovalActor,
  ) {
    requirePermission(actor, '/vou/opening/query')
    let query = this.db
      .selectFrom('approval_entries as e')
      .innerJoin('acc_books as b', 'b.id', 'e.subject_id')
      .innerJoin('acc_opening_snapshots as s', 's.approval_entry_id', 'e.id')
      .where('e.domain', '=', 'vou')
      .where('e.entity', '=', 'opening')
    if (!actor.trusted)
      query = query
        .innerJoin('acc_book_access as a', 'a.book_id', 'b.id')
        .where('a.user_id', '=', actor.id)
        .where('a.can_query', '=', true)
    if (input.bookId) query = query.where('b.id', '=', input.bookId)
    if (input.documentNo)
      query = query.where(
        sql<boolean>`strpos(lower('OPN-' || b.code), lower(${input.documentNo})) > 0`,
      )
    if (input.status) query = query.where('e.status', '=', input.status)
    if (input.dateFrom)
      query = query.where(
        sql<boolean>`(b.start_month || '-01')::date >= ${input.dateFrom}::date`,
      )
    if (input.dateTo)
      query = query.where(
        sql<boolean>`(b.start_month || '-01')::date <= ${input.dateTo}::date`,
      )
    const count = await query
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirstOrThrow()
    const rows = await query
      .select([
        'b.id',
        'b.code',
        'b.name',
        'b.start_month',
        'b.base_currency',
        'e.status',
        'e.revision',
        'e.submitted_at',
      ])
      .orderBy('b.code', 'asc')
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .execute()
    return {
      items: rows.map((row) => ({
        vouType: 'opening' as const,
        documentId: row.id,
        documentNo: `OPN-${row.code}`,
        bookName: row.name,
        handlerName: null,
        revision: String(row.revision),
        status: row.status as ApprovalStatus,
        businessDate: `${row.start_month}-01`,
        submittedDate: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(row.submitted_at),
        counterpartyName: null,
        amount: null,
        currency: row.base_currency,
      })),
      total: Number(count.total),
      page: input.page,
      pageSize: input.pageSize,
    }
  }

  async auditOpening(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/vou/opening/audit-history')
    await this.acc.requireBookAccess(this.db, bookId, actor, false)
    const rows = await this.db
      .selectFrom('approval_events')
      .selectAll()
      .where('domain', '=', 'vou')
      .where('entity', '=', 'opening')
      .where('subject_id', '=', bookId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute()
    return rows.map((row) => ({
      id: row.id,
      submissionId: row.entry_id,
      action: row.action,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      fromRevision:
        row.from_revision === null ? null : String(row.from_revision),
      toRevision: row.to_revision === null ? null : String(row.to_revision),
      actorId: row.actor_id,
      reason: row.reason,
      requestId: row.request_id,
      occurredAt: row.created_at.toISOString(),
    }))
  }

  async getOpening(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/vou/opening/get')
    await this.acc.requireBookAccess(this.db, bookId, actor, false)
    return this.readOpening(this.db, bookId, actor)
  }

  async deleteOpening(
    input: AccOpeningReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, '/vou/opening/delete')
    return this.db.transaction().execute(async (tx) => {
      const entry = await this.approval.load(
        tx,
        {
          entryId: input.submissionId,
          domain: 'vou',
          entity: 'opening',
          subjectId: input.bookId,
        },
        true,
      )
      await this.acc.requireBookAccess(tx, input.bookId, actor, true)
      if (entry.status === 'APPROVED')
        throw new AccApplicationError('acc_opening_delete_blocked')
      await tx
        .deleteFrom('aux_reference_facts')
        .where('source', 'like', `acc:opening:${entry.id}:%`)
        .execute()
      await this.approval.delete(tx, {
        entry,
        actor,
        expectedRevision: input.expectedRevision,
        occurredAt: new Date(),
        requestId,
      })
      return { submissionId: entry.id, deleted: true as const }
    })
  }
}
