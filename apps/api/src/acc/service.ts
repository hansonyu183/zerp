import {
  availableApprovalActions,
  decideApproval,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
  type VouPayload,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { DB, JsonValue } from '../db/generated.ts'
import type { AccApplicationPlan, PlanExecutor } from '../platform/transaction-coordinator.ts'

type Executor = Kysely<DB> | Transaction<DB>

export interface AccBookInput {
  id: string
  name: string
  description: string
  startMonth: string
  baseCurrency: string
}

export interface AccSubjectInput {
  id: string
  bookId: string
  code: string
  name: string
  parentId: string | null
  balanceDirection: 'DEBIT' | 'CREDIT'
  enabled: boolean
  requiredDimensions: string[]
  inventoryQuantity: boolean
  settlementPurpose: string
}

export interface AccOpeningInput {
  bookId: string
  submissionId: string
  idempotencyKey: string
  lines: Array<{
    subjectId: string
    currency: string
    direction: 'DEBIT' | 'CREDIT'
    amount: string
    dimensions: Record<string, string>
  }>
  assets: unknown[]
  bills: unknown[]
  containers: unknown[]
}

export interface AccOpeningReviewInput {
  bookId: string
  submissionId: string
  expectedRevision: string
  reason?: string
}

export class AccApplicationError extends Error {
  readonly errorKey: string
  readonly data: { blockers: unknown[] } | null

  constructor(errorKey: string, blockers: unknown[] = []) {
    super(errorKey)
    this.name = 'AccApplicationError'
    this.errorKey = errorKey
    this.data = blockers.length === 0 ? null : { blockers }
  }
}

function requirePermission(actor: ApprovalActor, permission: string): void {
  if (actor.trusted !== true && !actor.permissions.includes(permission))
    throw new AccApplicationError('approval_invalid_action')
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue
}

function decimalUnits(value: string): bigint {
  const match = /^([0-9]+)(?:\.([0-9]{1,8}))?$/.exec(value)
  if (!match) throw new AccApplicationError('acc_amount_invalid')
  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? '').padEnd(8, '0'))
}

