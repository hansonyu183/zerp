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
  type VouPayloadFor,
  type VouReferenceCandidateEntity,
  vouDocumentPrefixes,
  vouPayloadReferences,
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
import { lockAccountingPeriod } from '../acc/period-lock.ts'
import type { AccControlBalancePort } from '../acc/service.ts'
import type { WflVouPort } from '../wfl/service.ts'

export type VouPersistenceExecutor = Kysely<DB> | Transaction<DB>
type Executor = VouPersistenceExecutor

export type VouPersistenceReader = {
  entity: VouEntity
  documentId: string
  approvalEntryId: string
  businessDate: string
  payload: VouPayload
}

/** The sole cross-domain read seam for persisted VOU wire facts. */
export async function readVouPersistence(
  executor: VouPersistenceExecutor,
  input: { documentId?: string; approvalEntryId?: string },
): Promise<VouPersistenceReader> {
  if ((input.documentId === undefined) === (input.approvalEntryId === undefined))
    throw new VouApplicationError('vou_not_found')
  const entry = await executor
    .selectFrom('approval_entries as entry')
    .innerJoin('vou_documents as document', 'document.id', 'entry.subject_id')
    .select([
      'entry.id as approval_entry_id',
      'entry.entity as entry_entity',
      'document.id as document_id',
      'document.entity as document_entity',
    ])
    .where('entry.domain', '=', 'vou')
    .$if(input.documentId !== undefined, (query) =>
      query.where('document.id', '=', input.documentId!),
    )
    .$if(input.approvalEntryId !== undefined, (query) =>
      query.where('entry.id', '=', input.approvalEntryId!),
    )
    .executeTakeFirst()
  if (!entry || entry.entry_entity !== entry.document_entity)
    throw new VouApplicationError('vou_not_found')
  const reader = new VouService(executor as Kysely<DB>, {
    acc: { async apply() {} },
    wfl: { async apply() {} },
  })
  const entity = entry.document_entity as VouEntity
  const header = await reader.readDetailHeader(executor, entity, entry.approval_entry_id)
  return {
    entity,
    documentId: entry.document_id,
    approvalEntryId: entry.approval_entry_id,
    businessDate: header.businessDate,
    payload: await reader.readPayload(executor, entity, entry.approval_entry_id),
  }
}

const vouEntityDetailTables: Readonly<Record<VouEntity, string>> = {
  'sale-pricing': 'vou_sale_pricing_details',
  'sale-order': 'vou_sale_order_details',
  'sale-outbound': 'vou_sale_outbound_details',
  'sale-delivery': 'vou_sale_delivery_details',
  'sale-signoff': 'vou_sale_signoff_details',
  'sale-return': 'vou_sale_return_details',
  'purchase-order': 'vou_purchase_order_details',
  'purchase-inbound': 'vou_purchase_inbound_details',
  'purchase-return': 'vou_purchase_return_details',
  'purchase-inquiry': 'vou_purchase_inquiry_details',
  'order-production': 'vou_order_production_details',
  'self-production': 'vou_self_production_details',
  'inventory-count': 'vou_inventory_count_details',
  'sales-receipt': 'vou_sales_receipt_details',
  'purchase-refund': 'vou_purchase_refund_details',
  'other-receipt': 'vou_other_receipt_details',
  'sales-refund': 'vou_sales_refund_details',
  'purchase-payment': 'vou_purchase_payment_details',
  'other-payment': 'vou_other_payment_details',
  'employee-loan': 'vou_employee_loan_details',
  'employee-repayment': 'vou_employee_repayment_details',
  'employee-loan-writeoff': 'vou_employee_loan_writeoff_details',
  'expense-reimbursement': 'vou_expense_reimbursement_details',
  'expense-payment': 'vou_expense_payment_details',
  'other-income': 'vou_other_income_details',
  'asset-acquisition': 'vou_asset_acquisition_details',
  'asset-sale': 'vou_asset_sale_details',
  'asset-liquidation': 'vou_asset_liquidation_details',
  'bill-receipt': 'vou_bill_receipt_details',
  'bill-payment': 'vou_bill_payment_details',
  'bill-issue': 'vou_bill_issue_details',
  'bill-discount': 'vou_bill_discount_details',
  'bill-maturity': 'vou_bill_maturity_details',
  'intermediary-calculation': 'vou_intermediary_calculation_details',
  'service-contract': 'vou_service_contract_details',
  'service-acceptance': 'vou_service_acceptance_details',
}

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

export type VouReferenceCandidate = {
  objectId: string
  approvalEntryId?: string
  code: string
  name: string
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

export interface VouEffects {
  acc: PlanExecutor<AccApplicationPlan> & Partial<AccControlBalancePort>
  wfl: PlanExecutor<WflApplicationPlan>
}

type VouReferenceBlocker = {
  kind: 'REFERENCE'
  field: string
  entity: string
  objectId: string
  approvalEntryId: string | null
}

type VouReferenceValidation =
  { ok: true } | { ok: false; blockers: readonly VouReferenceBlocker[] }

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

function decimalToFixed(
  value: string | undefined,
  scale: number,
): bigint | null {
  if (value === undefined) return null
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fractional = ''] = unsigned.split('.')
  const multiplier = 10n ** BigInt(scale)
  const fixed =
    BigInt(whole) * multiplier +
    BigInt((fractional + '0'.repeat(scale)).slice(0, scale))
  return negative ? -fixed : fixed
}

function fixedDecimal(value: bigint, scale = 8): string {
  const sign = value < 0n ? '-' : ''
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0')
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}

function payloadAmountMinor(payload: VouPayload): bigint {
  return 'amount' in payload ? decimalToFixed(payload.amount, 2) ?? 0n : 0n
}

function contentMatches(
  mimeType: VouAttachmentStageInput['mimeType'],
  content: Buffer,
): boolean {
  if (mimeType === 'application/pdf')
    return content.subarray(0, 5).toString() === '%PDF-'
  if (mimeType === 'image/png')
    return content
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return (
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[content.length - 2] === 0xff &&
    content[content.length - 1] === 0xd9
  )
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
      submitted: {
        actorId: row.submitted_by,
        occurredAt: row.submitted_at.toISOString(),
      },
      ...(status === 'APPROVED' && row.approved_by && row.approved_at
        ? {
            approved: {
              actorId: row.approved_by,
              occurredAt: row.approved_at.toISOString(),
            },
          }
        : {}),
      ...(status === 'REJECTED' &&
      row.rejected_by &&
      row.rejected_at &&
      row.rejection_reason
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

export class VouService implements WflVouPort {
  private readonly db: Kysely<DB>
  private readonly accEffects: PlanExecutor<AccApplicationPlan> & Partial<AccControlBalancePort>
  private readonly wflEffects: PlanExecutor<WflApplicationPlan>

  constructor(db: Kysely<DB>, effects: VouEffects) {
    this.db = db
    this.accEffects = effects.acc
    this.wflEffects = effects.wfl
  }

  async stageAttachment(
    entity: VouEntity,
    input: VouAttachmentStageInput,
    actor: ApprovalActor,
  ) {
    requirePermission(actor, `/vou/${entity}/attachment-stage`)
    if (!actor.id.trim())
      throw new VouApplicationError('approval_invalid_actor')
    const content = Buffer.from(input.contentBase64, 'base64')
    if (
      content.length !== input.size ||
      input.size < 1 ||
      input.size > 10_485_760
    )
      throw new VouApplicationError('vou_attachment_size_invalid')
    if (!contentMatches(input.mimeType, content))
      throw new VouApplicationError('vou_attachment_type_invalid')
    const digest = createHash('sha256').update(content).digest('hex')
    if (digest !== input.digest)
      throw new VouApplicationError('vou_attachment_digest_invalid')
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000)
    await this.db.transaction().execute(async (tx) => {
      const existing = await tx
        .selectFrom('vou_attachment_staging')
        .selectAll()
        .where('id', '=', input.stagingId)
        .forUpdate()
        .executeTakeFirst()
      if (existing) {
        if (
          existing.owner_user_id !== actor.id ||
          existing.file_id !== input.fileId ||
          existing.digest !== digest ||
          existing.mime_type !== input.mimeType ||
          existing.size_bytes !== input.size
        )
          throw new VouApplicationError('vou_attachment_staging_conflict')
        await tx
          .updateTable('vou_attachment_staging')
          .set({ expires_at: expiresAt })
          .where('id', '=', input.stagingId)
          .execute()
        return
      }
      await tx
        .insertInto('vou_attachment_staging')
        .values({
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
        })
        .execute()
    })
    return {
      ...input,
      contentBase64: undefined,
      expiresAt: expiresAt.toISOString(),
    }
  }

  async cleanupAttachments(
    entity: VouEntity,
    actor: ApprovalActor,
  ): Promise<number> {
    requirePermission(actor, `/vou/${entity}/attachment-cleanup`)
    const result = await this.db
      .deleteFrom('vou_attachment_staging')
      .where('expires_at', '<=', new Date())
      .executeTakeFirst()
    return Number(result.numDeletedRows)
  }

  async submit(
    entity: VouEntity,
    action: 'submit-new' | 'submit-change',
    input: VouSubmitInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<VouView> {
    return this.db
      .transaction()
      .execute((transaction) =>
        this.submitInTransaction(
          transaction,
          entity,
          action,
          input,
          actor,
          requestId,
          actor.trusted === true,
        ),
      )
  }

  private async submitInTransaction(
    tx: Transaction<DB>,
    entity: VouEntity,
    action: 'submit-new' | 'submit-change',
    input: VouSubmitInput,
    actor: ApprovalActor,
    requestId: string,
    trustedSystemActor: boolean,
  ): Promise<VouView> {
    if (!trustedSystemActor)
      requirePermission(actor, `/vou/${entity}/${action}`)
    const hash = requestHash(action, entity, input)
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:idempotency:${entity}:${input.idempotencyKey}`}, 0))`.execute(
      tx,
    )
    const prior = await tx
      .selectFrom('vou_idempotency')
      .select(['request_hash', 'response'])
      .where('entity', '=', entity)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst()
    if (prior) {
      if (prior.request_hash !== hash)
        throw new VouApplicationError('vou_idempotency_conflict')
      return prior.response as unknown as VouView
    }
    const periodMonth = input.payload.businessDate.slice(0, 7)
    await lockAccountingPeriod(tx, periodMonth)
    const locked = await tx
      .selectFrom('acc_periods')
      .select('book_id')
      .where('period_month', '=', periodMonth)
      .where('locked', '=', true)
      .executeTakeFirst()
    if (locked) throw new VouApplicationError('vou_period_locked')
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:document:${input.documentId}`}, 0))`.execute(
      tx,
    )
    const document = await tx
      .selectFrom('vou_documents')
      .selectAll()
      .where('id', '=', input.documentId)
      .forUpdate()
      .executeTakeFirst()
    if (document && document.entity !== entity)
      throw new VouApplicationError('vou_document_entity_mismatch')
    const current = await tx
      .selectFrom('approval_entries')
      .select('id')
      .where('domain', '=', 'vou')
      .where('subject_id', '=', input.documentId)
      .executeTakeFirst()
    if (input.payload.parentDocumentId) {
      const parent = await tx
        .selectFrom('vou_documents')
        .select(['id', 'entity'])
        .where('id', '=', input.payload.parentDocumentId)
        .executeTakeFirst()
      if (
        !parent ||
        parent.entity !== input.payload.parentEntity ||
        parent.id === input.documentId
      )
        throw new VouApplicationError('vou_parent_invalid')
    }
    const facts = {
      actor,
      documentExists: document !== undefined,
      currentSubmissionId: current?.id ?? null,
      currentRevision: document ? String(document.stable_revision) : null,
      periodOpen: locked === undefined,
      trustedSystemActor,
    }
    const preflight = prepareVouSubmission(
      {
        action,
        entity,
        ...input,
      } as unknown as import('@zerp/model').VouSubmissionCommand,
      {
        ...facts,
        referencesValid: true,
      },
    )
    if (!preflight.ok) throw new VouApplicationError(preflight.errorKey)
    const referenceValidation = await this.validateReferences(tx, input.payload)
    if (!referenceValidation.ok)
      throw new VouApplicationError('vou_reference_unavailable', [
        ...referenceValidation.blockers,
      ])
    const now = new Date()
    let documentNo = document?.document_no
    if (!document) {
      const counter = await sql<{ last_value: number }>`
          INSERT INTO vou_document_counters (entity, business_date, last_value)
          VALUES (${entity}, ${input.payload.businessDate}::date, 1)
          ON CONFLICT (entity, business_date) DO UPDATE
            SET last_value = vou_document_counters.last_value + 1
            WHERE vou_document_counters.last_value < 9999
          RETURNING last_value
        `.execute(tx)
      const next = counter.rows[0]?.last_value
      if (next === undefined)
        throw new VouApplicationError('vou_document_number_exhausted')
      documentNo = `${vouDocumentPrefixes[entity]}-${input.payload.businessDate.replaceAll('-', '')}-${String(next).padStart(4, '0')}`
      await tx
        .insertInto('vou_documents')
        .values({
          id: input.documentId,
          entity,
          document_no: documentNo,
          created_at: now,
          created_by: actor.id,
        })
        .execute()
    }
    await this.validateStaging(tx, input.payload, actor.id)
    await tx
      .insertInto('approval_entries')
      .values({
        id: input.submissionId,
        domain: 'vou',
        entity,
        subject_id: input.documentId,
        version_no: null,
        status: 'PENDING',
        revision: 1,
        submitted_by: actor.id,
        submitted_at: now,
        updated_by: actor.id,
        updated_at: now,
      })
      .execute()
    await this.writeTypedDetail(
      tx,
      entity,
      input.submissionId,
      input.documentId,
      input.payload,
    )
    await this.promoteAttachments(
      tx,
      input.submissionId,
      input.payload,
      actor.id,
      now,
    )
    await tx
      .insertInto('approval_events')
      .values({
        id: ulid(),
        entry_id: input.submissionId,
        domain: 'vou',
        entity,
        subject_id: input.documentId,
        version_no: null,
        action: 'SUBMITTED',
        from_status: null,
        to_status: 'PENDING',
        from_revision: null,
        to_revision: 1,
        actor_id: actor.id,
        reason: null,
        request_id: requestId,
        created_at: now,
      })
      .execute()
    const view = await this.readView(tx, entity, input.documentId, actor)
    await tx
      .insertInto('vou_idempotency')
      .values({
        entity,
        idempotency_key: input.idempotencyKey,
        request_hash: hash,
        document_id: input.documentId,
        submission_id: input.submissionId,
        response: json(view),
        created_at: now,
      })
      .execute()
    return view
  }

  async review(
    entity: VouEntity,
    action: ApprovalAction,
    input: VouReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<VouView> {
    return this.db
      .transaction()
      .execute((transaction) =>
        this.reviewInTransaction(
          transaction,
          entity,
          action,
          input,
          actor,
          requestId,
        ),
      )
  }

  private async reviewInTransaction(
    tx: Transaction<DB>,
    entity: VouEntity,
    action: ApprovalAction,
    input: VouReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<VouView> {
    requirePermission(actor, `/vou/${entity}/${action}`)
    await this.lockDocumentPeriod(tx, entity, input.documentId)
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:document:${input.documentId}`}, 0))`.execute(
      tx,
    )
    const row = await tx
      .selectFrom('approval_entries')
      .selectAll()
      .where('id', '=', input.submissionId)
      .where('domain', '=', 'vou')
      .where('entity', '=', entity)
      .where('subject_id', '=', input.documentId)
      .forUpdate()
      .executeTakeFirst()
    if (!row) throw new VouApplicationError('approval_not_found')
    if (String(row.revision) !== input.expectedRevision)
      throw new VouApplicationError('approval_stale_revision')
    const blockers =
      action === 'unapprove'
        ? await this.downstreamBlockers(tx, input.documentId)
        : []
    const document = await tx
      .selectFrom('vou_documents')
      .select('document_no')
      .where('id', '=', input.documentId)
      .executeTakeFirstOrThrow()
    const persistedPayload = await this.readPayload(tx, entity, row.id)
    if (action === 'approve')
      await this.validateApprovalControlGates(
        tx,
        entity,
        input.documentId,
        persistedPayload,
        actor,
      )
    const effectAction =
      action === 'approve'
        ? 'approve'
        : action === 'unapprove'
          ? 'unapprove'
          : null
    const occurredAtIso = new Date().toISOString()
    const decision = prepareVouApproval(
      action,
      entryFromRow(row),
      actor,
      {
        irreversibleBlockers: blockers,
        accounting: {
          kind:
            action === 'approve'
              ? 'POST'
              : action === 'unapprove'
                ? 'REVERSE'
                : 'NONE',
          bookIds: [],
        },
        inventory: { kind: 'NONE', lineCount: 0 },
        workflow: {
          kind:
            action === 'approve'
              ? 'START_OR_CONTINUE'
              : action === 'unapprove'
                ? 'REVERSE'
                : 'NONE',
        },
      },
      input.reason,
      { occurredAt: occurredAtIso, requestId },
    )
    if (!decision.ok)
      throw new VouApplicationError(decision.errorKey, [
        ...(decision.blockers ?? []),
      ])
    const plan = decision.plan.approval
    const occurredAt = new Date(occurredAtIso)
    const coordinator = new ApplicationTransactionCoordinator({
      approval: {
        apply: async (transaction) => {
          await transaction
            .updateTable('approval_entries')
            .set({
              status: plan.toStatus,
              revision: BigInt(plan.toRevision),
              updated_by: actor.id,
              updated_at: occurredAt,
              approved_by: plan.metadata.approved?.actorId ?? null,
              approved_at: plan.metadata.approved
                ? new Date(plan.metadata.approved.occurredAt)
                : null,
              rejected_by: plan.metadata.rejected?.actorId ?? null,
              rejected_at: plan.metadata.rejected
                ? new Date(plan.metadata.rejected.occurredAt)
                : null,
              rejection_reason: plan.metadata.rejected?.reason ?? null,
            })
            .where('id', '=', row.id)
            .where('revision', '=', plan.fromRevision)
            .executeTakeFirstOrThrow()
          await transaction
            .insertInto('approval_events')
            .values({
              id: ulid(),
              entry_id: row.id,
              domain: 'vou',
              entity,
              subject_id: input.documentId,
              version_no: null,
              action: plan.event.action,
              from_status: plan.fromStatus,
              to_status: plan.toStatus,
              from_revision: BigInt(plan.fromRevision),
              to_revision: BigInt(plan.toRevision),
              actor_id: actor.id,
              reason: plan.reason ?? null,
              request_id: requestId,
              created_at: occurredAt,
            })
            .execute()
        },
      },
      vou: { async apply() {} },
      acc: this.accEffects,
      wfl: this.wflEffects,
      rpt: { async apply() {} },
    })
    await coordinator.execute(tx, {
      approval: {
        kind: 'approval',
        action: 'APPLY',
        transition: plan,
        entity,
        documentId: input.documentId,
      },
      vou: effectAction
        ? { kind: 'vou', action: effectAction, documentId: input.documentId }
        : { kind: 'vou', action: 'NONE' },
      acc: effectAction
        ? {
            kind: 'acc',
            action: effectAction,
            entity,
            documentId: input.documentId,
            documentNo: document.document_no,
            approvalEntryId: row.id,
            approvalRevision: effectAction === 'unapprove'
              ? plan.fromRevision
              : plan.toRevision,
            payload: persistedPayload,
            occurredAt: occurredAt.toISOString(),
          }
        : { kind: 'acc', action: 'NONE' },
      wfl: effectAction
        ? {
            kind: 'wfl',
            action: effectAction,
            entity,
            documentId: input.documentId,
            approvalEntryId: row.id,
            payload: persistedPayload,
            actorId: actor.id,
            occurredAt: occurredAt.toISOString(),
          }
        : { kind: 'wfl', action: 'NONE' },
      rpt: { kind: 'rpt', action: 'NONE' },
    })
    return this.readView(tx, entity, input.documentId, actor)
  }

  async get(entity: VouEntity, documentId: string, actor: ApprovalActor) {
    requirePermission(actor, `/vou/${entity}/get`)
    return this.readView(this.db, entity, documentId, actor)
  }

  async query(entity: VouEntity, actor: ApprovalActor): Promise<VouView[]> {
    requirePermission(actor, `/vou/${entity}/query`)
    const rows = await this.db
      .selectFrom('vou_documents as d')
      .innerJoin('approval_entries as e', (join) =>
        join
          .onRef('e.subject_id', '=', 'd.id')
          .onRef('e.entity', '=', 'd.entity')
          .on('e.domain', '=', 'vou'),
      )
      .select('d.id')
      .where('d.entity', '=', entity)
      .orderBy('d.document_no', 'desc')
      .execute()
    return Promise.all(
      rows.map((row) => this.readView(this.db, entity, row.id, actor)),
    )
  }

  async queryReferenceCandidates(
    input: { entity: VouReferenceCandidateEntity; keyword?: string },
    actor: ApprovalActor,
  ): Promise<{ items: VouReferenceCandidate[] }> {
    requirePermission(actor, '/vou/reference/query')
    const keyword = input.keyword?.trim()
    const filter = keyword
      ? sql`WHERE code ILIKE ${`%${keyword}%`} OR name ILIKE ${`%${keyword}%`}`
      : sql``
    const source = this.referenceCandidateSource(input.entity)
    const result = await sql<{ object_id: string; approval_entry_id: string | null; code: string; name: string }>`
      SELECT * FROM (${sql.raw(source)}) AS candidate ${filter} ORDER BY code, object_id LIMIT 200
    `.execute(this.db)
    return { items: result.rows.map((row) => ({ objectId: row.object_id, ...(row.approval_entry_id ? { approvalEntryId: row.approval_entry_id } : {}), code: row.code, name: row.name })) }
  }

  private referenceCandidateSource(entity: VouReferenceCandidateEntity): string {
    const dcl = (name: string, table: string, label: string) => `
      SELECT subject.id AS object_id, approval.id AS approval_entry_id, subject.code, ${label} AS name
      FROM dcl_subjects subject
      JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'dcl' AND entry.entity = '${name}' AND entry.subject_id = subject.id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
      JOIN ${table} version ON version.approval_entry_id = approval.id AND version.enabled
      WHERE subject.entity = '${name}'`
    switch (entity) {
      case 'customer': return dcl('customer', 'dcl_customer_versions', 'version.display_name')
      case 'supplier': return dcl('supplier', 'dcl_supplier_versions', 'version.display_name')
      case 'operating-entity': return dcl('operating-entity', 'dcl_operating_entity_versions', 'version.legal_name')
      case 'employee': return dcl('employee', 'dcl_employee_versions', 'version.display_name')
      case 'warehouse': return dcl('warehouse', 'dcl_warehouse_versions', 'version.name')
      case 'other-unit': return dcl('other-unit', 'dcl_other_unit_versions', 'version.display_name')
      case 'vehicle': return dcl('vehicle', 'dcl_vehicle_versions', 'version.name')
      case 'fund-account': return dcl('fund-account', 'dcl_fund_account_versions', 'version.name')
      case 'sales-partner': return dcl('sales-partner', 'dcl_sales_partner_versions', 'version.display_name')
      case 'product': return dcl('product', 'dcl_product_versions', 'version.name')
      case 'customer-subunit': return `
        SELECT root.subunit_id AS object_id, approval.id AS approval_entry_id, root.code, subunit.name
        FROM dcl_customer_subunit_roots root
        JOIN LATERAL (SELECT id FROM approval_entries entry WHERE entry.domain = 'dcl' AND entry.entity = 'customer' AND entry.subject_id = root.customer_id AND entry.status = 'APPROVED' ORDER BY entry.version_no DESC LIMIT 1) approval ON TRUE
        JOIN dcl_customer_versions customer ON customer.approval_entry_id = approval.id AND customer.enabled
        JOIN dcl_customer_version_subunits subunit ON subunit.customer_approval_entry_id = approval.id AND subunit.subunit_id = root.subunit_id AND subunit.enabled`
      case 'settlement-method':
      case 'measurement-unit':
      case 'asset-category':
      case 'department': return `SELECT id AS object_id, NULL::varchar AS approval_entry_id, code, COALESCE(data->>'name', code) AS name FROM aux_objects WHERE entity = '${entity}' AND enabled`
      case 'asset': return `SELECT id AS object_id, NULL::varchar AS approval_entry_id, asset_no AS code, name FROM acc_asset_registers WHERE status = 'ACTIVE'`
      case 'bill': return `SELECT id AS object_id, NULL::varchar AS approval_entry_id, bill_no AS code, bill_no AS name FROM acc_bill_registers WHERE status = 'AVAILABLE'`
      case 'service-contract': return `SELECT document.id AS object_id, approval.id AS approval_entry_id, document.document_no AS code, document.document_no AS name FROM vou_documents document JOIN approval_entries approval ON approval.subject_id = document.id AND approval.domain = 'vou' AND approval.entity = 'service-contract' AND approval.status = 'APPROVED'`
    }
  }

  async auditHistory(
    entity: VouEntity,
    documentId: string,
    actor: ApprovalActor,
  ) {
    requirePermission(actor, `/vou/${entity}/audit-history`)
    const rows = await this.db
      .selectFrom('approval_events')
      .selectAll()
      .where('domain', '=', 'vou')
      .where('entity', '=', entity)
      .where('subject_id', '=', documentId)
      .orderBy('created_at', 'asc')
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
      createdAt: row.created_at.toISOString(),
    }))
  }

  async delete(
    entity: VouEntity,
    input: VouReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ) {
    return this.db
      .transaction()
      .execute((transaction) =>
        this.deleteInTransaction(transaction, entity, input, actor, requestId),
      )
  }

  private async deleteInTransaction(
    tx: Transaction<DB>,
    entity: VouEntity,
    input: VouReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, `/vou/${entity}/delete`)
    await this.lockDocumentPeriod(tx, entity, input.documentId)
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:document:${input.documentId}`}, 0))`.execute(
      tx,
    )
    const row = await tx
      .selectFrom('approval_entries')
      .selectAll()
      .where('id', '=', input.submissionId)
      .where('domain', '=', 'vou')
      .where('entity', '=', entity)
      .where('subject_id', '=', input.documentId)
      .forUpdate()
      .executeTakeFirst()
    if (!row) throw new VouApplicationError('approval_not_found')
    if (String(row.revision) !== input.expectedRevision)
      throw new VouApplicationError('approval_stale_revision')
    if (row.status === 'APPROVED')
      throw new VouApplicationError('vou_delete_blocked')
    if (actor.trusted !== true && row.submitted_by !== actor.id)
      throw new VouApplicationError('approval_invalid_action')
    const blockers = await this.downstreamBlockers(tx, input.documentId)
    if (blockers.length > 0)
      throw new VouApplicationError('vou_delete_blocked', blockers)
    const now = new Date()
    await tx
      .insertInto('approval_events')
      .values({
        id: ulid(),
        entry_id: row.id,
        domain: 'vou',
        entity,
        subject_id: input.documentId,
        version_no: null,
        action: 'DELETED',
        from_status: row.status,
        to_status: null,
        from_revision: row.revision,
        to_revision: null,
        actor_id: actor.id,
        reason: null,
        request_id: requestId,
        created_at: now,
      })
      .execute()
    await tx.deleteFrom('approval_entries').where('id', '=', row.id).execute()
    await tx
      .updateTable('vou_documents')
      .set({ stable_revision: sql`stable_revision + 1` })
      .where('id', '=', input.documentId)
      .execute()
    return {
      documentId: input.documentId,
      submissionId: input.submissionId,
      deleted: true,
    }
  }

  async createChild(
    transaction: Transaction<DB>,
    input: {
      entity: VouEntity
      parent: { entity: VouEntity; documentId: string; submissionId: string }
      initial: unknown
      requestKey: string
      actor: ApprovalActor
      requestId: string
    },
  ): Promise<{ documentId: string; submissionId: string }> {
    if (
      !input.initial ||
      typeof input.initial !== 'object' ||
      Array.isArray(input.initial)
    )
      throw new VouApplicationError('vou_invalid_payload')
    const initial = input.initial as Partial<VouPayload>
    if (
      typeof initial.businessDate !== 'string' ||
      typeof initial.currency !== 'string' ||
      !Array.isArray(initial.attachments)
    )
      throw new VouApplicationError('vou_invalid_payload')
    const documentId = ulid()
    const submissionId = ulid()
    await this.submitInTransaction(
      transaction,
      input.entity,
      'submit-new',
      {
        documentId,
        submissionId,
        // WFL owns requestKey deduplication in wfl_action_results.  The VOU
        // submission keeps its own invariant: its idempotency key is the
        // generated submission identity.
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...initial,
          parentEntity: input.parent.entity,
          parentDocumentId: input.parent.documentId,
        } as VouPayload,
      },
      input.actor,
      input.requestId,
      true,
    )
    return { documentId, submissionId }
  }

  async approveChild(
    transaction: Transaction<DB>,
    input: {
      entity: VouEntity
      documentId: string
      submissionId: string
      expectedRevision: string
      actor: ApprovalActor
      requestId: string
    },
  ): Promise<void> {
    await this.reviewInTransaction(
      transaction,
      input.entity,
      'approve',
      input,
      input.actor,
      input.requestId,
    )
  }

  async rejectChild(
    transaction: Transaction<DB>,
    input: {
      entity: VouEntity
      documentId: string
      submissionId: string
      expectedRevision: string
      reason: string
      actor: ApprovalActor
      requestId: string
    },
  ): Promise<void> {
    await this.reviewInTransaction(
      transaction,
      input.entity,
      'reject',
      input,
      input.actor,
      input.requestId,
    )
  }

  async retryChild(
    transaction: Transaction<DB>,
    input: {
      entity: VouEntity
      documentId: string
      submissionId: string
      expectedRevision: string
      actor: ApprovalActor
      requestId: string
    },
  ): Promise<void> {
    await this.reviewInTransaction(
      transaction,
      input.entity,
      'unreject',
      input,
      input.actor,
      input.requestId,
    )
  }

  async cancelChild(
    transaction: Transaction<DB>,
    input: {
      entity: VouEntity
      documentId: string
      submissionId: string
      expectedRevision: string
      actor: ApprovalActor
      requestId: string
    },
  ): Promise<void> {
    await this.deleteInTransaction(
      transaction,
      input.entity,
      input,
      input.actor,
      input.requestId,
    )
  }

  private async readView(
    executor: Executor,
    entity: VouEntity,
    documentId: string,
    actor: ApprovalActor,
  ): Promise<VouView> {
    const row = await executor
      .selectFrom('vou_documents as d')
      .innerJoin('approval_entries as e', (join) =>
        join.onRef('e.subject_id', '=', 'd.id').on('e.domain', '=', 'vou'),
      )
      .select([
        'd.id as document_id',
        'd.entity',
        'd.document_no',
        'd.stable_revision',
        'e.id',
        'e.status',
        'e.revision',
        'e.submitted_by',
        'e.submitted_at',
        'e.approved_by',
        'e.approved_at',
        'e.rejected_by',
        'e.rejected_at',
        'e.rejection_reason',
      ])
      .where('d.id', '=', documentId)
      .where('d.entity', '=', entity)
      .executeTakeFirst()
    if (!row) throw new VouApplicationError('vou_not_found')
    const entry = entryFromRow({
      ...row,
      entity: row.entity,
      subject_id: row.document_id,
    })
    return {
      entity,
      documentId: row.document_id,
      documentNo: row.document_no,
      stableRevision: String(row.stable_revision),
      submissionId: row.id,
      status: row.status as ApprovalStatus,
      revision: String(row.revision),
      submittedBy: row.submitted_by,
      submittedAt: row.submitted_at.toISOString(),
      approvedBy: row.approved_by,
      approvedAt: row.approved_at?.toISOString() ?? null,
      rejectedBy: row.rejected_by,
      rejectedAt: row.rejected_at?.toISOString() ?? null,
      rejectionReason: row.rejection_reason,
      payload: await this.readPayload(executor, entity, row.id),
      availableApprovalActions: availableApprovalActions(entry, actor),
      canDelete:
        (row.status === 'PENDING' || row.status === 'REJECTED') &&
        (actor.trusted === true || actor.id === row.submitted_by) &&
        (actor.trusted === true ||
          actor.permissions.includes(`/vou/${entity}/delete`)),
    }
  }

  private async validateStaging(
    executor: Executor,
    payload: VouPayload,
    ownerId: string,
  ) {
    if (payload.attachments.length > 10)
      throw new VouApplicationError('vou_attachment_limit_exceeded')
    for (const attachment of payload.attachments) {
      const row = await executor
        .selectFrom('vou_attachment_staging')
        .selectAll()
        .where('id', '=', attachment.stagingId)
        .where('file_id', '=', attachment.id)
        .where('owner_user_id', '=', ownerId)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst()
      if (
        !row ||
        row.digest !== attachment.sha256 ||
        row.mime_type !== attachment.contentType ||
        row.size_bytes !== attachment.sizeBytes
      )
        throw new VouApplicationError('vou_attachment_staging_invalid')
    }
  }

  private async lockDocumentPeriod(
    transaction: Transaction<DB>,
    entity: VouEntity,
    documentId: string,
  ): Promise<void> {
    const entry = await transaction
      .selectFrom('approval_entries')
      .select('id')
      .where('domain', '=', 'vou')
      .where('entity', '=', entity)
      .where('subject_id', '=', documentId)
      .executeTakeFirst()
    if (!entry) return
    const header = await this.readDetailHeader(transaction, entity, entry.id)
    const month = header.businessDate.slice(0, 7)
    await lockAccountingPeriod(transaction, month)
    const locked = await transaction
      .selectFrom('acc_periods')
      .select('book_id')
      .where('period_month', '=', month)
      .where('locked', '=', true)
      .executeTakeFirst()
    if (locked) throw new VouApplicationError('vou_period_locked')
  }

  private async validateReferences(
    transaction: Transaction<DB>,
    payload: VouPayload,
  ): Promise<VouReferenceValidation> {
    const blockers: VouReferenceBlocker[] = []
    for (const fact of vouPayloadReferences(payload)) {
      const { reference, candidateEntity } = fact
      const blocker: VouReferenceBlocker = {
        kind: 'REFERENCE',
        field: fact.field,
        entity: candidateEntity,
        objectId: reference.objectId,
        approvalEntryId: reference.approvalEntryId,
      }
      const historical = await this.validHistoricalReference(
        transaction,
        candidateEntity,
        reference.objectId,
        reference.approvalEntryId,
      )
      if (!historical) {
        blockers.push(blocker)
        continue
      }
      if (reference.selectionOrigin === 'CURRENT') {
        const current = await this.currentReferenceAvailable(
          transaction,
          candidateEntity,
          reference.objectId,
          reference.approvalEntryId,
        )
        if (!current) blockers.push(blocker)
      }
    }
    return blockers.length === 0 ? { ok: true } : { ok: false, blockers }
  }

  private async validHistoricalReference(
    transaction: Transaction<DB>,
    entity: VouReferenceCandidateEntity,
    objectId: string,
    approvalEntryId: string,
  ): Promise<boolean> {
    if (entity === 'customer-subunit') {
      const row = await sql`
        SELECT 1
        FROM dcl_customer_subunit_roots root
        JOIN approval_entries approval
          ON approval.id = ${approvalEntryId}
          AND approval.domain = 'dcl'
          AND approval.entity = 'customer'
          AND approval.subject_id = root.customer_id
          AND approval.status = 'APPROVED'
        JOIN dcl_customer_version_subunits subunit
          ON subunit.customer_approval_entry_id = approval.id
          AND subunit.subunit_id = root.subunit_id
        WHERE root.subunit_id = ${objectId}
        FOR UPDATE
      `.execute(transaction)
      return row.rows.length === 1
    }
    const domain = entity === 'service-contract' ? 'vou' : 'dcl'
    const row = await transaction
      .selectFrom('approval_entries')
      .select('id')
      .where('id', '=', approvalEntryId)
      .where('domain', '=', domain)
      .where('entity', '=', entity)
      .where('subject_id', '=', objectId)
      .where('status', '=', 'APPROVED')
      .forUpdate()
      .executeTakeFirst()
    return row !== undefined
  }

  private async currentReferenceAvailable(
    transaction: Transaction<DB>,
    entity: VouReferenceCandidateEntity,
    objectId: string,
    approvalEntryId: string,
  ): Promise<boolean> {
    const source = this.referenceCandidateSource(entity)
    const row = await sql`
      SELECT 1
      FROM (${sql.raw(source)}) AS candidate
      WHERE candidate.object_id = ${objectId}
        AND candidate.approval_entry_id = ${approvalEntryId}
      LIMIT 1
    `.execute(transaction)
    return row.rows.length === 1
  }

  private async writeTypedDetail(
    transaction: Transaction<DB>,
    entity: VouEntity,
    approvalEntryId: string,
    documentId: string,
    payload: VouPayload,
  ): Promise<void> {
    const amount = payloadAmountMinor(payload)
    await sql`
      INSERT INTO ${sql.raw(vouEntityDetailTables[entity])} (
        approval_entry_id, document_id, business_date, currency,
        total_amount_minor, parent_entity, parent_document_id, remark
      ) VALUES (
        ${approvalEntryId}, ${documentId}, ${payload.businessDate}::date,
        ${payload.currency}, ${amount}, ${payload.parentEntity ?? null},
        ${payload.parentDocumentId ?? null}, ${payload.remark ?? null}
      )
    `.execute(transaction)
    await this.writeReferenceSnapshots(transaction, approvalEntryId, payload)
    if (entity === 'bill-issue')
      await this.writeReferenceSnapshot(transaction, approvalEntryId, 'supplier', 0, 0, (payload as Record<string, any>).supplier)
    if ('priceLines' in payload)
      for (const [index, line] of payload.priceLines.entries()) {
        const lineNo = index + 1
        await sql`
          INSERT INTO vou_price_line_snapshots (approval_entry_id, line_no, unit_price_minor, remark)
          VALUES (${approvalEntryId}, ${lineNo}, ${decimalToFixed(line.unitPrice, 2)!}, ${line.remark ?? null})
        `.execute(transaction)
        await this.writeReferenceSnapshot(transaction, approvalEntryId, 'product', lineNo, 0, line.product)
      }
    if ('productLines' in payload)
      for (const [index, line] of payload.productLines.entries()) {
        const lineNo = index + 1
        await sql`
          INSERT INTO vou_product_line_snapshots (
            approval_entry_id, line_no, line_id, entered_quantity_micros, entered_unit_id,
            base_quantity_micros, unit_price_minor, settlement_surcharge_minor,
            purchase_unit_price_minor, remark, delivery_specification_type,
            container_type, quantity_per_container_micros, formula_source_type,
            formula_source_document_id, formula_source_document_no,
            formula_output_entered_quantity_micros, formula_output_entered_unit_id,
            formula_output_base_quantity_micros
          ) VALUES (
            ${approvalEntryId}, ${lineNo}, ${line.lineId}, ${decimalToFixed(line.enteredQuantity, 6)!},
            ${line.enteredUnit.objectId}, ${decimalToFixed(line.baseQuantity, 6)!},
            ${decimalToFixed(line.unitPrice, 2)!}, ${decimalToFixed(line.settlementSurcharge ?? undefined, 2)},
            ${decimalToFixed(line.purchaseUnitPrice, 2)}, ${line.remark ?? null},
            ${line.deliverySpecificationType ?? null}, ${line.containerType ?? null},
            ${decimalToFixed(line.quantityPerContainer ?? undefined, 6)}, ${line.formula?.sourceType ?? null},
            ${line.formula?.sourceDocumentId ?? null}, ${line.formula?.sourceDocumentNo ?? null},
            ${decimalToFixed(line.formula?.output.enteredQuantity, 6)},
            ${line.formula?.output.enteredUnit.objectId ?? null},
            ${decimalToFixed(line.formula?.output.baseQuantity, 6)}
          )
        `.execute(transaction)
        await this.writeReferenceSnapshot(transaction, approvalEntryId, 'product', lineNo, 0, line.product)
        for (const [componentIndex, component] of (line.formula?.components ?? []).entries())
          await sql`
            INSERT INTO vou_formula_component_snapshots (
              approval_entry_id, line_no, component_no, material_id,
              entered_quantity_micros, entered_unit_id, base_quantity_micros
            ) VALUES (
              ${approvalEntryId}, ${lineNo}, ${componentIndex + 1}, ${component.material.objectId},
              ${decimalToFixed(component.quantity.enteredQuantity, 6)!},
              ${component.quantity.enteredUnit.objectId}, ${decimalToFixed(component.quantity.baseQuantity, 6)!}
            )
          `.execute(transaction)
      }
    if ('sourceLines' in payload)
      await this.writeSourceLines(transaction, approvalEntryId, payload.sourceLines)
    if ('signoffLines' in payload)
      for (const [index, line] of payload.signoffLines.entries())
        await sql`
          INSERT INTO vou_signoff_line_snapshots (
            approval_entry_id, line_no, source_line_id, signed_quantity_micros, rejected_quantity_micros, remark
          ) VALUES (
            ${approvalEntryId}, ${index + 1}, ${line.sourceLineId},
            ${decimalToFixed(line.signedBaseQuantity, 6)!}, ${decimalToFixed(line.rejectedBaseQuantity, 6)!}, ${line.remark ?? null}
          )
        `.execute(transaction)
    if ('returnLines' in payload)
      await this.writeReturnLines(transaction, approvalEntryId, payload.returnLines)
    if ('expenseLines' in payload)
      for (const [index, line] of payload.expenseLines.entries())
        await sql`
          INSERT INTO vou_expense_line_snapshots (approval_entry_id, line_no, category, description, amount_minor, remark)
          VALUES (${approvalEntryId}, ${index + 1}, ${line.category}, ${line.description}, ${decimalToFixed(line.amount, 2)!}, ${line.remark ?? null})
        `.execute(transaction)
    if ('inventoryCountLines' in payload)
      for (const [index, line] of payload.inventoryCountLines.entries()) {
        const lineNo = index + 1
        await sql`
          INSERT INTO vou_inventory_count_line_snapshots (
            approval_entry_id, line_no, entered_quantity_micros, entered_unit_id, base_quantity_micros, remark
          ) VALUES (${approvalEntryId}, ${lineNo}, ${decimalToFixed(line.enteredQuantity, 6)!}, ${line.enteredUnit.objectId}, ${decimalToFixed(line.baseQuantity, 6)!}, ${line.remark ?? null})
        `.execute(transaction)
        await this.writeReferenceSnapshot(transaction, approvalEntryId, 'product', lineNo, 0, line.product)
      }
    if ('productionLines' in payload)
      for (const [index, line] of payload.productionLines.entries()) {
        const lineNo = index + 1
        await sql`
          INSERT INTO vou_production_line_snapshots (
            approval_entry_id, line_no, source_order_line_id, entered_quantity_micros,
            entered_unit_id, base_quantity_micros, loss_rate_micros, remark
          ) VALUES (${approvalEntryId}, ${lineNo}, ${line.sourceOrderLineId ?? null},
            ${decimalToFixed(line.enteredQuantity, 6)!}, ${line.enteredUnit.objectId},
            ${decimalToFixed(line.baseQuantity, 6)!}, ${decimalToFixed(line.lossRate, 6)!}, ${line.remark ?? null})
        `.execute(transaction)
        if (line.product) await this.writeReferenceSnapshot(transaction, approvalEntryId, 'product', lineNo, 0, line.product)
        for (const [materialIndex, material] of line.materials.entries())
          await sql`
            INSERT INTO vou_production_material_snapshots (
              approval_entry_id, line_no, material_no, formula_line_no, material_id,
              entered_quantity_micros, entered_unit_id, base_quantity_micros, adjustment_reason
            ) VALUES (${approvalEntryId}, ${lineNo}, ${materialIndex + 1}, ${material.formulaLineNo},
              ${material.actualMaterial.objectId}, ${decimalToFixed(material.actualEnteredQuantity, 6)!},
              ${material.actualEnteredUnit.objectId}, ${decimalToFixed(material.actualBaseQuantity, 6)!}, ${material.adjustmentReason ?? null})
          `.execute(transaction)
      }
    if ('subunitAllocations' in payload)
      for (const [index, allocation] of payload.subunitAllocations.entries()) {
        const lineNo = index + 1
        await sql`INSERT INTO vou_amount_allocation_snapshots (approval_entry_id, line_no, amount_minor) VALUES (${approvalEntryId}, ${lineNo}, ${decimalToFixed(allocation.amount, 2)!})`.execute(transaction)
        await this.writeReferenceSnapshot(transaction, approvalEntryId, 'subunit', lineNo, 0, allocation.subunit)
      }
    if ('assetAcquisitionLines' in payload)
      for (const [index, line] of payload.assetAcquisitionLines.entries()) {
        const lineNo = index + 1
        await sql`
          INSERT INTO vou_asset_acquisition_line_snapshots (
            approval_entry_id, line_no, asset_name, specification, original_value_minor,
            useful_life_months, residual_rate_micros, location, remark
          ) VALUES (
            ${approvalEntryId}, ${lineNo}, ${line.assetName}, ${line.specification ?? null},
            ${decimalToFixed(line.originalValue, 2)!}, ${line.usefulLifeMonths},
            ${decimalToFixed(line.residualRate, 6)!}, ${line.location ?? null}, ${line.remark ?? null}
          )
        `.execute(transaction)
        await this.writeReferenceSnapshot(transaction, approvalEntryId, 'category', lineNo, 0, line.category)
        await this.writeReferenceSnapshot(transaction, approvalEntryId, 'department', lineNo, 0, line.department)
        if (line.custodian) await this.writeReferenceSnapshot(transaction, approvalEntryId, 'custodian', lineNo, 0, line.custodian)
      }
    if ('assetSaleLines' in payload)
      for (const [index, line] of payload.assetSaleLines.entries())
        await sql`
          INSERT INTO vou_asset_disposal_line_snapshots (approval_entry_id, line_no, asset_id, sale_amount_minor, remark)
          VALUES (${approvalEntryId}, ${index + 1}, ${line.assetId}, ${decimalToFixed(line.saleAmount, 2)!}, ${line.remark ?? null})
        `.execute(transaction)
    if ('assetLiquidationLines' in payload)
      for (const [index, line] of payload.assetLiquidationLines.entries())
        await sql`
          INSERT INTO vou_asset_disposal_line_snapshots (
            approval_entry_id, line_no, asset_id, reason, salvage_income_minor, disposal_expense_minor, remark
          ) VALUES (
            ${approvalEntryId}, ${index + 1}, ${line.assetId}, ${line.reason},
            ${decimalToFixed(line.salvageIncome, 2)!}, ${decimalToFixed(line.disposalExpense, 2)!}, ${line.remark ?? null}
          )
        `.execute(transaction)
    if ('billLines' in payload)
      for (const [index, line] of payload.billLines.entries()) {
        const lineNo = index + 1
        const value = line as Record<string, unknown>
        await sql`
          INSERT INTO vou_bill_line_snapshots (
            approval_entry_id, line_no, bill_id, position_type, direction, purpose, bill_type,
            bill_no, medium, currency, face_amount_minor, issue_date, maturity_date, drawer,
            acceptor, payee, annual_rate_bps, remark
          ) VALUES (
            ${approvalEntryId}, ${lineNo}, ${typeof value.billId === 'string' ? value.billId : null},
            ${typeof value.positionType === 'string' ? value.positionType : null}, ${typeof value.direction === 'string' ? value.direction : null},
            ${value.purpose as string}, ${typeof value.billType === 'string' ? value.billType : null},
            ${typeof value.billNo === 'string' ? value.billNo : null}, ${typeof value.medium === 'string' ? value.medium : null},
            ${typeof value.currency === 'string' ? value.currency : null}, ${typeof value.faceAmount === 'string' ? decimalToFixed(value.faceAmount, 2) : null},
            ${typeof value.issueDate === 'string' ? value.issueDate : null}::date, ${typeof value.maturityDate === 'string' ? value.maturityDate : null}::date,
            ${typeof value.drawer === 'string' ? value.drawer : null}, ${typeof value.acceptor === 'string' ? value.acceptor : null},
            ${typeof value.payee === 'string' ? value.payee : null}, ${typeof value.annualRateBps === 'number' ? value.annualRateBps : null}, ${typeof value.remark === 'string' ? value.remark : null}
          )
        `.execute(transaction)
      }
    if ('billCashLines' in payload)
      for (const [index, line] of (payload.billCashLines ?? []).entries()) {
        const lineNo = index + 1
        await sql`
          INSERT INTO vou_bill_cash_line_snapshots (approval_entry_id, line_no, bill_line_id, direction, amount_type, amount_minor, remark)
          VALUES (${approvalEntryId}, ${lineNo}, ${line.billLineId ?? null}, ${line.direction}, ${line.amountType}, ${decimalToFixed(line.amount, 2)!}, ${line.remark ?? null})
        `.execute(transaction)
        await this.writeReferenceSnapshot(transaction, approvalEntryId, 'fundAccount', lineNo, 0, line.fundAccount)
      }
    if ('intermediaryCalculation' in payload)
      await this.writeIntermediaryCalculation(transaction, approvalEntryId, payload.intermediaryCalculation)
    await this.writeEntityScalars(transaction, entity, approvalEntryId, payload)
  }

  private async writeSourceLines(
    transaction: Transaction<DB>,
    approvalEntryId: string,
    lines: readonly { sourceLineId: string; baseQuantity: string; remark?: string }[],
  ) {
    for (const [index, line] of lines.entries())
      await sql`
        INSERT INTO vou_source_line_snapshots (approval_entry_id, line_no, source_line_id, base_quantity_micros, remark)
        VALUES (${approvalEntryId}, ${index + 1}, ${line.sourceLineId}, ${decimalToFixed(line.baseQuantity, 6)!}, ${line.remark ?? null})
      `.execute(transaction)
  }

  private async writeReturnLines(
    transaction: Transaction<DB>,
    approvalEntryId: string,
    lines: readonly { sourceLineId: string; baseQuantity: string; remark?: string }[],
  ) {
    for (const [index, line] of lines.entries())
      await sql`
        INSERT INTO vou_return_line_snapshots (approval_entry_id, line_no, source_line_id, base_quantity_micros, remark)
        VALUES (${approvalEntryId}, ${index + 1}, ${line.sourceLineId}, ${decimalToFixed(line.baseQuantity, 6)!}, ${line.remark ?? null})
      `.execute(transaction)
  }

  private async writeReferenceSnapshots(
    transaction: Transaction<DB>,
    approvalEntryId: string,
    payload: VouPayload,
  ) {
    for (const { field, reference } of vouPayloadReferences(payload))
      await this.writeReferenceSnapshot(transaction, approvalEntryId, field, 0, 0, reference)
  }

  private async writeReferenceSnapshot(
    transaction: Transaction<DB>,
    approvalEntryId: string,
    field: string,
    lineNo: number,
    itemNo: number,
    reference: { objectId: string; approvalEntryId?: string; selectionOrigin?: 'CURRENT' | 'HISTORICAL'; entity?: string; code?: string; name?: string },
  ) {
    await sql`
      INSERT INTO vou_reference_snapshots (
        approval_entry_id, field, line_no, item_no, object_id, approval_reference_id, selection_origin,
        reference_entity, reference_code, reference_name
      ) VALUES (
        ${approvalEntryId}, ${field}, ${lineNo}, ${itemNo}, ${reference.objectId},
        ${reference.approvalEntryId ?? null}, ${reference.selectionOrigin ?? null},
        ${reference.entity ?? null}, ${reference.code ?? null}, ${reference.name ?? null}
      )
    `.execute(transaction)
  }

  private async writeIntermediaryCalculation(
    transaction: Transaction<DB>,
    approvalEntryId: string,
    calculation: import('@zerp/model').VouIntermediaryCalculationInput,
  ) {
    for (const [index, line] of calculation.source.lines.entries()) {
      const lineNo = index + 1
      await sql`
        INSERT INTO vou_intermediary_source_line_snapshots (
          approval_entry_id, line_no, source_signoff_line_id, source_kind, signoff_document_id,
          signoff_document_no, signoff_date, order_document_id, order_document_no, order_date,
          due_date, collection_date, collection_delay_days, sales_attribution_type,
          sales_contract_status, sales_contract_document_id, sales_contract_revision,
          sales_contract_applicable_from, sales_contract_applicable_to, sales_contract_terms,
          behavior_profile, signed_quantity_micros, pricing_quantity_micros,
          standard_piece_quantity_micros, unit_price_minor, reference_unit_price_minor,
          settlement_surcharge_minor, line_amount_minor, settlement_term_code,
          special_approval, return_document_nos, adjustment_employee_amount_minor,
          adjustment_intermediary_amount_minor
        ) VALUES (
          ${approvalEntryId}, ${lineNo}, ${line.sourceSignoffLineId}, ${line.sourceKind},
          ${line.signoffDocumentId}, ${line.signoffDocumentNo}, ${line.signoffDate}::date,
          ${line.orderDocumentId}, ${line.orderDocumentNo}, ${line.orderDate}::date,
          ${line.dueDate}::date, ${line.collectionDate}::date, ${line.collectionDelayDays},
          ${line.salesAttributionType}, ${line.salesContractStatus},
          ${line.salesContract?.documentId ?? null}, ${line.salesContract?.revision ?? null},
          ${line.salesContract?.applicableFrom ?? null}::date, ${line.salesContract?.applicableTo ?? null}::date,
          ${line.salesContract?.terms ?? null}, ${line.behaviorProfile},
          ${decimalToFixed(line.signedBaseQuantity, 6)!}, ${decimalToFixed(line.pricingQuantity, 6)!},
          ${decimalToFixed(line.standardPieceQuantity, 6)!}, ${decimalToFixed(line.unitPrice, 2)!},
          ${decimalToFixed(line.referenceUnitPrice, 2)!}, ${decimalToFixed(line.settlementSurcharge, 2)!},
          ${decimalToFixed(line.lineAmount, 2)!}, ${line.settlementTermCode}, ${line.specialApproval},
          ${line.returnDocumentNos ?? []}, ${decimalToFixed(line.adjustmentEmployeeAmount, 2)!},
          ${decimalToFixed(line.adjustmentIntermediaryAmount, 2)!}
        )
      `.execute(transaction)
      for (const [field, reference] of Object.entries({ customer: line.customer, salesperson: line.salesperson, intermediary: line.intermediary, product: line.product }))
        if (reference) await this.writeReferenceSnapshot(transaction, approvalEntryId, `intermediary.${field}`, lineNo, 0, { ...reference, selectionOrigin: 'HISTORICAL' })
    }
    for (const [index, bill] of calculation.source.bills.entries()) {
      const lineNo = index + 1
      await sql`
        INSERT INTO vou_intermediary_bill_snapshots (
          approval_entry_id, line_no, bill_line_id, receipt_document_id, receipt_document_no,
          receipt_date, bill_type, face_amount_minor, issue_date, maturity_date, cost_days
        ) VALUES (${approvalEntryId}, ${lineNo}, ${bill.billLineId}, ${bill.receiptDocumentId},
          ${bill.receiptDocumentNo}, ${bill.receiptDate}::date, ${bill.billType},
          ${decimalToFixed(bill.faceAmount, 2)!}, ${bill.issueDate}::date, ${bill.maturityDate}::date, ${bill.costDays})
      `.execute(transaction)
      await this.writeReferenceSnapshot(transaction, approvalEntryId, 'intermediary.bill.customer', lineNo, 0, { ...bill.customer, selectionOrigin: 'HISTORICAL' })
    }
    for (const [index, line] of calculation.result.lines.entries())
      await sql`
        INSERT INTO vou_intermediary_result_line_snapshots (
          approval_entry_id, line_no, source_signoff_line_id, premium_unit_price_minor,
          standard_piece_quantity_micros, base_commission_minor, premium_commission_minor,
          low_price_commission_minor, market_maintenance_subsidy_minor,
          market_development_subsidy_minor, bill_cost_minor, bill_line_ids,
          employee_amount_minor, intermediary_amount_minor, note
        ) VALUES (${approvalEntryId}, ${index + 1}, ${line.sourceSignoffLineId},
          ${decimalToFixed(line.premiumUnitPrice, 2)!}, ${decimalToFixed(line.standardPieceQuantity, 6)!},
          ${decimalToFixed(line.baseCommission, 2)!}, ${decimalToFixed(line.premiumCommission, 2)!},
          ${decimalToFixed(line.lowPriceCommission, 2)!}, ${decimalToFixed(line.marketMaintenanceSubsidy, 2)!},
          ${decimalToFixed(line.marketDevelopmentSubsidy, 2)!}, ${decimalToFixed(line.billCost, 2)!},
          ${line.billLineIds}, ${decimalToFixed(line.employeeAmount, 2)!}, ${decimalToFixed(line.intermediaryAmount, 2)!}, ${line.note ?? null})
      `.execute(transaction)
    for (const [index, summary] of calculation.result.summaries.entries()) {
      const lineNo = index + 1
      await sql`INSERT INTO vou_intermediary_summary_snapshots (approval_entry_id, line_no, category, amount_minor) VALUES (${approvalEntryId}, ${lineNo}, ${summary.category}, ${decimalToFixed(summary.amount, 2)!})`.execute(transaction)
      await this.writeReferenceSnapshot(transaction, approvalEntryId, 'intermediary.summary.payee', lineNo, 0, { ...summary.payee, selectionOrigin: 'HISTORICAL' })
    }
  }

  private async writeEntityScalars(
    transaction: Transaction<DB>,
    entity: VouEntity,
    approvalEntryId: string,
    payload: VouPayload,
  ) {
    const value = payload as Record<string, any>
    const update = async (set: ReturnType<typeof sql>) =>
      set.execute(transaction)
    switch (entity) {
      case 'sale-signoff':
        await update(sql`
          UPDATE vou_sale_signoff_details
          SET expected_solvent_containers = ${value.expectedSolventContainers},
            expected_resin_containers = ${value.expectedResinContainers},
            returned_solvent_containers = ${value.returnedSolventContainers},
            returned_resin_containers = ${value.returnedResinContainers},
            container_difference_reason = ${value.containerDifferenceReason ?? null}
          WHERE approval_entry_id = ${approvalEntryId}
        `)
        break
      case 'sale-order':
        await update(sql`
          UPDATE vou_sale_order_details
          SET credit_override_reason = ${value.creditOverrideReason ?? null}
          WHERE approval_entry_id = ${approvalEntryId}
        `)
        break
      case 'sale-return':
        await update(sql`UPDATE vou_sale_return_details SET return_reason = ${'returnReason' in payload ? payload.returnReason : null} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'purchase-order':
        break
      case 'purchase-return':
        await update(sql`UPDATE vou_purchase_return_details SET return_reason = ${'returnReason' in payload ? payload.returnReason : null} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'other-receipt':
        await update(sql`UPDATE vou_other_receipt_details SET counterparty_type = ${value.counterpartyType}, other_category = ${value.otherCategory ?? null} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'other-payment':
        await update(sql`UPDATE vou_other_payment_details SET counterparty_type = ${value.counterpartyType}, other_category = ${value.otherCategory ?? null} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'other-income':
        await update(sql`UPDATE vou_other_income_details SET source_name = ${value.sourceName}, counterparty_type = ${value.counterpartyType ?? null} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'bill-receipt':
        await update(sql`UPDATE vou_bill_receipt_details SET internal_cost_rate_bps = ${value.internalCostRateBps ?? null} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'bill-issue':
        await update(sql`UPDATE vou_bill_issue_details SET interest_mode = ${value.interestMode} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'bill-discount':
        await update(sql`UPDATE vou_bill_discount_details SET interest_mode = ${value.interestMode}, with_recourse = ${value.withRecourse ?? null} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'bill-maturity':
        await update(sql`UPDATE vou_bill_maturity_details SET maturity_type = ${value.maturityType} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'intermediary-calculation':
        await update(sql`UPDATE vou_intermediary_calculation_details SET period_start = ${value.intermediaryCalculation.source.periodStart}::date, period_end = ${value.intermediaryCalculation.source.periodEnd}::date, source_hash = ${value.intermediaryCalculation.sourceHash}, script_id = ${value.intermediaryCalculation.script.scriptId}, script_revision = ${value.intermediaryCalculation.script.revision}, script_name = ${value.intermediaryCalculation.script.name}, script_source = ${value.intermediaryCalculation.script.source}, script_hash = ${value.intermediaryCalculation.script.hash} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'service-contract':
        await update(sql`UPDATE vou_service_contract_details SET capabilities = ${value.serviceContract.capabilities ?? null}, applicable_from = ${value.serviceContract.applicableFrom ?? null}::date, applicable_to = ${value.serviceContract.applicableTo ?? null}::date, terms = ${value.serviceContract.terms ?? null} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      case 'service-acceptance':
        await update(sql`UPDATE vou_service_acceptance_details SET contract_document_id = ${value.serviceAcceptance.contractDocumentId}, service_date = ${value.serviceAcceptance.serviceDate}::date, acceptance_date = ${value.serviceAcceptance.acceptanceDate}::date, settlement_direction = ${value.serviceAcceptance.settlementDirection}, fulfillment_fact = ${value.serviceAcceptance.fulfillmentFact ?? null}, acceptance_fact = ${value.serviceAcceptance.acceptanceFact ?? null} WHERE approval_entry_id = ${approvalEntryId}`)
        break
      default:
        break
    }
  }

  private controlBalances(): AccControlBalancePort {
    if (!this.accEffects.partyBalance || !this.accEffects.customerCreditOccupancy)
      throw new VouApplicationError('acc_control_book_unavailable')
    return this.accEffects as AccControlBalancePort
  }

  private businessDateToday(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date())
    const value = (kind: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === kind)?.value ?? ''
    return `${value('year')}-${value('month')}-${value('day')}`
  }

  private orderAmount(payload: VouPayload): bigint {
    if (!('productLines' in payload)) return 0n
    return payload.productLines.reduce((total, line) =>
      total + (decimalToFixed(line.baseQuantity, 6) ?? 0n)
        * (decimalToFixed(line.unitPrice, 2) ?? 0n) / 1_000_000n,
    0n) * 1_000_000n
  }

  private async orderSource(
    tx: Transaction<DB>,
    entity: VouEntity,
    documentId: string,
  ): Promise<{ entity: 'sale-order' | 'purchase-order'; documentId: string; approvalEntryId: string; payload: VouPayload }> {
    let currentEntity = entity
    let currentDocumentId = documentId
    for (let depth = 0; depth < 8; depth += 1) {
      const entry = await tx.selectFrom('approval_entries')
        .select(['id', 'status']).where('domain', '=', 'vou').where('entity', '=', currentEntity)
        .where('subject_id', '=', currentDocumentId).executeTakeFirst()
      if (!entry) break
      const payload = await this.readPayload(tx, currentEntity, entry.id)
      if (currentEntity === 'sale-order' || currentEntity === 'purchase-order') {
        if (currentDocumentId !== documentId && entry.status !== 'APPROVED')
          throw new VouApplicationError('vou_settlement_source_unavailable')
        return { entity: currentEntity, documentId: currentDocumentId, approvalEntryId: entry.id, payload }
      }
      if (!payload.parentEntity || !payload.parentDocumentId) break
      currentEntity = payload.parentEntity
      currentDocumentId = payload.parentDocumentId
    }
    throw new VouApplicationError('vou_settlement_source_unavailable')
  }

  private async settlementTerm(
    tx: Transaction<DB>,
    entity: 'sale-order' | 'purchase-order',
    payload: VouPayload,
  ): Promise<'PREPAID' | 'CASH_ON_DELIVERY' | null> {
    if (entity === 'sale-order') {
      const order = payload as VouPayloadFor<'sale-order'>
      const row = await sql<{ settlement_snapshot: { termCode?: string } | null }>`
        SELECT subunit.settlement_snapshot
        FROM dcl_customer_version_subunits subunit
        WHERE subunit.customer_approval_entry_id = ${order.customerSubunit.approvalEntryId}
          AND subunit.subunit_id = ${order.customerSubunit.objectId}
        FOR UPDATE
      `.execute(tx)
      const term = row.rows[0]?.settlement_snapshot?.termCode
      return term === 'PREPAID' || term === 'CASH_ON_DELIVERY' ? term : null
    }
    const order = payload as VouPayloadFor<'purchase-order'>
    const row = await sql<{ settlement_method_snapshot: { termCode?: string } | null }>`
      SELECT supplier.settlement_method_snapshot
      FROM dcl_supplier_versions supplier
      WHERE supplier.approval_entry_id = ${order.supplier.approvalEntryId}
        AND supplier.enabled
      FOR UPDATE
    `.execute(tx)
    const term = row.rows[0]?.settlement_method_snapshot?.termCode
    return term === 'PREPAID' || term === 'CASH_ON_DELIVERY' ? term : null
  }

  private async validateApprovalControlGates(
    tx: Transaction<DB>,
    entity: VouEntity,
    documentId: string,
    payload: VouPayload,
    actor: ApprovalActor,
  ): Promise<void> {
    if (!['sale-order', 'purchase-order', 'sale-signoff', 'purchase-inbound'].includes(entity)) return
    const source = await this.orderSource(tx, entity, documentId)
    const term = await this.settlementTerm(tx, source.entity, source.payload)
    const today = this.businessDateToday()
    const control = this.controlBalances()
    const amount = await this.settlementAmount(tx, entity, documentId, source)
    if (source.entity === 'sale-order') {
      const order = source.payload as VouPayloadFor<'sale-order'>
      if (entity === 'sale-signoff') {
        const signoff = payload as VouPayloadFor<'sale-signoff'>
        if (signoff.customerSubunit.objectId !== order.customerSubunit.objectId || signoff.customerSubunit.approvalEntryId !== order.customerSubunit.approvalEntryId)
          throw new VouApplicationError('vou_settlement_source_mismatch')
      }
      const purpose = term === 'PREPAID' ? 'ADVANCE_RECEIPT' : 'RECEIVABLE'
      if (term) {
        const balance = await control.partyBalance(tx, {
          counterpartyDimension: 'CUSTOMER_SUBUNIT', counterpartyObjectId: order.customerSubunit.objectId,
          currency: source.payload.currency, settlementPurpose: purpose, asOfDate: today,
        })
        const sufficient = term === 'PREPAID' ? balance >= amount : balance <= 0n
        if (!sufficient) throw new VouApplicationError('vou_settlement_insufficient')
      }
      if (entity === 'sale-order') {
        const limit = await sql<{ credit_limit: string | null }>`
          SELECT item->>'amount' AS credit_limit
          FROM dcl_customer_version_subunits subunit, jsonb_array_elements(subunit.credit_limits) item
          WHERE subunit.customer_approval_entry_id = ${order.customerSubunit.approvalEntryId}
            AND subunit.subunit_id = ${order.customerSubunit.objectId}
            AND item->>'currency' = ${source.payload.currency}
          FOR UPDATE OF subunit
        `.execute(tx)
        const configuredLimit = limit.rows[0]?.credit_limit
        if (configuredLimit !== undefined && configuredLimit !== null) {
          const creditLimit = decimalToFixed(configuredLimit, 8) ?? 0n
          const occupancy = await control.customerCreditOccupancy(tx, {
            customerSubunitId: order.customerSubunit.objectId, currency: source.payload.currency, asOfDate: today,
          })
          const excess = occupancy + amount - creditLimit
          if (excess > 0n && (!actor.permissions.includes('/vou/sale-order/approve-over-credit-limit') || !order.creditOverrideReason?.trim()))
            throw new VouApplicationError('vou_credit_limit_exceeded')
          const entry = await tx.selectFrom('approval_entries').select('id')
            .where('domain', '=', 'vou').where('entity', '=', 'sale-order')
            .where('subject_id', '=', documentId).executeTakeFirstOrThrow()
          await sql`
            UPDATE vou_sale_order_details
            SET credit_limit = ${fixedDecimal(creditLimit)},
              credit_occupancy_before = ${fixedDecimal(occupancy)},
              credit_order_amount = ${fixedDecimal(amount)},
              credit_over_amount = ${fixedDecimal(excess > 0n ? excess : 0n)},
              credit_override_reason = ${excess > 0n ? order.creditOverrideReason!.trim() : null},
              credit_override_actor_id = ${excess > 0n ? actor.id : null}
            WHERE approval_entry_id = ${entry.id}
          `.execute(tx)
        }
      }
      return
    }
    const order = source.payload as VouPayloadFor<'purchase-order'>
    if (term) {
      const purpose = term === 'PREPAID' ? 'PREPAID' : 'PAYABLE'
      const balance = await control.partyBalance(tx, {
        counterpartyDimension: 'SUPPLIER', counterpartyObjectId: order.supplier.objectId,
        currency: source.payload.currency, settlementPurpose: purpose, asOfDate: today,
      })
      const sufficient = term === 'PREPAID' ? balance >= amount : balance <= 0n
      if (!sufficient) throw new VouApplicationError('vou_settlement_insufficient')
    }
  }

  private async settlementAmount(
    tx: Transaction<DB>,
    entity: VouEntity,
    documentId: string,
    order: { approvalEntryId: string; payload: VouPayload },
  ): Promise<bigint> {
    if (entity === 'sale-order' || entity === 'purchase-order') return this.orderAmount(order.payload)
    const productLines = await sql<{ line_id: string; unit_price_minor: string }>`
      SELECT line_id, unit_price_minor
      FROM vou_product_line_snapshots
      WHERE approval_entry_id = ${order.approvalEntryId}
      FOR UPDATE
    `.execute(tx)
    const prices = new Map(productLines.rows.map((line) => [line.line_id, BigInt(line.unit_price_minor)]))
    const batch = entity === 'sale-signoff'
      ? await sql<{ source_line_id: string; quantity: string }>`
          SELECT source_line_id, signed_quantity_micros::text AS quantity
          FROM vou_signoff_line_snapshots
          WHERE approval_entry_id = (SELECT id FROM approval_entries WHERE domain = 'vou' AND entity = ${entity} AND subject_id = ${documentId})
        `.execute(tx)
      : await sql<{ source_line_id: string; quantity: string }>`
          SELECT source_line_id, base_quantity_micros::text AS quantity
          FROM vou_source_line_snapshots
          WHERE approval_entry_id = (SELECT id FROM approval_entries WHERE domain = 'vou' AND entity = ${entity} AND subject_id = ${documentId})
        `.execute(tx)
    if (!batch.rows.length) throw new VouApplicationError('vou_settlement_source_unavailable')
    await this.assertSourceLineLineage(tx, entity, documentId, new Set(batch.rows.map((line) => line.source_line_id)))
    let amount = 0n
    for (const line of batch.rows) {
      const unitPrice = prices.get(line.source_line_id)
      if (unitPrice === undefined) throw new VouApplicationError('vou_settlement_source_mismatch')
      amount += BigInt(line.quantity) * unitPrice
    }
    return amount
  }

  private async assertSourceLineLineage(
    tx: Transaction<DB>,
    entity: VouEntity,
    documentId: string,
    lineIds: ReadonlySet<string>,
  ): Promise<void> {
    let currentEntity = entity
    let currentDocumentId = documentId
    while (currentEntity !== 'sale-order' && currentEntity !== 'purchase-order') {
      const entry = await tx.selectFrom('approval_entries').select('id')
        .where('domain', '=', 'vou').where('entity', '=', currentEntity)
        .where('subject_id', '=', currentDocumentId).executeTakeFirst()
      if (!entry) throw new VouApplicationError('vou_settlement_source_unavailable')
      const header = await this.readDetailHeader(tx, currentEntity, entry.id)
      if (!header.parentEntity || !header.parentDocumentId)
        throw new VouApplicationError('vou_settlement_source_unavailable')
      const parentEntry = await tx.selectFrom('approval_entries').select('id')
        .where('domain', '=', 'vou').where('entity', '=', header.parentEntity)
        .where('subject_id', '=', header.parentDocumentId).executeTakeFirst()
      if (!parentEntry) throw new VouApplicationError('vou_settlement_source_unavailable')
      if (header.parentEntity !== 'sale-order' && header.parentEntity !== 'purchase-order') {
        const inherited = await sql<{ source_line_id: string }>`
          SELECT source_line_id FROM vou_source_line_snapshots WHERE approval_entry_id = ${parentEntry.id}
          UNION ALL
          SELECT source_line_id FROM vou_signoff_line_snapshots WHERE approval_entry_id = ${parentEntry.id}
        `.execute(tx)
        const parentIds = new Set(inherited.rows.map((line) => line.source_line_id))
        if ([...lineIds].some((lineId) => !parentIds.has(lineId)))
          throw new VouApplicationError('vou_settlement_source_mismatch')
      }
      currentEntity = header.parentEntity
      currentDocumentId = header.parentDocumentId
    }
  }

  async readDetailHeader(
    executor: Executor,
    entity: VouEntity,
    approvalEntryId: string,
  ): Promise<{ businessDate: string; currency: string; amountMinor: string; parentEntity: VouEntity | undefined; parentDocumentId: string | undefined; remark: string | undefined }> {
    const result = await sql<{
      business_date: string
      currency: string
      total_amount_minor: string | number | bigint
      parent_entity: string | null
      parent_document_id: string | null
      remark: string | null
    }>`
      SELECT business_date::text AS business_date, currency, total_amount_minor, parent_entity, parent_document_id, remark
      FROM ${sql.raw(vouEntityDetailTables[entity])}
      WHERE approval_entry_id = ${approvalEntryId}
    `.execute(executor)
    const row = result.rows[0]
    if (!row) throw new VouApplicationError('vou_not_found')
    return {
      businessDate: row.business_date,
      currency: row.currency,
      amountMinor: String(row.total_amount_minor),
      parentEntity: row.parent_entity as VouEntity | undefined ?? undefined,
      parentDocumentId: row.parent_document_id ?? undefined,
      remark: row.remark ?? undefined,
    }
  }

  async readPayload(
    executor: Executor,
    entity: VouEntity,
    approvalEntryId: string,
  ): Promise<VouPayload> {
    const header = await this.readDetailHeader(executor, entity, approvalEntryId)
    const base = {
      businessDate: header.businessDate,
      currency: header.currency,
      ...(header.remark ? { remark: header.remark } : {}),
      attachments: await this.readAttachments(executor, approvalEntryId),
      ...(header.parentEntity && header.parentDocumentId
        ? { parentEntity: header.parentEntity, parentDocumentId: header.parentDocumentId }
        : {}),
    }
    const refs = await this.readReferenceSnapshots(executor, approvalEntryId)
    const reference = (field: string, lineNo = 0, itemNo = 0) => {
      const found = refs.get(`${field}:${lineNo}:${itemNo}`)
      if (!found) throw new VouApplicationError('vou_not_found')
      return found
    }
    const rows = async <Row extends Record<string, unknown>>(table: string) =>
      (await sql<Row>`SELECT * FROM ${sql.raw(table)} WHERE approval_entry_id = ${approvalEntryId} ORDER BY line_no`.execute(executor)).rows
    const fixed = (value: string | number | bigint, scale: number) => {
      const raw = BigInt(value)
      const sign = raw < 0n ? '-' : ''
      const digits = (raw < 0n ? -raw : raw).toString().padStart(scale + 1, '0')
      return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
    }
    const amount = () => fixed(header.amountMinor, 2)
    if (entity === 'sale-pricing' || entity === 'purchase-inquiry') {
      const priceLines = await rows<{ line_no: number; unit_price_minor: string; remark: string | null }>('vou_price_line_snapshots')
      return {
        ...base,
        ...(entity === 'purchase-inquiry' ? { supplier: reference('supplier') } : {}),
        priceLines: priceLines.map((line) => ({ product: reference('product', line.line_no), unitPrice: fixed(line.unit_price_minor, 2), ...(line.remark ? { remark: line.remark } : {}) })),
      } as VouPayload
    }
    if (entity === 'sale-order' || entity === 'purchase-order') {
      const productLines = await rows<{ line_no: number; line_id: string; entered_quantity_micros: string; entered_unit_id: string; base_quantity_micros: string; unit_price_minor: string; settlement_surcharge_minor: string | null; purchase_unit_price_minor: string | null; remark: string | null; delivery_specification_type: string | null; container_type: string | null; quantity_per_container_micros: string | null; formula_source_type: string | null; formula_source_document_id: string | null; formula_source_document_no: string | null; formula_output_entered_quantity_micros: string | null; formula_output_entered_unit_id: string | null; formula_output_base_quantity_micros: string | null }>('vou_product_line_snapshots')
      const components = await sql<{ line_no: number; component_no: number; material_id: string; entered_quantity_micros: string; entered_unit_id: string; base_quantity_micros: string }>`SELECT * FROM vou_formula_component_snapshots WHERE approval_entry_id = ${approvalEntryId} ORDER BY line_no, component_no`.execute(executor)
      const detail = entity === 'sale-order'
        ? (await sql<{ credit_override_reason: string | null }>`SELECT credit_override_reason FROM vou_sale_order_details WHERE approval_entry_id = ${approvalEntryId}`.execute(executor)).rows[0]
        : undefined
      const top = entity === 'sale-order'
        ? { customerSubunit: reference('customerSubunit'), ...(refs.has('salesperson:0:0') ? { salesperson: reference('salesperson') } : {}), warehouse: reference('warehouse'), ...(typeof detail?.credit_override_reason === 'string' ? { creditOverrideReason: detail.credit_override_reason } : {}) }
        : { supplier: reference('supplier'), ...(refs.has('purchaser:0:0') ? { purchaser: reference('purchaser') } : {}), warehouse: reference('warehouse') }
      return { ...base, ...top, productLines: productLines.map((line) => ({ lineId: line.line_id, product: reference('product', line.line_no), enteredQuantity: fixed(line.entered_quantity_micros, 6), enteredUnit: { objectId: line.entered_unit_id }, baseQuantity: fixed(line.base_quantity_micros, 6), unitPrice: fixed(line.unit_price_minor, 2), ...(line.settlement_surcharge_minor === null ? {} : { settlementSurcharge: fixed(line.settlement_surcharge_minor, 2) }), ...(line.purchase_unit_price_minor === null ? {} : { purchaseUnitPrice: fixed(line.purchase_unit_price_minor, 2) }), ...(line.remark ? { remark: line.remark } : {}), ...(line.delivery_specification_type ? { deliverySpecificationType: line.delivery_specification_type } : {}), ...(line.container_type !== null ? { containerType: line.container_type } : {}), ...(line.quantity_per_container_micros === null ? {} : { quantityPerContainer: fixed(line.quantity_per_container_micros, 6) }), ...(line.formula_output_entered_quantity_micros === null ? {} : { formula: { output: { enteredQuantity: fixed(line.formula_output_entered_quantity_micros, 6), enteredUnit: { objectId: line.formula_output_entered_unit_id! }, baseQuantity: fixed(line.formula_output_base_quantity_micros!, 6) }, ...(line.formula_source_type ? { sourceType: line.formula_source_type } : {}), ...(line.formula_source_document_id ? { sourceDocumentId: line.formula_source_document_id } : {}), ...(line.formula_source_document_no ? { sourceDocumentNo: line.formula_source_document_no } : {}), components: components.rows.filter((component) => component.line_no === line.line_no).map((component) => ({ material: { objectId: component.material_id }, quantity: { enteredQuantity: fixed(component.entered_quantity_micros, 6), enteredUnit: { objectId: component.entered_unit_id }, baseQuantity: fixed(component.base_quantity_micros, 6) } })) } }) })) } as VouPayload
    }
    if (entity === 'sale-outbound' || entity === 'sale-delivery' || entity === 'purchase-inbound') {
      const sourceLines = await rows<{ source_line_id: string; base_quantity_micros: string; remark: string | null }>('vou_source_line_snapshots')
      return { ...base, ...(entity === 'purchase-inbound' ? { supplier: reference('supplier'), warehouse: reference('warehouse') } : {}), ...(entity === 'sale-delivery' && refs.has('carrier:0:0') ? { carrier: reference('carrier') } : {}), ...(entity === 'sale-delivery' && refs.has('vehicle:0:0') ? { vehicle: reference('vehicle') } : {}), sourceLines: sourceLines.map((line) => ({ sourceLineId: line.source_line_id, baseQuantity: fixed(line.base_quantity_micros, 6), ...(line.remark ? { remark: line.remark } : {}) })) } as VouPayload
    }
    if (entity === 'sale-signoff') {
      const detail = (await sql<{
        expected_solvent_containers: number
        expected_resin_containers: number
        returned_solvent_containers: number
        returned_resin_containers: number
        container_difference_reason: string | null
      }>`
        SELECT expected_solvent_containers, expected_resin_containers,
          returned_solvent_containers, returned_resin_containers,
          container_difference_reason
        FROM vou_sale_signoff_details
        WHERE approval_entry_id = ${approvalEntryId}
      `.execute(executor)).rows[0]!
      const lines = await rows<{ source_line_id: string; signed_quantity_micros: string; rejected_quantity_micros: string; remark: string | null }>('vou_signoff_line_snapshots')
      return {
        ...base,
        customerSubunit: reference('customerSubunit'),
        expectedSolventContainers: detail.expected_solvent_containers,
        expectedResinContainers: detail.expected_resin_containers,
        returnedSolventContainers: detail.returned_solvent_containers,
        returnedResinContainers: detail.returned_resin_containers,
        ...(detail.container_difference_reason
          ? { containerDifferenceReason: detail.container_difference_reason }
          : {}),
        signoffLines: lines.map((line) => ({ sourceLineId: line.source_line_id, signedBaseQuantity: fixed(line.signed_quantity_micros, 6), rejectedBaseQuantity: fixed(line.rejected_quantity_micros, 6), ...(line.remark ? { remark: line.remark } : {}) })),
      } as unknown as VouPayload
    }
    if (entity === 'sale-return' || entity === 'purchase-return') {
      const detail = (await sql<{ return_reason: string }>`SELECT return_reason FROM ${sql.raw(vouEntityDetailTables[entity])} WHERE approval_entry_id = ${approvalEntryId}`.execute(executor)).rows[0]!
      const lines = await rows<{ source_line_id: string; base_quantity_micros: string; remark: string | null }>('vou_return_line_snapshots')
      return { ...base, ...(entity === 'sale-return' ? { warehouse: reference('warehouse') } : { supplier: reference('supplier'), warehouse: reference('warehouse') }), returnReason: detail.return_reason, returnLines: lines.map((line) => ({ sourceLineId: line.source_line_id, baseQuantity: fixed(line.base_quantity_micros, 6), ...(line.remark ? { remark: line.remark } : {}) })) } as unknown as VouPayload
    }
    if (entity === 'inventory-count') {
      const lines = await rows<{ line_no: number; entered_quantity_micros: string; entered_unit_id: string; base_quantity_micros: string; remark: string | null }>('vou_inventory_count_line_snapshots')
      return { ...base, warehouse: reference('warehouse'), inventoryCountLines: lines.map((line) => ({ product: reference('product', line.line_no), enteredQuantity: fixed(line.entered_quantity_micros, 6), enteredUnit: { objectId: line.entered_unit_id }, baseQuantity: fixed(line.base_quantity_micros, 6), ...(line.remark ? { remark: line.remark } : {}) })) } as unknown as VouPayload
    }
    if (entity === 'order-production' || entity === 'self-production') {
      const lines = await rows<{ line_no: number; source_order_line_id: string | null; entered_quantity_micros: string; entered_unit_id: string; base_quantity_micros: string; loss_rate_micros: string; remark: string | null }>('vou_production_line_snapshots')
      const materials = await sql<{ line_no: number; material_no: number; formula_line_no: number; material_id: string; entered_quantity_micros: string; entered_unit_id: string; base_quantity_micros: string; adjustment_reason: string | null }>`SELECT * FROM vou_production_material_snapshots WHERE approval_entry_id = ${approvalEntryId} ORDER BY line_no, material_no`.execute(executor)
      return { ...base, materialWarehouse: reference('materialWarehouse'), finishedWarehouse: reference('finishedWarehouse'), productionLines: lines.map((line) => ({ ...(line.source_order_line_id ? { sourceOrderLineId: line.source_order_line_id } : {}), ...(refs.has(`product:${line.line_no}:0`) ? { product: reference('product', line.line_no) } : {}), enteredQuantity: fixed(line.entered_quantity_micros, 6), enteredUnit: { objectId: line.entered_unit_id }, baseQuantity: fixed(line.base_quantity_micros, 6), lossRate: fixed(line.loss_rate_micros, 6), ...(line.remark ? { remark: line.remark } : {}), materials: materials.rows.filter((material) => material.line_no === line.line_no).map((material) => ({ formulaLineNo: material.formula_line_no, actualMaterial: { objectId: material.material_id }, actualEnteredQuantity: fixed(material.entered_quantity_micros, 6), actualEnteredUnit: { objectId: material.entered_unit_id }, actualBaseQuantity: fixed(material.base_quantity_micros, 6), ...(material.adjustment_reason ? { adjustmentReason: material.adjustment_reason } : {}) })) })) } as unknown as VouPayload
    }
    if (entity === 'employee-loan-writeoff' || entity === 'expense-reimbursement') {
      const lines = await rows<{ category: string; description: string; amount_minor: string; remark: string | null }>('vou_expense_line_snapshots')
      return { ...base, employee: reference('employee'), expenseLines: lines.map((line) => ({ category: line.category, description: line.description, amount: fixed(line.amount_minor, 2), ...(line.remark ? { remark: line.remark } : {}) })) } as unknown as VouPayload
    }
    if (entity === 'service-contract') {
      const detail = (await sql<Record<string, unknown>>`SELECT * FROM vou_service_contract_details WHERE approval_entry_id = ${approvalEntryId}`.execute(executor)).rows[0]!
      const counterparty = reference('counterparty')
      return { ...base, counterparty, counterpartyType: counterparty.entity, employee: reference('employee'), serviceContract: { ...(detail.capabilities ? { capabilities: detail.capabilities } : {}), ...(detail.applicable_from ? { applicableFrom: detail.applicable_from } : {}), ...(detail.applicable_to ? { applicableTo: detail.applicable_to } : {}), ...(detail.terms ? { terms: detail.terms } : {}) } } as unknown as VouPayload
    }
    if (entity === 'service-acceptance') {
      const detail = (await sql<Record<string, unknown>>`SELECT * FROM vou_service_acceptance_details WHERE approval_entry_id = ${approvalEntryId}`.execute(executor)).rows[0]!
      return { ...base, employee: reference('employee'), serviceAcceptance: { contractDocumentId: detail.contract_document_id, serviceDate: detail.service_date, acceptanceDate: detail.acceptance_date, settlementDirection: detail.settlement_direction, ...(detail.fulfillment_fact ? { fulfillmentFact: detail.fulfillment_fact } : {}), ...(detail.acceptance_fact ? { acceptanceFact: detail.acceptance_fact } : {}) } } as unknown as VouPayload
    }
    if (entity === 'asset-acquisition') {
      const lines = await rows<{ line_no: number; asset_name: string; specification: string | null; original_value_minor: string; useful_life_months: number; residual_rate_micros: string; location: string | null; remark: string | null }>('vou_asset_acquisition_line_snapshots')
      return { ...base, supplier: reference('supplier'), assetAcquisitionLines: lines.map((line) => ({ assetName: line.asset_name, ...(line.specification ? { specification: line.specification } : {}), category: reference('category', line.line_no), originalValue: fixed(line.original_value_minor, 2), usefulLifeMonths: line.useful_life_months, residualRate: fixed(line.residual_rate_micros, 6), department: reference('department', line.line_no), ...(refs.has(`custodian:${line.line_no}:0`) ? { custodian: reference('custodian', line.line_no) } : {}), ...(line.location ? { location: line.location } : {}), ...(line.remark ? { remark: line.remark } : {}) })) } as unknown as VouPayload
    }
    if (entity === 'asset-sale' || entity === 'asset-liquidation') {
      const lines = await rows<{ asset_id: string; sale_amount_minor: string | null; reason: string | null; salvage_income_minor: string | null; disposal_expense_minor: string | null; remark: string | null }>('vou_asset_disposal_line_snapshots')
      if (entity === 'asset-sale') return { ...base, customer: reference('customer'), assetSaleLines: lines.map((line) => ({ assetId: line.asset_id, saleAmount: fixed(line.sale_amount_minor!, 2), ...(line.remark ? { remark: line.remark } : {}) })) } as unknown as VouPayload
      return { ...base, assetLiquidationLines: lines.map((line) => ({ assetId: line.asset_id, reason: line.reason!, salvageIncome: fixed(line.salvage_income_minor!, 2), disposalExpense: fixed(line.disposal_expense_minor!, 2), ...(line.remark ? { remark: line.remark } : {}) })) } as unknown as VouPayload
    }
    if (entity === 'bill-receipt' || entity === 'bill-payment' || entity === 'bill-issue' || entity === 'bill-discount' || entity === 'bill-maturity') {
      const detail = (await sql<Record<string, unknown>>`SELECT * FROM ${sql.raw(vouEntityDetailTables[entity])} WHERE approval_entry_id = ${approvalEntryId}`.execute(executor)).rows[0]!
      const billLines = (await rows<{ bill_id: string | null; position_type: string | null; direction: string | null; purpose: string; bill_type: string | null; bill_no: string | null; medium: string | null; currency: string | null; face_amount_minor: string | null; issue_date: string | null; maturity_date: string | null; drawer: string | null; acceptor: string | null; payee: string | null; annual_rate_bps: number | null; remark: string | null }>('vou_bill_line_snapshots')).map((line) => line.bill_id && !line.position_type ? { billId: line.bill_id, purpose: line.purpose, ...(line.annual_rate_bps === null ? {} : { annualRateBps: line.annual_rate_bps }), ...(line.remark ? { remark: line.remark } : {}) } : { positionType: line.position_type, direction: line.direction, purpose: line.purpose, billType: line.bill_type, billNo: line.bill_no, medium: line.medium, currency: line.currency, faceAmount: fixed(line.face_amount_minor!, 2), issueDate: line.issue_date, maturityDate: line.maturity_date, drawer: line.drawer, acceptor: line.acceptor, payee: line.payee, annualRateBps: line.annual_rate_bps, ...(line.remark ? { remark: line.remark } : {}) })
      const cashRows = await rows<{ line_no: number; bill_line_id: string | null; direction: string; amount_type: string; amount_minor: string; remark: string | null }>('vou_bill_cash_line_snapshots')
      const billCashLines = cashRows.map((line) => ({ ...(line.bill_line_id ? { billLineId: line.bill_line_id } : {}), fundAccount: reference('fundAccount', line.line_no), direction: line.direction, amountType: line.amount_type, amount: fixed(line.amount_minor, 2), ...(line.remark ? { remark: line.remark } : {}) }))
      if (entity === 'bill-receipt') return { ...base, customer: reference('customer'), handler: reference('handler'), ...(detail.internal_cost_rate_bps === null ? {} : { internalCostRateBps: detail.internal_cost_rate_bps }), billLines, ...(cashRows.length ? { billCashLines } : {}) } as unknown as VouPayload
      if (entity === 'bill-payment') return { ...base, supplier: reference('supplier'), handler: reference('handler'), billLines, ...(cashRows.length ? { billCashLines } : {}) } as unknown as VouPayload
      if (entity === 'bill-issue') return { ...base, supplier: reference('supplier'), interestMode: detail.interest_mode, ...(refs.has('interestParty:0:0') ? { interestParty: reference('interestParty') } : {}), billLines, ...(cashRows.length ? { billCashLines } : {}) } as unknown as VouPayload
      if (entity === 'bill-discount') return { ...base, counterparty: reference('counterparty'), counterpartyType: 'other-unit', interestMode: detail.interest_mode, ...(refs.has('interestParty:0:0') ? { interestParty: reference('interestParty') } : {}), ...(detail.with_recourse === null ? {} : { withRecourse: detail.with_recourse }), billLines, ...(cashRows.length ? { billCashLines } : {}) } as unknown as VouPayload
      return { ...base, maturityType: detail.maturity_type, billLines, billCashLines } as unknown as VouPayload
    }
    if (entity === 'intermediary-calculation') {
      const intermediaryReference = (field: string, lineNo: number) => {
        const value = reference(field, lineNo)
        return {
          objectId: value.objectId,
          approvalEntryId: value.approvalEntryId!,
          entity: value.entity!,
          code: value.code!,
          name: value.name!,
        }
      }
      const detail = (await sql<Record<string, unknown>>`SELECT * FROM vou_intermediary_calculation_details WHERE approval_entry_id = ${approvalEntryId}`.execute(executor)).rows[0]!
      const sourceLines = await rows<{ line_no: number; source_signoff_line_id: string; source_kind: string; signoff_document_id: string; signoff_document_no: string; signoff_date: string; order_document_id: string; order_document_no: string; order_date: string; due_date: string; collection_date: string; collection_delay_days: number; sales_attribution_type: string; sales_contract_status: string; sales_contract_document_id: string | null; sales_contract_revision: number | null; sales_contract_applicable_from: string | null; sales_contract_applicable_to: string | null; sales_contract_terms: string | null; behavior_profile: string; signed_quantity_micros: string; pricing_quantity_micros: string; standard_piece_quantity_micros: string; unit_price_minor: string; reference_unit_price_minor: string; settlement_surcharge_minor: string; line_amount_minor: string; settlement_term_code: string; special_approval: boolean; return_document_nos: string[]; adjustment_employee_amount_minor: string; adjustment_intermediary_amount_minor: string }>('vou_intermediary_source_line_snapshots')
      const bills = await rows<{ line_no: number; bill_line_id: string; receipt_document_id: string; receipt_document_no: string; receipt_date: string; bill_type: string; face_amount_minor: string; issue_date: string; maturity_date: string; cost_days: number }>('vou_intermediary_bill_snapshots')
      const resultLines = await rows<{ source_signoff_line_id: string; premium_unit_price_minor: string; standard_piece_quantity_micros: string; base_commission_minor: string; premium_commission_minor: string; low_price_commission_minor: string; market_maintenance_subsidy_minor: string; market_development_subsidy_minor: string; bill_cost_minor: string; bill_line_ids: string[]; employee_amount_minor: string; intermediary_amount_minor: string; note: string | null }>('vou_intermediary_result_line_snapshots')
      const summaries = await rows<{ line_no: number; category: string; amount_minor: string }>('vou_intermediary_summary_snapshots')
      return {
        ...base,
        intermediaryCalculation: {
          source: {
            periodStart: detail.period_start as string,
            periodEnd: detail.period_end as string,
            currency: header.currency,
            lines: sourceLines.map((line) => ({
              sourceSignoffLineId: line.source_signoff_line_id, sourceKind: line.source_kind,
              signoffDocumentId: line.signoff_document_id, signoffDocumentNo: line.signoff_document_no, signoffDate: line.signoff_date,
              orderDocumentId: line.order_document_id, orderDocumentNo: line.order_document_no, orderDate: line.order_date,
              dueDate: line.due_date, collectionDate: line.collection_date, collectionDelayDays: line.collection_delay_days,
              customer: intermediaryReference('intermediary.customer', line.line_no), salesperson: intermediaryReference('intermediary.salesperson', line.line_no),
              salesAttributionType: line.sales_attribution_type, salesContractStatus: line.sales_contract_status,
              ...(line.sales_contract_document_id ? { salesContract: { documentId: line.sales_contract_document_id, revision: line.sales_contract_revision!, applicableFrom: line.sales_contract_applicable_from!, ...(line.sales_contract_applicable_to ? { applicableTo: line.sales_contract_applicable_to } : {}), terms: line.sales_contract_terms ?? '' } } : {}),
              ...(refs.has(`intermediary.intermediary:${line.line_no}:0`) ? { intermediary: intermediaryReference('intermediary.intermediary', line.line_no) } : {}),
              product: intermediaryReference('intermediary.product', line.line_no), behaviorProfile: line.behavior_profile,
              signedBaseQuantity: fixed(line.signed_quantity_micros, 6), pricingQuantity: fixed(line.pricing_quantity_micros, 6), standardPieceQuantity: fixed(line.standard_piece_quantity_micros, 6),
              unitPrice: fixed(line.unit_price_minor, 2), referenceUnitPrice: fixed(line.reference_unit_price_minor, 2), settlementSurcharge: fixed(line.settlement_surcharge_minor, 2), lineAmount: fixed(line.line_amount_minor, 2), settlementTermCode: line.settlement_term_code, specialApproval: line.special_approval,
              ...(line.return_document_nos.length ? { returnDocumentNos: line.return_document_nos } : {}), adjustmentEmployeeAmount: fixed(line.adjustment_employee_amount_minor, 2), adjustmentIntermediaryAmount: fixed(line.adjustment_intermediary_amount_minor, 2),
            })),
            bills: bills.map((line) => ({ billLineId: line.bill_line_id, receiptDocumentId: line.receipt_document_id, receiptDocumentNo: line.receipt_document_no, receiptDate: line.receipt_date, customer: intermediaryReference('intermediary.bill.customer', line.line_no), billType: line.bill_type, faceAmount: fixed(line.face_amount_minor, 2), issueDate: line.issue_date, maturityDate: line.maturity_date, costDays: line.cost_days })),
          },
          sourceHash: detail.source_hash,
          script: { scriptId: detail.script_id, revision: detail.script_revision, name: detail.script_name, source: detail.script_source, hash: detail.script_hash },
          result: {
            lines: resultLines.map((line) => ({ sourceSignoffLineId: line.source_signoff_line_id, premiumUnitPrice: fixed(line.premium_unit_price_minor, 2), standardPieceQuantity: fixed(line.standard_piece_quantity_micros, 6), baseCommission: fixed(line.base_commission_minor, 2), premiumCommission: fixed(line.premium_commission_minor, 2), lowPriceCommission: fixed(line.low_price_commission_minor, 2), marketMaintenanceSubsidy: fixed(line.market_maintenance_subsidy_minor, 2), marketDevelopmentSubsidy: fixed(line.market_development_subsidy_minor, 2), billCost: fixed(line.bill_cost_minor, 2), billLineIds: line.bill_line_ids, employeeAmount: fixed(line.employee_amount_minor, 2), intermediaryAmount: fixed(line.intermediary_amount_minor, 2), ...(line.note ? { note: line.note } : {}) })),
            summaries: summaries.map((line) => ({ payee: intermediaryReference('intermediary.summary.payee', line.line_no), category: line.category, amount: fixed(line.amount_minor, 2) })),
          },
        },
      } as unknown as VouPayload
    }
    const amountEntities = new Set<VouEntity>(['sales-receipt', 'purchase-refund', 'other-receipt', 'sales-refund', 'purchase-payment', 'other-payment', 'employee-loan', 'employee-repayment', 'expense-payment', 'other-income'])
    if (amountEntities.has(entity)) {
      const entityRef = entity === 'sales-receipt' || entity === 'sales-refund' ? 'customer' : entity === 'purchase-refund' || entity === 'purchase-payment' ? 'supplier' : entity === 'employee-loan' || entity === 'employee-repayment' || entity === 'expense-payment' ? 'employee' : 'counterparty'
      const detail = (await sql<Record<string, unknown>>`SELECT * FROM ${sql.raw(vouEntityDetailTables[entity])} WHERE approval_entry_id = ${approvalEntryId}`.execute(executor)).rows[0]!
      const amountCommon = { ...base, amount: amount(), fundAccount: reference('fundAccount'), handler: reference('handler') }
      const common = entity === 'other-income'
        ? { ...amountCommon, ...(refs.has('counterparty:0:0') ? { counterparty: reference('counterparty') } : {}) }
        : { ...amountCommon, [entityRef]: reference(entityRef) }
      if (entity === 'sales-receipt') {
        const allocations = await rows<{ line_no: number; amount_minor: string }>('vou_amount_allocation_snapshots')
        return { ...common, operatingEntity: reference('operatingEntity'), subunitAllocations: allocations.map((line) => ({ subunit: reference('subunit', line.line_no), amount: fixed(line.amount_minor, 2) })) } as unknown as VouPayload
      }
      if (entity === 'other-receipt' || entity === 'other-payment') return { ...common, counterpartyType: detail.counterparty_type, ...(detail.other_category ? { otherCategory: detail.other_category } : {}) } as unknown as VouPayload
      if (entity === 'other-income') return { ...common, sourceName: detail.source_name, ...(detail.counterparty_type ? { counterpartyType: detail.counterparty_type } : {}) } as unknown as VouPayload
      return common as unknown as VouPayload
    }
    return base as unknown as VouPayload
  }

  private async readReferenceSnapshots(executor: Executor, approvalEntryId: string) {
    const result = await sql<{ field: string; line_no: number; item_no: number; object_id: string; approval_reference_id: string | null; selection_origin: 'CURRENT' | 'HISTORICAL' | null; reference_entity: string | null; reference_code: string | null; reference_name: string | null }>`
      SELECT field, line_no, item_no, object_id, approval_reference_id, selection_origin, reference_entity, reference_code, reference_name
      FROM vou_reference_snapshots WHERE approval_entry_id = ${approvalEntryId}
    `.execute(executor)
    const refs = new Map<string, { objectId: string; approvalEntryId?: string; selectionOrigin?: 'CURRENT' | 'HISTORICAL'; entity?: string; code?: string; name?: string }>()
    for (const row of result.rows)
      refs.set(`${row.field}:${row.line_no}:${row.item_no}`, row.approval_reference_id
        ? { objectId: row.object_id, approvalEntryId: row.approval_reference_id, selectionOrigin: row.selection_origin!, ...(row.reference_entity ? { entity: row.reference_entity } : {}), ...(row.reference_code ? { code: row.reference_code } : {}), ...(row.reference_name ? { name: row.reference_name } : {}) }
        : { objectId: row.object_id })
    return refs
  }

  private async readAttachments(executor: Executor, approvalEntryId: string) {
    const result = await sql<{ file_id: string; staging_id: string; file_name: string; mime_type: 'application/pdf' | 'image/jpeg' | 'image/png'; size_bytes: number; digest: string }>`
      SELECT file_id, staging_id, file_name, mime_type, size_bytes, digest
      FROM vou_attachments WHERE approval_entry_id = ${approvalEntryId} ORDER BY file_id
    `.execute(executor)
    return result.rows.map((row) => ({ id: row.file_id, stagingId: row.staging_id, fileName: row.file_name, contentType: row.mime_type, sizeBytes: row.size_bytes, sha256: row.digest }))
  }

  private async promoteAttachments(
    executor: Executor,
    entryId: string,
    payload: VouPayload,
    ownerId: string,
    now: Date,
  ) {
    for (const attachment of payload.attachments) {
      const row = await executor
        .selectFrom('vou_attachment_staging')
        .selectAll()
        .where('id', '=', attachment.stagingId)
        .where('owner_user_id', '=', ownerId)
        .executeTakeFirstOrThrow()
      await sql`
        INSERT INTO vou_attachments (
          approval_entry_id, file_id, staging_id, file_name, mime_type,
          size_bytes, digest, content, created_at
        ) VALUES (
          ${entryId}, ${row.file_id}, ${row.id}, ${row.file_name}, ${row.mime_type},
          ${row.size_bytes}, ${row.digest}, ${row.content}, ${now}
        )
      `.execute(executor)
      await executor
        .deleteFrom('vou_attachment_staging')
        .where('id', '=', row.id)
        .execute()
    }
  }

  private async downstreamBlockers(executor: Executor, documentId: string) {
    const rows = await Promise.all(
      Object.entries(vouEntityDetailTables).map(async ([entity, table]) => {
        const result = await sql<{ document_id: string }>`
          SELECT detail.document_id
          FROM ${sql.raw(table)} AS detail
          INNER JOIN approval_entries AS entry ON entry.id = detail.approval_entry_id
          WHERE detail.parent_document_id = ${documentId} AND entry.status = 'APPROVED'
        `.execute(executor)
        return result.rows.map((row) => ({ entity, ...row }))
      }),
    )
    return rows.flat().map((row) => ({
      kind: 'DOWNSTREAM_DOCUMENT' as const,
      id: row.document_id,
    }))
  }
}