function entryFromRow(row: {
  id: string
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
    domain: 'acc',
    entity: 'opening',
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

export class AccService implements PlanExecutor<AccApplicationPlan> {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async apply(tx: Transaction<DB>, plan: AccApplicationPlan): Promise<void> {
    if (!plan.action || !plan.entity || !plan.documentId || !plan.approvalEntryId || !plan.payload || !plan.occurredAt)
      return
    if (plan.action === 'unapprove') {
      await tx.deleteFrom('acc_inventory_entries').where('vou_approval_entry_id', '=', plan.approvalEntryId).execute()
      await tx.deleteFrom('acc_register_entries').where('vou_approval_entry_id', '=', plan.approvalEntryId).execute()
      await tx.deleteFrom('acc_journal_entries').where('vou_approval_entry_id', '=', plan.approvalEntryId).execute()
      return
    }
    const prior = await tx.selectFrom('acc_journal_entries').select('id')
      .where('vou_approval_entry_id', '=', plan.approvalEntryId).executeTakeFirst()
    if (prior) return
    const books = await tx.selectFrom('acc_books as b')
      .innerJoin('approval_entries as opening', (join) => join.onRef('opening.subject_id', '=', 'b.id')
        .on('opening.domain', '=', 'acc').on('opening.entity', '=', 'opening').on('opening.status', '=', 'APPROVED'))
      .select(['b.id', 'b.start_month', 'b.control_book']).where('b.start_month', '<=', plan.payload.businessDate.slice(0, 7))
      .orderBy('b.code', 'asc').execute()
    for (const book of books) {
      const mappingResult = await sql<{ default_result: string; mapping_definition: JsonValue }>`
        SELECT mapping.default_result, mapping.mapping_definition
        FROM dcl_acc_mapping_versions mapping
        JOIN approval_entries entry ON entry.id = mapping.approval_entry_id
        WHERE entry.domain = 'dcl' AND entry.entity = 'acc-mapping'
          AND entry.status = 'APPROVED' AND mapping.book_id = ${book.id}
          AND mapping.vou_entity_snapshot->>'code' = ${plan.entity}
        ORDER BY entry.version_no DESC LIMIT 1
      `.execute(tx)
      const mapping = mappingResult.rows[0]
      if (!mapping) throw new AccApplicationError('acc_mapping_not_found')
      const definition = mapping.mapping_definition as unknown as {
        defaultTemplateId: string | null
        rules: Array<{ conditions: Array<{ field: string; operator: string; values: string[] }>; result: 'POST' | 'UN_POST'; templateId: string | null }>
        templates: Array<{ templateId: string; collection: string | null; lines: Array<{ subjectSource: 'FIXED' | 'FIELD'; subjectValue: string; direction: 'DEBIT' | 'CREDIT'; amountField: string; currencyField: string; dimensions: Record<string, string>; quantityField: string | null }> }>
      }
      const matching = definition.rules.filter((rule) => rule.conditions.every((condition) => this.mappingCondition(plan.payload!, condition)))
      if (matching.length > 1) throw new AccApplicationError('acc_mapping_rule_conflict')
      const result = matching[0]?.result ?? mapping.default_result
      const templateId = matching[0]?.templateId ?? definition.defaultTemplateId
      if (result === 'UN_POST') continue
      const template = definition.templates.find((candidate) => candidate.templateId === templateId)
      if (!template) throw new AccApplicationError('acc_mapping_template_not_found')
      const sources = template.collection ? this.field(plan.payload, template.collection) : [plan.payload]
      if (!Array.isArray(sources)) throw new AccApplicationError('acc_mapping_collection_invalid')
      const rendered: Array<{ subjectId: string; direction: 'DEBIT' | 'CREDIT'; amount: string; currency: string; dimensions: Record<string, string>; quantity: string | null }> = []
      for (const sourceValue of sources) {
        const source = typeof sourceValue === 'object' && sourceValue !== null ? sourceValue as Record<string, unknown> : {}
        for (const line of template.lines) {
          const subjectId = line.subjectSource === 'FIXED' ? line.subjectValue : String(this.field({ ...plan.payload, line: source }, line.subjectValue) ?? '')
          const amount = String(this.field({ ...plan.payload, line: source }, line.amountField) ?? '')
          const currency = String(this.field({ ...plan.payload, line: source }, line.currencyField) ?? '')
          decimalUnits(amount)
          if (!/^[A-Z]{3}$/.test(currency)) throw new AccApplicationError('acc_mapping_currency_invalid')
          const dimensions = Object.fromEntries(Object.entries(line.dimensions).map(([dimension, field]) => [dimension, String(this.field({ ...plan.payload, line: source }, field) ?? '')]))
          if (Object.values(dimensions).some((value) => !value)) throw new AccApplicationError('acc_mapping_dimension_required')
          rendered.push({ subjectId, direction: line.direction, amount, currency, dimensions, quantity: line.quantityField ? String(this.field({ ...plan.payload, line: source }, line.quantityField) ?? '') : null })
        }
      }
      const currencies = new Set(rendered.map((line) => line.currency))
      if (currencies.size !== 1) throw new AccApplicationError('acc_mapping_multi_currency_unsupported')
      let debit = 0n, credit = 0n
      for (const line of rendered) line.direction === 'DEBIT' ? debit += decimalUnits(line.amount) : credit += decimalUnits(line.amount)
      if (debit !== credit) throw new AccApplicationError('acc_posting_unbalanced')
      const subjects = await tx.selectFrom('acc_subjects').selectAll().where('book_id', '=', book.id).execute()
      const byId = new Map(subjects.map((subject) => [subject.id, subject]))
      for (const line of rendered) {
        const subject = byId.get(line.subjectId)
        if (!subject?.enabled || subjects.some((candidate) => candidate.parent_id === line.subjectId)) throw new AccApplicationError('acc_posting_subject_invalid')
        const required = subject.required_dimensions as unknown as string[]
        if (required.some((dimension) => !line.dimensions[dimension])) throw new AccApplicationError('acc_mapping_dimension_required')
      }
      const journalId = ulid()
      await tx.insertInto('acc_journal_entries').values({
        id: journalId, book_id: book.id, vou_document_id: plan.documentId,
        vou_approval_entry_id: plan.approvalEntryId, business_date: new Date(`${plan.payload.businessDate}T00:00:00.000Z`),
        currency: [...currencies][0] ?? plan.payload.currency, created_at: new Date(plan.occurredAt),
      }).execute()
      for (const line of rendered) {
        const subject = byId.get(line.subjectId)!
        await tx.insertInto('acc_journal_lines').values({
          id: ulid(), journal_entry_id: journalId, subject_id: line.subjectId,
          direction: line.direction, amount: line.amount, dimensions: asJson(line.dimensions),
        }).execute()
        if (book.control_book && subject.inventory_quantity && line.quantity) {
          decimalUnits(line.quantity)
          await tx.insertInto('acc_inventory_entries').values({
            id: ulid(), vou_approval_entry_id: plan.approvalEntryId, document_id: plan.documentId,
            line_id: ulid(), warehouse_id: line.dimensions.WAREHOUSE ?? '', product_id: line.dimensions.PRODUCT ?? '',
            quantity: line.direction === 'DEBIT' ? line.quantity : `-${line.quantity}`, created_at: new Date(plan.occurredAt),
          }).execute()
        }
      }
    }
  }

  private field(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[key] : undefined, value)
  }

  private mappingCondition(payload: VouPayload, condition: { field: string; operator: string; values: string[] }): boolean {
    const value = this.field(payload, condition.field)
    const text = value === null || value === undefined ? '' : String(value)
    if (condition.operator === 'IS_EMPTY') return text === ''
    if (condition.operator === 'IS_NOT_EMPTY') return text !== ''
    if (condition.operator === 'EQ') return text === condition.values[0]
    if (condition.operator === 'NE') return text !== condition.values[0]
    if (condition.operator === 'IN') return condition.values.includes(text)
    if (condition.operator === 'NOT_IN') return !condition.values.includes(text)
    return false
  }

  async createBook(input: AccBookInput, actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/create')
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('acc:book-code', 0))`.execute(tx)
      const latest = await tx.selectFrom('acc_books').select('code').orderBy('code', 'desc').executeTakeFirst()
      const sequence = latest ? Number(latest.code.slice(4)) + 1 : 1
      if (!Number.isSafeInteger(sequence) || sequence > 9999)
        throw new AccApplicationError('acc_book_code_exhausted')
      const code = `ACC-${String(sequence).padStart(4, '0')}`
      const controlBook = latest === undefined
      const now = new Date()
      await tx.insertInto('acc_books').values({
        id: input.id,
        code,
        name: input.name.trim(),
        description: input.description.trim(),
        start_month: input.startMonth,
        base_currency: input.baseCurrency,
        control_book: controlBook,
        created_at: now,
        created_by: actor.id,
        updated_at: now,
        updated_by: actor.id,
      }).execute()
      await tx.insertInto('acc_book_access').values({
        book_id: input.id,
        user_id: actor.id,
        can_query: true,
        can_operate: true,
      }).execute()
      return { ...input, code, controlBook, revision: '1' }
    })
  }

  async queryBooks(actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/query')
    let query = this.db.selectFrom('acc_books as b').selectAll('b').orderBy('b.code', 'asc')
    if (actor.trusted !== true)
      query = query.innerJoin('acc_book_access as a', 'a.book_id', 'b.id')
        .where('a.user_id', '=', actor.id).where('a.can_query', '=', true)
    return (await query.execute()).map((row) => this.bookView(row))
  }

  async getBook(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/get')
    await this.requireBookAccess(this.db, bookId, actor, false)
    const row = await this.db.selectFrom('acc_books').selectAll().where('id', '=', bookId).executeTakeFirst()
    if (!row) throw new AccApplicationError('acc_book_not_found')
    return this.bookView(row)
  }

  async saveBook(input: { id: string; expectedRevision: string; name: string; description: string; baseCurrency: string }, actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/save')
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, input.id, actor, true)
      const row = await tx.selectFrom('acc_books').selectAll().where('id', '=', input.id).forUpdate().executeTakeFirstOrThrow()
      if (String(row.revision) !== input.expectedRevision) throw new AccApplicationError('approval_stale_revision')
      const revision = BigInt(row.revision) + 1n
      await tx.updateTable('acc_books').set({
        name: input.name.trim(), description: input.description.trim(), base_currency: input.baseCurrency,
        revision, updated_at: new Date(), updated_by: actor.id,
      }).where('id', '=', input.id).where('revision', '=', row.revision).executeTakeFirstOrThrow()
      return this.bookView({ ...row, name: input.name.trim(), description: input.description.trim(), base_currency: input.baseCurrency, revision })
    })
  }

  async deleteBook(bookId: string, expectedRevision: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/delete')
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, bookId, actor, true)
      const row = await tx.selectFrom('acc_books').select(['control_book', 'revision']).where('id', '=', bookId).forUpdate().executeTakeFirstOrThrow()
      if (String(row.revision) !== expectedRevision) throw new AccApplicationError('approval_stale_revision')
      if (row.control_book) throw new AccApplicationError('acc_control_book_delete_forbidden')
      const subject = await tx.selectFrom('acc_subjects').select('id').where('book_id', '=', bookId).executeTakeFirst()
      const opening = await tx.selectFrom('acc_opening_snapshots').select('approval_entry_id').where('book_id', '=', bookId).executeTakeFirst()
      const journal = await tx.selectFrom('acc_journal_entries').select('id').where('book_id', '=', bookId).executeTakeFirst()
      const blockers = [subject && { kind: 'SUBJECT', id: subject.id }, opening && { kind: 'OPENING', id: opening.approval_entry_id }, journal && { kind: 'JOURNAL', id: journal.id }].filter(Boolean)
      if (blockers.length > 0) throw new AccApplicationError('acc_book_delete_blocked', blockers)
      await tx.deleteFrom('acc_books').where('id', '=', bookId).executeTakeFirstOrThrow()
      return { id: bookId, deleted: true as const }
    })
  }

  async createSubject(input: AccSubjectInput, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/create')
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, input.bookId, actor, true)
      if (input.parentId) {
        const parent = await tx.selectFrom('acc_subjects').select('book_id')
          .where('id', '=', input.parentId).executeTakeFirst()
        if (!parent || parent.book_id !== input.bookId)
          throw new AccApplicationError('acc_subject_parent_invalid')
      }
      const now = new Date()
      await tx.insertInto('acc_subjects').values({
        id: input.id,
        book_id: input.bookId,
        code: input.code,
        name: input.name.trim(),
        parent_id: input.parentId,
        balance_direction: input.balanceDirection,
        enabled: input.enabled,
        required_dimensions: JSON.stringify(input.requiredDimensions) as unknown as JsonValue,
        inventory_quantity: input.inventoryQuantity,
        settlement_purpose: input.settlementPurpose,
        created_at: now,
        created_by: actor.id,
        updated_at: now,
        updated_by: actor.id,
      }).execute()
      return { ...input, name: input.name.trim(), revision: '1' }
    })
  }

  async querySubjects(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/query')
    await this.requireBookAccess(this.db, bookId, actor, false)
    const rows = await this.db.selectFrom('acc_subjects').selectAll().where('book_id', '=', bookId).orderBy('code', 'asc').execute()
    return rows.map((row) => this.subjectView(row))
  }

  async getSubject(id: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/get')
    const row = await this.db.selectFrom('acc_subjects').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) throw new AccApplicationError('acc_subject_not_found')
    await this.requireBookAccess(this.db, row.book_id, actor, false)
    return this.subjectView(row)
  }

  async saveSubject(input: AccSubjectInput & { expectedRevision: string }, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/save')
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, input.bookId, actor, true)
      const row = await tx.selectFrom('acc_subjects').selectAll().where('id', '=', input.id).forUpdate().executeTakeFirst()
      if (!row || row.book_id !== input.bookId) throw new AccApplicationError('acc_subject_not_found')
      if (String(row.revision) !== input.expectedRevision) throw new AccApplicationError('approval_stale_revision')
      const referenced = await tx.selectFrom('acc_journal_lines').select('id').where('subject_id', '=', input.id).executeTakeFirst()
      if (referenced && (row.code !== input.code || row.name !== input.name.trim() || row.parent_id !== input.parentId || row.balance_direction !== input.balanceDirection || JSON.stringify(row.required_dimensions) !== JSON.stringify(input.requiredDimensions) || row.inventory_quantity !== input.inventoryQuantity || row.settlement_purpose !== input.settlementPurpose))
        throw new AccApplicationError('acc_subject_frozen')
      const revision = BigInt(row.revision) + 1n
      await tx.updateTable('acc_subjects').set({
        code: input.code, name: input.name.trim(), parent_id: input.parentId,
        balance_direction: input.balanceDirection, enabled: input.enabled,
        required_dimensions: JSON.stringify(input.requiredDimensions) as unknown as JsonValue,
        inventory_quantity: input.inventoryQuantity, settlement_purpose: input.settlementPurpose,
        revision, updated_at: new Date(), updated_by: actor.id,
      }).where('id', '=', input.id).where('revision', '=', row.revision).executeTakeFirstOrThrow()
      return { ...input, name: input.name.trim(), revision: String(revision) }
    })
  }

  async deleteSubject(id: string, expectedRevision: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/delete')
    return this.db.transaction().execute(async (tx) => {
      const row = await tx.selectFrom('acc_subjects').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
      if (!row) throw new AccApplicationError('acc_subject_not_found')
      await this.requireBookAccess(tx, row.book_id, actor, true)
      if (String(row.revision) !== expectedRevision) throw new AccApplicationError('approval_stale_revision')
      const child = await tx.selectFrom('acc_subjects').select('id').where('parent_id', '=', id).executeTakeFirst()
      const line = await tx.selectFrom('acc_journal_lines').select('id').where('subject_id', '=', id).executeTakeFirst()
      if (child || line) throw new AccApplicationError('acc_subject_delete_blocked', [child && { kind: 'CHILD_SUBJECT', id: child.id }, line && { kind: 'JOURNAL_LINE', id: line.id }].filter(Boolean))
      await tx.deleteFrom('acc_subjects').where('id', '=', id).executeTakeFirstOrThrow()
      return { id, deleted: true as const }
    })
  }

  async submitOpening(input: AccOpeningInput, actor: ApprovalActor, requestId: string) {
    requirePermission(actor, '/acc/opening/submit-new')
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`acc:opening:${input.bookId}`}, 0))`.execute(tx)
      await this.requireBookAccess(tx, input.bookId, actor, true)
      const prior = await tx.selectFrom('approval_entries').select('id')
        .where('domain', '=', 'acc').where('entity', '=', 'opening')
        .where('subject_id', '=', input.bookId).executeTakeFirst()
      if (prior) {
        if (prior.id === input.submissionId) return this.readOpening(tx, input.bookId, actor)
        throw new AccApplicationError('approval_open_version_exists')
      }
      await this.validateOpening(tx, input)
      const now = new Date()
      await tx.insertInto('approval_entries').values({
        id: input.submissionId,
        domain: 'acc',
        entity: 'opening',
        subject_id: input.bookId,
        version_no: null,
        status: 'PENDING',
        revision: 1,
        submitted_by: actor.id,
        submitted_at: now,
        updated_by: actor.id,
        updated_at: now,
      }).execute()
      await tx.insertInto('acc_opening_snapshots').values({
        approval_entry_id: input.submissionId,
        book_id: input.bookId,
        payload: asJson(input),
      }).execute()
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: input.submissionId, domain: 'acc', entity: 'opening',
        subject_id: input.bookId, version_no: null, action: 'SUBMITTED',
        from_status: null, to_status: 'PENDING', from_revision: null, to_revision: 1,
        actor_id: actor.id, reason: null, request_id: requestId, created_at: now,
      }).execute()
      return this.readOpening(tx, input.bookId, actor)
    })
  }

  async reviewOpening(
    action: ApprovalAction,
    input: AccOpeningReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, `/acc/opening/${action}`)
    return this.db.transaction().execute(async (tx) => {
      const row = await tx.selectFrom('approval_entries').selectAll()
        .where('id', '=', input.submissionId).where('domain', '=', 'acc')
        .where('entity', '=', 'opening').where('subject_id', '=', input.bookId)
        .forUpdate().executeTakeFirst()
      if (!row) throw new AccApplicationError('approval_not_found')
      if (action === 'approve') {
        const snapshot = await tx.selectFrom('acc_opening_snapshots').select('payload')
          .where('approval_entry_id', '=', row.id).executeTakeFirstOrThrow()
        await this.validateOpening(tx, snapshot.payload as unknown as AccOpeningInput)
      }
      if (action === 'unapprove') {
        const laterJournal = await tx.selectFrom('acc_journal_entries').select('id')
          .where('book_id', '=', input.bookId).executeTakeFirst()
        if (laterJournal) throw new AccApplicationError('acc_opening_unapprove_blocked', [{ kind: 'JOURNAL', id: laterJournal.id }])
      }
      const occurredAt = new Date()
      const decision = decideApproval({
        action,
        entry: entryFromRow(row),
        actor,
        expectedRevision: input.expectedRevision,
        occurredAt: occurredAt.toISOString(),
        requestId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })
      if (!decision.ok) throw new AccApplicationError(decision.error.errorKey)
      const plan = decision.plan
      await tx.updateTable('approval_entries').set({
        status: plan.toStatus,
        revision: BigInt(plan.toRevision),
        updated_by: actor.id,
        updated_at: occurredAt,
        approved_by: plan.metadata.approved?.actorId ?? null,
        approved_at: plan.metadata.approved ? new Date(plan.metadata.approved.occurredAt) : null,
        rejected_by: plan.metadata.rejected?.actorId ?? null,
        rejected_at: plan.metadata.rejected ? new Date(plan.metadata.rejected.occurredAt) : null,
        rejection_reason: plan.metadata.rejected?.reason ?? null,
      }).where('id', '=', row.id).where('revision', '=', plan.fromRevision).executeTakeFirstOrThrow()
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: row.id, domain: 'acc', entity: 'opening',
        subject_id: input.bookId, version_no: null, action: plan.event.action,
        from_status: plan.fromStatus, to_status: plan.toStatus,
        from_revision: BigInt(plan.fromRevision), to_revision: BigInt(plan.toRevision),
        actor_id: actor.id, reason: plan.reason ?? null, request_id: requestId,
        created_at: occurredAt,
      }).execute()
      return this.readOpening(tx, input.bookId, actor)
    })
  }

  async setPeriod(
    input: { bookId: string; month: string; expectedRevision: string | null },
    locked: boolean,
    actor: ApprovalActor,
  ) {
    requirePermission(actor, `/acc/period/${locked ? 'lock' : 'unlock'}`)
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, input.bookId, actor, true)
      const row = await tx.selectFrom('acc_periods').selectAll()
        .where('book_id', '=', input.bookId).where('period_month', '=', input.month)
        .forUpdate().executeTakeFirst()
      if (!row) {
        if (input.expectedRevision !== null) throw new AccApplicationError('approval_stale_revision')
        const now = new Date()
        await tx.insertInto('acc_periods').values({
          book_id: input.bookId,
          period_month: input.month,
          locked,
          updated_at: now,
          updated_by: actor.id,
        }).execute()
        return { bookId: input.bookId, month: input.month, locked, revision: '1' }
      }
      if (input.expectedRevision !== String(row.revision))
        throw new AccApplicationError('approval_stale_revision')
      const revision = BigInt(row.revision) + 1n
      await tx.updateTable('acc_periods').set({
        locked,
        revision,
        updated_at: new Date(),
        updated_by: actor.id,
      }).where('book_id', '=', input.bookId).where('period_month', '=', input.month)
        .where('revision', '=', row.revision).executeTakeFirstOrThrow()
      return { bookId: input.bookId, month: input.month, locked, revision: String(revision) }
    })
  }

  async queryPeriods(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/period/query')
    await this.requireBookAccess(this.db, bookId, actor, false)
    const rows = await this.db.selectFrom('acc_periods').selectAll().where('book_id', '=', bookId).orderBy('period_month', 'asc').execute()
    return rows.map((row) => ({ bookId, month: row.period_month, locked: row.locked, revision: String(row.revision) }))
  }

  private async requireBookAccess(executor: Executor, bookId: string, actor: ApprovalActor, operate: boolean) {
    const book = await executor.selectFrom('acc_books').select('id').where('id', '=', bookId).executeTakeFirst()
    if (!book) throw new AccApplicationError('acc_book_not_found')
    if (actor.trusted === true) return
    const access = await executor.selectFrom('acc_book_access').selectAll()
      .where('book_id', '=', bookId).where('user_id', '=', actor.id).executeTakeFirst()
    if (!access || (operate ? !access.can_operate : !access.can_query))
      throw new AccApplicationError('acc_book_access_denied')
  }

  private async validateOpening(executor: Executor, input: AccOpeningInput) {
    if (input.lines.length === 0) throw new AccApplicationError('acc_opening_empty')
    const subjects = await executor.selectFrom('acc_subjects').select(['id', 'enabled', 'required_dimensions'])
      .where('book_id', '=', input.bookId).execute()
    const byId = new Map(subjects.map((subject) => [subject.id, subject]))
    const totals = new Map<string, { debit: bigint; credit: bigint }>()
    for (const line of input.lines) {
      const subject = byId.get(line.subjectId)
      if (!subject?.enabled) throw new AccApplicationError('acc_opening_subject_invalid')
      const required = subject.required_dimensions as unknown as string[]
      if (required.some((dimension) => !line.dimensions[dimension]))
        throw new AccApplicationError('acc_opening_dimension_required')
      const amount = decimalUnits(line.amount)
      const total = totals.get(line.currency) ?? { debit: 0n, credit: 0n }
      total[line.direction === 'DEBIT' ? 'debit' : 'credit'] += amount
      totals.set(line.currency, total)
    }
    if ([...totals.values()].some((total) => total.debit !== total.credit))
      throw new AccApplicationError('acc_opening_unbalanced')
  }

  private async readOpening(executor: Executor, bookId: string, actor: ApprovalActor) {
    const row = await executor.selectFrom('approval_entries as e')
      .innerJoin('acc_opening_snapshots as s', 's.approval_entry_id', 'e.id')
      .select(['e.id', 'e.subject_id', 'e.status', 'e.revision', 'e.submitted_by', 'e.submitted_at',
        'e.approved_by', 'e.approved_at', 'e.rejected_by', 'e.rejected_at', 'e.rejection_reason', 's.payload'])
      .where('e.domain', '=', 'acc').where('e.entity', '=', 'opening')
      .where('e.subject_id', '=', bookId).executeTakeFirst()
    if (!row) throw new AccApplicationError('approval_not_found')
    const entry = entryFromRow(row)
    return {
      bookId,
      submissionId: row.id,
      status: row.status as ApprovalStatus,
      revision: String(row.revision),
      payload: row.payload as unknown as AccOpeningInput,
      availableApprovalActions: availableApprovalActions(entry, actor),
    }
  }

  async getOpening(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/opening/query')
    await this.requireBookAccess(this.db, bookId, actor, false)
    return this.readOpening(this.db, bookId, actor)
  }

  async deleteOpening(input: AccOpeningReviewInput, actor: ApprovalActor, requestId: string) {
    requirePermission(actor, '/acc/opening/delete')
    return this.db.transaction().execute(async (tx) => {
      const row = await tx.selectFrom('approval_entries').selectAll().where('id', '=', input.submissionId)
        .where('domain', '=', 'acc').where('entity', '=', 'opening').where('subject_id', '=', input.bookId).forUpdate().executeTakeFirst()
      if (!row) throw new AccApplicationError('approval_not_found')
      await this.requireBookAccess(tx, input.bookId, actor, true)
      if (String(row.revision) !== input.expectedRevision) throw new AccApplicationError('approval_stale_revision')
      if (row.status === 'APPROVED') throw new AccApplicationError('acc_opening_delete_blocked')
      if (actor.trusted !== true && row.submitted_by !== actor.id) throw new AccApplicationError('approval_invalid_action')
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: row.id, domain: 'acc', entity: 'opening', subject_id: input.bookId,
        version_no: null, action: 'DELETED', from_status: row.status, to_status: null,
        from_revision: row.revision, to_revision: null, actor_id: actor.id, reason: null,
        request_id: requestId, created_at: new Date(),
      }).execute()
      await tx.deleteFrom('approval_entries').where('id', '=', row.id).executeTakeFirstOrThrow()
      return { submissionId: row.id, deleted: true as const }
    })
  }

  private bookView(row: { id: string; code: string; name: string; description: string; start_month: string; base_currency: string; control_book: boolean; revision: string | number | bigint }) {
    return { id: row.id, code: row.code, name: row.name, description: row.description, startMonth: row.start_month, baseCurrency: row.base_currency, controlBook: row.control_book, revision: String(row.revision) }
  }

  private subjectView(row: { id: string; book_id: string; code: string; name: string; parent_id: string | null; balance_direction: string; enabled: boolean; required_dimensions: JsonValue; inventory_quantity: boolean; settlement_purpose: string; revision: string | number | bigint }) {
    return { id: row.id, bookId: row.book_id, code: row.code, name: row.name, parentId: row.parent_id, balanceDirection: row.balance_direction, enabled: row.enabled, requiredDimensions: row.required_dimensions as unknown as string[], inventoryQuantity: row.inventory_quantity, settlementPurpose: row.settlement_purpose, revision: String(row.revision) }
  }
}
