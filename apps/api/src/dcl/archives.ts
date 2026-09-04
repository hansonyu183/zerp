import { createHash } from 'node:crypto'

import {
  availableApprovalActions,
  decideApproval,
  prepareAccMappingSubmit,
  prepareCustomerSubmit,
  prepareEmployeeSubmit,
  prepareFundAccountSubmit,
  prepareOperatingEntitySubmit,
  prepareOtherUnitSubmit,
  prepareProductSubmit,
  prepareRptDefinitionSubmit,
  prepareSalesPartnerSubmit,
  prepareSupplierSubmit,
  prepareVehicleSubmit,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
  type ProductReferenceFact,
  type ReferenceBlocker,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { ArchiveEntity } from './archive-contract.ts'
import type { DB, JsonValue } from '../db/generated.ts'

type Executor = Kysely<DB> | Transaction<DB>
export type ArchiveSnapshot = Record<string, unknown>

type ApprovedArchiveFact = {
  objectId: string
  latestApprovedEntryId: string
  enabled: boolean
  code: string
  name: string
}

type AuxiliaryFact = {
  field: ProductReferenceFact['field'] | 'vehicleType' | 'settlementMethod'
  objectId: string
  available: boolean
  code: string
  name: string
  data: Record<string, unknown>
}

const auxiliaryEntities: Record<AuxiliaryFact['field'], string> = {
  vehicleType: 'dictionary-item',
  productType: 'product-type',
  productCategory: 'product-category',
  pricingUnit: 'measurement-unit',
  defaultInputUnit: 'measurement-unit',
  employeeCategory: 'employee-category',
  department: 'department',
  position: 'position',
  settlementMethod: 'settlement-method',
}

type ReferenceBlockerRow = {
  entity: ArchiveEntity
  subject_id: string
  id: string
  field: string
}

type ArchiveSubjectFacts = {
  exists: boolean
  history: Array<{
    entryId: string
    versionNo: number
    status: ApprovalStatus
    revision: string
  }>
}

type PreparedArchiveResult =
  | {
      ok: true
      plan: { createSubject: boolean; versionNo: number; data: ArchiveSnapshot }
    }
  | {
      ok: false
      error: { errorKey: string; blockers?: ReferenceBlocker[] }
    }

type IdentitySetRow = {
  kind: string
  legal_name: string
  display_name: string
  legal_identifier: string | null
  contact_name: string | null
  contact_phone: string | null
  address: string | null
  default_operating_entity_id: string | null
  default_purchaser_employee_id: string | null
  default_purchaser_approval_entry_id: string | null
  default_purchaser_code: string | null
  default_purchaser_name: string | null
  remark: string | null
  enabled: boolean
  settlement_method_snapshot: JsonValue | null
  default_purchaser_snapshot: JsonValue | null
  capabilities: JsonValue | null
}

type OperatingEntityReferenceRow = {
  operating_entity_id: string
  operating_entity_approval_entry_id: string
  operating_entity_code: string
  operating_entity_name: string
}

export interface ArchiveSubmitInput {
  subjectId: string
  submissionId: string
  idempotencyKey: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
  snapshot: ArchiveSnapshot
}

export interface ArchiveReviewInput {
  subjectId: string
  submissionId: string
  expectedRevision: string
  reason?: string
}

export interface ArchiveSubmissionView {
  entity: ArchiveEntity
  subjectId: string
  code: string | null
  submissionId: string
  versionNo: number
  status: ApprovalStatus
  revision: string
  submittedBy: string
  submittedAt: string
  approvedBy: string | null
  approvedAt: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  rejectionReason: string | null
  snapshot: ArchiveSnapshot
  availableApprovalActions: ReturnType<typeof availableApprovalActions>
  canDelete: boolean
  validity?: {
    status: 'VALID' | 'INVALID'
    diagnostic: string | null
    validatedAt: string
    validatedBy: string
  } | null
}

/** Query responses deliberately omit the immutable detail snapshot. */
export type ArchiveSubmissionListItem = Omit<ArchiveSubmissionView, 'snapshot'>

export interface ArchiveQueryInput {
  page: number
  pageSize: 20
  filters: {
    keyword?: string
    status?: ApprovalStatus
    enabled?: boolean
    productTypeId?: string
    productCategoryId?: string
    bookId?: string
    vouEntity?: string
  }
}

export interface ArchiveQueryView {
  entity: ArchiveEntity
  subjectId: string
  code: string | null
  latestApproved: ArchiveSubmissionListItem | null
  openCandidate: ArchiveSubmissionListItem | null
}

type ArchiveQueryDetails = Omit<
  ArchiveQueryView,
  'latestApproved' | 'openCandidate'
> & {
  latestApproved: ArchiveSubmissionView | null
  openCandidate: ArchiveSubmissionView | null
}

export type ArchiveBlocker =
  | {
      kind: 'SUBMISSION_REFERENCE'
      field: string
      objectId: string
      expectedApprovalEntryId: string
      currentApprovalEntryId?: string
    }
  | {
      kind: 'DCL_APPROVAL_REFERENCE'
      entity: ArchiveEntity
      subjectId: string
      submissionId: string
      field: string
      approvalEntryId: string
    }
  | {
      kind: 'ACC_MAPPING_REFERENCE'
      mappingApprovalEntryId: string
      documentType: string
      documentId: string
    }

export interface ArchiveAuditView {
  id: string
  submissionId: string
  versionNo: number
  action:
    | 'SUBMITTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'UNREJECTED'
    | 'UNAPPROVED'
    | 'DELETED'
  fromStatus: ApprovalStatus | null
  toStatus: ApprovalStatus | null
  fromRevision: string | null
  toRevision: string | null
  actorId: string
  reason: string | null
  createdAt: string
}

export interface CustomerAttachmentStageInput {
  stagingId: string
  fileId: string
  fileName: string
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
  size: number
  digest: string
  contentBase64: string
}

export interface CustomerAttachmentStageView {
  stagingId: string
  fileId: string
  fileName: string
  mimeType: string
  size: number
  digest: string
  expiresAt: string
}

export class ArchiveApplicationError extends Error {
  readonly errorKey: string
  readonly data: { blockers: ArchiveBlocker[] } | null

  constructor(errorKey: string, blockers: ArchiveBlocker[] = []) {
    super(errorKey)
    this.name = 'ArchiveApplicationError'
    this.errorKey = errorKey
    this.data = blockers.length === 0 ? null : { blockers }
  }
}

function submissionReferenceBlocker(blocker: ReferenceBlocker): ArchiveBlocker {
  return {
    kind: 'SUBMISSION_REFERENCE',
    field: blocker.field,
    objectId: blocker.objectId,
    expectedApprovalEntryId: blocker.expectedApprovalEntryId,
    ...(blocker.currentApprovalEntryId
      ? { currentApprovalEntryId: blocker.currentApprovalEntryId }
      : {}),
  }
}

function includesKeyword(
  keyword: string,
  values: Array<string | null>,
): boolean {
  const normalized = keyword.trim().toLocaleLowerCase()
  return values.some((value) =>
    (value ?? '').toLocaleLowerCase().includes(normalized),
  )
}

function matchesArchiveQuery(
  entity: ArchiveEntity,
  summary: ArchiveQueryDetails,
  filters: ArchiveQueryInput['filters'],
): boolean {
  const candidates = [summary.latestApproved, summary.openCandidate].filter(
    (candidate): candidate is ArchiveSubmissionView =>
      candidate !== null &&
      (!filters.status || candidate.status === filters.status),
  )
  if (candidates.length === 0) return false
  return candidates.some((candidate) =>
    matchesArchiveSnapshot(entity, summary.code, candidate.snapshot, filters),
  )
}

function archiveSubmissionListItem(
  submission: ArchiveSubmissionView,
): ArchiveSubmissionListItem {
  const { snapshot: _snapshot, ...item } = submission
  return item
}

function matchesArchiveSnapshot(
  entity: ArchiveEntity,
  code: string | null,
  snapshot: ArchiveSnapshot,
  filters: ArchiveQueryInput['filters'],
): boolean {
  if (
    filters.enabled !== undefined &&
    Boolean(record(snapshot).enabled) !== filters.enabled
  )
    return false
  if (filters.keyword) {
    const data = record(snapshot)
    const keywordMatches =
      entity === 'operating-entity'
        ? includesKeyword(filters.keyword, [
            code,
            nullable(data.legalName),
            nullable(data.legalIdentifier),
          ])
        : entity === 'vehicle'
          ? includesKeyword(filters.keyword, [
              code,
              nullable(data.name),
              nullable(data.plateNumber),
              nullable(data.vin),
            ])
          : entity === 'fund-account'
            ? includesKeyword(filters.keyword, [
                code,
                nullable(data.name),
                nullable(data.accountName),
                nullable(data.accountNumber),
              ])
            : entity === 'product'
              ? includesKeyword(filters.keyword, [
                  code,
                  nullable(data.name),
                  nullable(data.barcode),
                  nullable(data.specification),
                  nullable(data.model),
                ])
              : entity === 'employee'
                ? includesKeyword(filters.keyword, [
                    code,
                    nullable(data.legalName),
                    nullable(data.displayName),
                    nullable(data.legalIdentifier),
                  ])
                : entity === 'supplier' ||
                    entity === 'customer' ||
                    entity === 'other-unit' ||
                    entity === 'sales-partner'
                  ? includesKeyword(filters.keyword, [
                      code,
                      nullable(data.legalName),
                      nullable(data.displayName),
                      nullable(data.legalIdentifier),
                    ])
                  : entity === 'acc-mapping'
                    ? includesKeyword(filters.keyword, [
                        nullable(record(data.book).code),
                        nullable(record(data.book).name),
                        nullable(record(data.vouEntity).code),
                        nullable(record(data.vouEntity).name),
                      ])
                    : includesKeyword(filters.keyword, [
                        code,
                        nullable(data.name),
                        nullable(data.description),
                      ])
    if (!keywordMatches) return false
  }
  if (entity === 'product') {
    const data = record(snapshot)
    if (
      filters.productTypeId &&
      nullable(record(data.productType).id) !== filters.productTypeId
    )
      return false
    if (
      filters.productCategoryId &&
      nullable(record(data.productCategory).id) !== filters.productCategoryId
    )
      return false
  }
  if (entity === 'acc-mapping') {
    const data = record(snapshot)
    if (filters.bookId && nullable(record(data.book).id) !== filters.bookId)
      return false
    if (
      filters.vouEntity &&
      nullable(record(data.vouEntity).code) !== filters.vouEntity
    )
      return false
  }
  return true
}

const entityCodes: Record<ArchiveEntity, string> = {
  'operating-entity': 'OPE',
  vehicle: 'VEH',
  'fund-account': 'FAC',
  product: 'PRD',
  employee: 'EMP',
  supplier: 'SUP',
  customer: 'CUS',
  'other-unit': 'OTU',
  'sales-partner': 'SLP',
  'acc-mapping': '',
  'rpt-definition': 'rpt',
}

function requirePermission(actor: ApprovalActor, path: string): void {
  if (actor.trusted !== true && !actor.permissions.includes(path))
    throw new ArchiveApplicationError('forbidden')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function nullable(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function json(value: unknown): JsonValue {
  return JSON.stringify(value) as unknown as JsonValue
}
function pgCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string'
    ? error.code
    : undefined
}

function requestHash(
  action: string,
  entity: ArchiveEntity,
  input: ArchiveSubmitInput,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ action, entity, ...input }))
    .digest('hex')
}

/** DCL archive persistence. Entity payloads are deliberately explicit below. */
export class ArchiveService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async query(
    entity: ArchiveEntity,
    input: ArchiveQueryInput,
    actor: ApprovalActor,
  ): Promise<{ items: ArchiveQueryView[]; total: number }> {
    requirePermission(actor, `/dcl/${entity}/query`)
    const rows = await this.db
      .selectFrom('approval_entries as e')
      .innerJoin('dcl_subjects as s', 's.id', 'e.subject_id')
      .select(['e.id', 'e.subject_id', 'e.version_no', 'e.status', 's.code'])
      .where('e.domain', '=', 'dcl')
      .where('e.entity', '=', entity)
      .orderBy('s.code', 'asc')
      .orderBy('s.id', 'asc')
      .orderBy('e.version_no', 'desc')
      .execute()
    const subjectEntries = new Map<
      string,
      {
        code: string | null
        latestApprovedId: string | null
        openCandidateId: string | null
      }
    >()
    for (const row of rows) {
      const subject = subjectEntries.get(row.subject_id) ?? {
        code: row.code,
        latestApprovedId: null,
        openCandidateId: null,
      }
      if (row.status === 'APPROVED' && subject.latestApprovedId === null)
        subject.latestApprovedId = row.id
      if (
        (row.status === 'PENDING' || row.status === 'REJECTED') &&
        subject.openCandidateId === null
      )
        subject.openCandidateId = row.id
      subjectEntries.set(row.subject_id, subject)
    }
    const summaries = await Promise.all(
      [...subjectEntries.entries()].map(async ([subjectId, subject]) => {
        const [latestApproved, openCandidate] = await Promise.all([
          subject.latestApprovedId
            ? this.readSubmission(
                this.db,
                entity,
                subject.latestApprovedId,
                actor,
              )
            : null,
          subject.openCandidateId
            ? this.readSubmission(
                this.db,
                entity,
                subject.openCandidateId,
                actor,
              )
            : null,
        ])
        return {
          entity,
          subjectId,
          code: subject.code,
          latestApproved,
          openCandidate,
        } satisfies ArchiveQueryDetails
      }),
    )
    const filtered = summaries.filter((summary) =>
      matchesArchiveQuery(entity, summary, input.filters),
    )
    const offset = (input.page - 1) * input.pageSize
    return {
      items: filtered.slice(offset, offset + input.pageSize).map((summary) => ({
        entity: summary.entity,
        subjectId: summary.subjectId,
        code: summary.code,
        latestApproved: summary.latestApproved
          ? archiveSubmissionListItem(summary.latestApproved)
          : null,
        openCandidate: summary.openCandidate
          ? archiveSubmissionListItem(summary.openCandidate)
          : null,
      })),
      total: filtered.length,
    }
  }

  async get(
    entity: ArchiveEntity,
    subjectId: string,
    actor: ApprovalActor,
    approvalEntryId?: string,
  ): Promise<ArchiveSubmissionView> {
    requirePermission(actor, `/dcl/${entity}/get`)
    let query = this.db
      .selectFrom('approval_entries')
      .select('id')
      .where('domain', '=', 'dcl')
      .where('entity', '=', entity)
      .where('subject_id', '=', subjectId)
    if (entity === 'rpt-definition' && approvalEntryId)
      query = query.where('id', '=', approvalEntryId)
    else query = query.orderBy('version_no', 'desc')
    const row = await query.executeTakeFirst()
    if (!row) throw new ArchiveApplicationError('approval_not_found')
    return this.readSubmission(this.db, entity, row.id, actor)
  }

  async versions(
    entity: ArchiveEntity,
    subjectId: string,
    actor: ApprovalActor,
  ): Promise<ArchiveSubmissionView[]> {
    requirePermission(actor, `/dcl/${entity}/versions`)
    const rows = await this.db
      .selectFrom('approval_entries')
      .select('id')
      .where('domain', '=', 'dcl')
      .where('entity', '=', entity)
      .where('subject_id', '=', subjectId)
      .orderBy('version_no', 'desc')
      .execute()
    const items = await Promise.all(
      rows.map((row) => this.readSubmission(this.db, entity, row.id, actor)),
    )
    return items
  }

  async auditHistory(
    entity: ArchiveEntity,
    subjectId: string,
    actor: ApprovalActor,
  ): Promise<ArchiveAuditView[]> {
    requirePermission(actor, `/dcl/${entity}/audit-history`)
    const rows = await this.db
      .selectFrom('approval_events')
      .selectAll()
      .where('domain', '=', 'dcl')
      .where('entity', '=', entity)
      .where('subject_id', '=', subjectId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute()
    return rows.map((row) => ({
      id: row.id,
      submissionId: row.entry_id,
      versionNo: row.version_no,
      action: row.action as ArchiveAuditView['action'],
      fromStatus: row.from_status as ApprovalStatus | null,
      toStatus: row.to_status as ApprovalStatus | null,
      fromRevision:
        row.from_revision === null ? null : String(row.from_revision),
      toRevision: row.to_revision === null ? null : String(row.to_revision),
      actorId: row.actor_id,
      reason: row.reason,
      createdAt: row.created_at.toISOString(),
    }))
  }

  async submit(
    entity: ArchiveEntity,
    action: 'submit-new' | 'submit-change',
    input: ArchiveSubmitInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<ArchiveSubmissionView> {
    requirePermission(actor, `/dcl/${entity}/${action}`)
    const idempotencyKey = input.idempotencyKey.trim()
    const hash = requestHash(action, entity, input)
    try {
      return await this.db.transaction().execute(async (tx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dcl:archive:${entity}:idempotency:${idempotencyKey}`}, 0))`.execute(
          tx,
        )
        const prior = await tx
          .selectFrom('dcl_archive_idempotency')
          .select(['request_hash', 'response'])
          .where('entity', '=', entity)
          .where('idempotency_key', '=', idempotencyKey)
          .executeTakeFirst()
        if (prior) {
          if (prior.request_hash !== hash)
            throw new ArchiveApplicationError('archive_idempotency_conflict')
          return prior.response as unknown as ArchiveSubmissionView
        }
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dcl:archive:${entity}:${input.subjectId}`}, 0))`.execute(
          tx,
        )
        const subject = await tx
          .selectFrom('dcl_subjects')
          .select('id')
          .where('id', '=', input.subjectId)
          .where('entity', '=', entity)
          .executeTakeFirst()
        const history = await tx
          .selectFrom('approval_entries')
          .select(['id', 'version_no', 'status', 'revision'])
          .where('domain', '=', 'dcl')
          .where('entity', '=', entity)
          .where('subject_id', '=', input.subjectId)
          .orderBy('version_no', 'asc')
          .forUpdate()
          .execute()
        const occurredAt = new Date()
        const prepared = await this.prepare(
          entity,
          action,
          input,
          actor,
          requestId,
          occurredAt.toISOString(),
          subject !== undefined,
          history,
          tx,
        )
        if (!prepared.ok)
          throw new ArchiveApplicationError(
            prepared.errorKey,
            prepared.blockers,
          )
        const plan = prepared.plan
        plan.data = await this.freezeAuthoritativeReferences(
          tx,
          entity,
          plan.data,
        )
        await this.ensureNoDuplicateBusinessKey(
          tx,
          entity,
          input.subjectId.trim(),
          plan.data,
        )
        let code: string | null
        if (plan.createSubject) {
          if (entity === 'acc-mapping') code = null
          else {
            const counter = await tx
              .updateTable('dcl_code_counters')
              .set((eb) => ({ next_value: eb('next_value', '+', 1) }))
              .where('entity', '=', entity)
              .returning('next_value')
              .executeTakeFirstOrThrow()
            const digits = entity === 'rpt-definition' ? 6 : 4
            code = `${entityCodes[entity]}-${String(counter.next_value - 1).padStart(digits, '0')}`
          }
          await tx
            .insertInto('dcl_subjects')
            .values({
              id: input.subjectId.trim(),
              entity,
              code,
              created_at: occurredAt,
              created_by: actor.id,
            })
            .execute()
        } else {
          const current = await tx
            .selectFrom('dcl_subjects')
            .select('code')
            .where('id', '=', input.subjectId)
            .executeTakeFirstOrThrow()
          code = current.code
        }
        if (entity === 'customer')
          plan.data = await this.assignCustomerSubunitCodes(
            tx,
            input.subjectId.trim(),
            plan.data,
          )
        if (entity === 'customer' && action === 'submit-new')
          requirePermission(actor, '/dcl/customer/save-subunits')
        if (entity === 'customer' && action === 'submit-change') {
          const latest = [...history]
            .filter((item) => item.status === 'APPROVED')
            .at(-1)
          if (
            latest &&
            JSON.stringify(
              array((await this.readSnapshot(tx, entity, latest.id)).subunits),
            ) !== JSON.stringify(array(plan.data.subunits))
          )
            requirePermission(actor, '/dcl/customer/save-subunits')
        }
        await tx
          .insertInto('approval_entries')
          .values({
            id: input.submissionId.trim(),
            domain: 'dcl',
            entity,
            subject_id: input.subjectId.trim(),
            version_no: plan.versionNo,
            status: 'PENDING',
            revision: '1',
            submitted_by: actor.id,
            submitted_at: occurredAt,
            approved_by: null,
            approved_at: null,
            rejected_by: null,
            rejected_at: null,
            rejection_reason: null,
            updated_by: actor.id,
            updated_at: occurredAt,
          })
          .execute()
        await this.writeSnapshot(
          tx,
          entity,
          input.submissionId.trim(),
          plan.data,
        )
        if (entity === 'rpt-definition')
          await this.validateReport(tx, input.submissionId.trim(), actor.id)
        if (entity === 'customer')
          await this.promoteCustomerAttachments(
            tx,
            input.submissionId.trim(),
            input.snapshot,
            actor.id,
          )
        await tx
          .insertInto('approval_events')
          .values({
            id: ulid(),
            entry_id: input.submissionId.trim(),
            domain: 'dcl',
            entity,
            subject_id: input.subjectId.trim(),
            version_no: plan.versionNo,
            action: 'SUBMITTED',
            from_status: null,
            to_status: 'PENDING',
            from_revision: null,
            to_revision: '1',
            actor_id: actor.id,
            reason: null,
            request_id: requestId,
            created_at: occurredAt,
          })
          .execute()
        const view = await this.readSubmission(
          tx,
          entity,
          input.submissionId.trim(),
          actor,
        )
        await tx
          .insertInto('dcl_archive_idempotency')
          .values({
            entity,
            idempotency_key: idempotencyKey,
            request_hash: hash,
            subject_id: input.subjectId.trim(),
            submission_id: input.submissionId.trim(),
            response: json(view),
            created_at: occurredAt,
          })
          .execute()
        return view
      })
    } catch (error) {
      if (error instanceof ArchiveApplicationError) throw error
      if (pgCode(error) === '23505')
        throw new ArchiveApplicationError('archive_conflict')
      throw error
    }
  }

  async review(
    entity: ArchiveEntity,
    action: ApprovalAction,
    input: ArchiveReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<ArchiveSubmissionView> {
    requirePermission(actor, `/dcl/${entity}/${action}`)
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dcl:archive:${entity}:${input.subjectId}`}, 0))`.execute(
        tx,
      )
      const entry = await this.loadEntry(
        tx,
        entity,
        input.submissionId,
        input.subjectId,
        true,
      )
      if (action === 'unapprove')
        await this.ensureUnapproveAllowed(tx, entity, entry)
      if (action === 'approve')
        await this.revalidateApprovalSnapshot(
          tx,
          entity,
          entry,
          actor,
          requestId,
        )
      if (action === 'approve' && entity === 'rpt-definition')
        await this.validateReport(tx, input.submissionId, actor.id)
      const occurredAt = new Date()
      const decision = decideApproval({
        action,
        entry,
        actor,
        expectedRevision: input.expectedRevision,
        occurredAt: occurredAt.toISOString(),
        requestId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })
      if (!decision.ok)
        throw new ArchiveApplicationError(decision.error.errorKey)
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
          updated_by: actor.id,
          updated_at: occurredAt,
        })
        .where('id', '=', entry.id)
        .where('revision', '=', plan.fromRevision)
        .executeTakeFirst()
      if (Number(updated.numUpdatedRows) !== 1)
        throw new ArchiveApplicationError('approval_stale_revision')
      await tx
        .insertInto('approval_events')
        .values({
          id: ulid(),
          entry_id: entry.id,
          domain: 'dcl',
          entity,
          subject_id: entry.subjectId,
          version_no: entry.versionNo ?? 1,
          action: plan.event.action,
          from_status: plan.fromStatus,
          to_status: plan.toStatus,
          from_revision: plan.fromRevision,
          to_revision: plan.toRevision,
          actor_id: actor.id,
          reason: plan.reason ?? null,
          request_id: requestId,
          created_at: occurredAt,
        })
        .execute()
      if (entity === 'acc-mapping') {
        if (plan.toStatus === 'APPROVED')
          await this.syncAccMappingSubjectUsages(tx, entry.id)
        else if (plan.fromStatus === 'APPROVED')
          await sql`DELETE FROM dcl_acc_mapping_subject_usages
            WHERE approval_entry_id = ${entry.id}`.execute(tx)
      }
      return this.readSubmission(tx, entity, entry.id, actor)
    })
  }

  async delete(
    entity: ArchiveEntity,
    input: Omit<ArchiveReviewInput, 'reason'>,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<{ submissionId: string; deleted: true }> {
    requirePermission(actor, `/dcl/${entity}/delete`)
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dcl:archive:${entity}:${input.subjectId}`}, 0))`.execute(
        tx,
      )
      const entry = await this.loadEntry(
        tx,
        entity,
        input.submissionId,
        input.subjectId,
        true,
      )
      if (entry.revision !== input.expectedRevision)
        throw new ArchiveApplicationError('approval_stale_revision')
      if (!['PENDING', 'REJECTED'].includes(entry.status))
        throw new ArchiveApplicationError('approval_invalid_transition')
      if (entry.metadata.submitted.actorId !== actor.id)
        throw new ArchiveApplicationError('approval_invalid_actor')
      await tx
        .insertInto('approval_events')
        .values({
          id: ulid(),
          entry_id: entry.id,
          domain: 'dcl',
          entity,
          subject_id: entry.subjectId,
          version_no: entry.versionNo ?? 1,
          action: 'DELETED',
          from_status: entry.status,
          to_status: null,
          from_revision: entry.revision,
          to_revision: null,
          actor_id: actor.id,
          reason: null,
          request_id: requestId,
          created_at: new Date(),
        })
        .execute()
      const deleted = await tx
        .deleteFrom('approval_entries')
        .where('id', '=', entry.id)
        .where('revision', '=', entry.revision)
        .executeTakeFirst()
      if (Number(deleted.numDeletedRows) !== 1)
        throw new ArchiveApplicationError('approval_stale_revision')
      const remaining = await tx
        .selectFrom('approval_entries')
        .select('id')
        .where('subject_id', '=', entry.subjectId)
        .executeTakeFirst()
      if (!remaining)
        await tx
          .deleteFrom('dcl_subjects')
          .where('id', '=', entry.subjectId)
          .execute()
      return { submissionId: entry.id, deleted: true as const }
    })
  }

  async stageCustomerAttachment(
    input: CustomerAttachmentStageInput,
    actor: ApprovalActor,
  ): Promise<CustomerAttachmentStageView> {
    requirePermission(actor, '/dcl/customer/attachment-stage')
    const content = Buffer.from(input.contentBase64, 'base64')
    const digest = createHash('sha256').update(content).digest('hex')
    if (
      content.length !== input.size ||
      digest !== input.digest ||
      !/^[0-9a-f]{64}$/.test(input.digest)
    )
      throw new ArchiveApplicationError('customer_attachment_invalid_content')
    const now = new Date(),
      expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dcl:customer:attachment:${input.stagingId}`}, 0))`.execute(
        tx,
      )
      const existing = await tx
        .selectFrom('dcl_customer_attachment_staging')
        .selectAll()
        .where('id', '=', input.stagingId)
        .executeTakeFirst()
      if (existing) {
        if (
          existing.owner_user_id !== actor.id ||
          existing.file_id !== input.fileId ||
          existing.file_name !== input.fileName ||
          existing.mime_type !== input.mimeType ||
          existing.digest !== input.digest ||
          existing.size_bytes !== input.size
        )
          throw new ArchiveApplicationError(
            'customer_attachment_staging_conflict',
          )
        if (existing.expires_at <= now)
          await tx
            .updateTable('dcl_customer_attachment_staging')
            .set({
              content,
              created_at: now,
              expires_at: expiresAt,
            })
            .where('id', '=', existing.id)
            .executeTakeFirstOrThrow()
        return {
          stagingId: existing.id,
          fileId: existing.file_id,
          fileName: existing.file_name,
          mimeType: existing.mime_type,
          size: existing.size_bytes,
          digest: existing.digest,
          expiresAt: (existing.expires_at <= now
            ? expiresAt
            : existing.expires_at
          ).toISOString(),
        }
      }
      await tx
        .insertInto('dcl_customer_attachment_staging')
        .values({
          id: input.stagingId,
          file_id: input.fileId,
          owner_user_id: actor.id,
          file_name: input.fileName,
          mime_type: input.mimeType,
          size_bytes: input.size,
          digest: input.digest,
          content,
          created_at: now,
          expires_at: expiresAt,
        })
        .execute()
      return {
        stagingId: input.stagingId,
        fileId: input.fileId,
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.size,
        digest: input.digest,
        expiresAt: expiresAt.toISOString(),
      }
    })
  }

  async cleanupCustomerAttachments(
    actor: ApprovalActor,
  ): Promise<{ deleted: number }> {
    requirePermission(actor, '/dcl/customer/attachment-cleanup')
    const deleted = await this.db
      .deleteFrom('dcl_customer_attachment_staging')
      .where('expires_at', '<=', new Date())
      .executeTakeFirst()
    return { deleted: Number(deleted.numDeletedRows) }
  }

  private async prepare(
    entity: ArchiveEntity,
    action: 'submit-new' | 'submit-change',
    input: ArchiveSubmitInput,
    actor: ApprovalActor,
    requestId: string,
    occurredAt: string,
    exists: boolean,
    history: Array<{
      id: string
      version_no: number
      status: string
      revision: string | number | bigint
    }>,
    tx: Executor,
  ): Promise<
    | {
        ok: true
        plan: {
          createSubject: boolean
          versionNo: number
          data: ArchiveSnapshot
        }
      }
    | { ok: false; errorKey: string; blockers: ArchiveBlocker[] }
  > {
    const command = {
      action,
      actor,
      requestId,
      occurredAt,
      submissionId: input.submissionId,
      idempotencyKey: input.idempotencyKey,
      subjectId: input.subjectId,
      expectedLatestApprovedSubmissionId:
        input.expectedLatestApprovedSubmissionId,
      expectedLatestApprovedRevision:
        input.expectedLatestApprovedRevision?.replace(/^0+(?=\d)/, '') ?? null,
      data: input.snapshot,
    }
    const subject: ArchiveSubjectFacts = {
      exists,
      history: history.map((row) => ({
        entryId: row.id,
        versionNo: row.version_no,
        status: row.status as ApprovalStatus,
        revision: String(row.revision),
      })),
    }
    const result = (await this.prepareByEntity(
      entity,
      command,
      subject,
      tx,
    )) as PreparedArchiveResult
    if (!result.ok)
      return {
        ok: false,
        errorKey: result.error.errorKey,
        blockers: (result.error.blockers ?? []).map(submissionReferenceBlocker),
      }
    return {
      ok: true,
      plan: {
        createSubject: result.plan.createSubject,
        versionNo: result.plan.versionNo,
        data: result.plan.data as ArchiveSnapshot,
      },
    }
  }

  private async revalidateApprovalSnapshot(
    tx: Executor,
    entity: ArchiveEntity,
    entry: ApprovalEntry,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<void> {
    const history = await tx
      .selectFrom('approval_entries')
      .select(['id', 'version_no', 'status', 'revision'])
      .where('domain', '=', 'dcl')
      .where('entity', '=', entity)
      .where('subject_id', '=', entry.subjectId)
      .where('id', '!=', entry.id)
      .orderBy('version_no', 'asc')
      .execute()
    const latestApproved = [...history]
      .filter((row) => row.status === 'APPROVED')
      .at(-1)
    const prepared = await this.prepare(
      entity,
      entry.versionNo === 1 ? 'submit-new' : 'submit-change',
      {
        subjectId: entry.subjectId,
        submissionId: entry.id,
        idempotencyKey: entry.id,
        expectedLatestApprovedSubmissionId: latestApproved?.id ?? null,
        expectedLatestApprovedRevision: latestApproved
          ? String(latestApproved.revision)
          : null,
        snapshot: await this.readSnapshot(tx, entity, entry.id),
      },
      // Approval authorization was checked by review(). Revalidation must reuse
      // the archived submission with current domain facts, without requiring the
      // reviewer to hold the submit permission for that historical action.
      { ...actor, trusted: true },
      requestId,
      new Date().toISOString(),
      entry.versionNo !== 1,
      history,
      tx,
    )
    if (!prepared.ok)
      throw new ArchiveApplicationError(prepared.errorKey, prepared.blockers)
    await this.ensureNoDuplicateBusinessKey(
      tx,
      entity,
      entry.subjectId,
      prepared.plan.data,
    )
  }

  private async prepareByEntity(
    entity: ArchiveEntity,
    command: Record<string, unknown>,
    subject: ArchiveSubjectFacts,
    tx: Executor,
  ): Promise<unknown> {
    const data = record(command.data)
    const base = { ...command, data }
    // The switches make each aggregate's accepted facts visible; no generic reference graph exists here.
    switch (entity) {
      case 'operating-entity':
        return prepareOperatingEntitySubmit(base as never, { subject } as never)
      case 'vehicle': {
        const vehicleType = (
          await this.auxFacts(tx, [
            ['vehicleType', record(data.vehicleType).id],
          ])
        )[0]
        if (!vehicleType?.available)
          return {
            ok: false,
            error: { errorKey: 'vehicle_reference_unavailable' },
          }
        return prepareVehicleSubmit(
          base as never,
          {
            subject,
            ...(data.carrier && record(data.carrier).kind === 'INTERNAL'
              ? {
                  operatingEntity: await this.approvedFact(
                    tx,
                    'operating-entity',
                    String(record(data.carrier).operatingEntityId ?? ''),
                  ),
                }
              : {
                  otherUnit: await this.approvedFact(
                    tx,
                    'other-unit',
                    String(record(data.carrier).otherUnitId ?? ''),
                  ),
                }),
          } as never,
        )
      }
      case 'fund-account':
        return prepareFundAccountSubmit(
          base as never,
          {
            subject,
            operatingEntity: await this.approvedFact(
              tx,
              'operating-entity',
              String(record(data.operatingEntity).objectId ?? ''),
            ),
          } as never,
        )
      case 'product':
        return prepareProductSubmit(
          base as never,
          {
            subject,
            references: await this.productReferenceFacts(tx, [
              ['productType', record(data.productType).id],
              ['productCategory', record(data.productCategory).id],
              ['pricingUnit', record(data.pricingUnit).id],
              ['defaultInputUnit', record(data.defaultInputUnit).id],
            ]),
          } as never,
        )
      case 'employee':
        return prepareEmployeeSubmit(
          base as never,
          {
            subject,
            operatingEntity: await this.approvedFact(
              tx,
              'operating-entity',
              String(record(data.operatingEntity).objectId ?? ''),
            ),
            references: await this.productReferenceFacts(tx, [
              ['employeeCategory', record(data.employeeCategory).id],
              ['department', record(data.department).id],
              ['position', record(data.position).id],
            ]),
          } as never,
        )
      case 'supplier':
        return prepareSupplierSubmit(
          base as never,
          {
            subject,
            operatingEntities: await this.approvedFacts(
              tx,
              'operating-entity',
              array(data.operatingEntities).map((value) =>
                String(record(value).objectId ?? ''),
              ),
            ),
            defaultPurchaser: await this.approvedFact(
              tx,
              'employee',
              String(record(data.defaultPurchaser).objectId ?? ''),
            ),
          } as never,
        )
      case 'customer':
        return prepareCustomerSubmit(
          base as never,
          {
            subject,
            defaultOperatingEntity: await this.approvedFact(
              tx,
              'operating-entity',
              String(record(data.defaultOperatingEntity).objectId ?? ''),
            ),
          } as never,
        )
      case 'other-unit':
        return prepareOtherUnitSubmit(
          base as never,
          {
            subject,
            operatingEntities: await this.approvedFacts(
              tx,
              'operating-entity',
              array(data.operatingEntities).map((value) =>
                String(record(value).objectId ?? ''),
              ),
            ),
          } as never,
        )
      case 'sales-partner':
        return prepareSalesPartnerSubmit(
          base as never,
          {
            subject,
            operatingEntities: await this.approvedFacts(
              tx,
              'operating-entity',
              array(data.operatingEntities).map((value) =>
                String(record(value).objectId ?? ''),
              ),
            ),
          } as never,
        )
      case 'acc-mapping': {
        const vouEntity = await sql<{
          id: string
          enabled: boolean
          field_catalog: JsonValue
        }>`SELECT id, enabled, field_catalog FROM dcl_acc_vou_entity_facts WHERE id = ${String(record(data.vouEntity).id ?? '')}`.execute(
          tx,
        )
        const fieldCatalog = record(vouEntity.rows[0]?.field_catalog)
        const accounts = await sql<{
          id: string
          book_id: string
          enabled: boolean
          leaf: boolean
          required_dimensions: JsonValue
        }>`SELECT id, book_id, enabled, leaf, required_dimensions FROM dcl_acc_subject_facts WHERE book_id = ${String(record(data.book).id ?? '')}`.execute(
          tx,
        )
        return prepareAccMappingSubmit(
          base as never,
          {
            subject,
            book: (await tx
              .selectFrom('dcl_acc_book_facts')
              .select(['id', 'enabled'])
              .where('id', '=', String(record(data.book).id ?? ''))
              .executeTakeFirst()) ?? { id: '', enabled: false },
            vouEntity: vouEntity.rows[0] ?? { id: '', enabled: false },
            fieldCatalog: {
              headerFields: array(fieldCatalog.headerFields).map(String),
              lineFields: array(fieldCatalog.lineFields).map(String),
            },
            accounts: accounts.rows.map((account) => ({
              id: account.id,
              bookId: account.book_id,
              enabled: account.enabled,
              leaf: account.leaf,
              requiredDimensions: array(account.required_dimensions).map(
                String,
              ),
            })),
          } as never,
        )
      }
      case 'rpt-definition':
        return prepareRptDefinitionSubmit(base as never, { subject } as never)
    }
  }

  private async approvedFact(
    tx: Executor,
    entity: ArchiveEntity,
    objectId: string,
  ): Promise<ApprovedArchiveFact | undefined> {
    if (!objectId) return undefined
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dcl:archive:${entity}:${objectId}`}, 0))`.execute(
      tx,
    )
    const row = await tx
      .selectFrom('approval_entries as e')
      .innerJoin('dcl_subjects as s', 's.id', 'e.subject_id')
      .select(['e.id', 's.id as object_id', 's.code'])
      .where('e.domain', '=', 'dcl')
      .where('e.entity', '=', entity)
      .where('e.subject_id', '=', objectId)
      .where('e.status', '=', 'APPROVED')
      .orderBy('e.version_no', 'desc')
      .executeTakeFirst()
    if (!row) return undefined
    const snapshot = await this.readSnapshot(tx, entity, row.id)
    return {
      objectId: row.object_id,
      latestApprovedEntryId: row.id,
      enabled: snapshot.enabled === true,
      code: row.code ?? '',
      name: this.displayName(entity, snapshot),
    }
  }

  private async approvedFacts(
    tx: Executor,
    entity: ArchiveEntity,
    ids: string[],
  ): Promise<ApprovedArchiveFact[]> {
    const facts: ApprovedArchiveFact[] = []
    for (const id of [...new Set(ids)].sort()) {
      const fact = await this.approvedFact(tx, entity, id)
      if (fact) facts.push(fact)
    }
    return facts
  }

  private async ensureNoDuplicateBusinessKey(
    tx: Executor,
    entity: ArchiveEntity,
    subjectId: string,
    data: ArchiveSnapshot,
  ): Promise<void> {
    const failIfDuplicate = async (
      table: string,
      column: string,
      value: unknown,
      errorKey: string,
    ) => {
      if (typeof value !== 'string' || !value.trim()) return
      const normalized = value.trim().toUpperCase()
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dcl:archive:${entity}:business-key:${column}:${normalized}`}, 0))`.execute(
        tx,
      )
      const duplicate = await sql<{
        id: string
      }>`SELECT e.id FROM ${sql.table(table)} AS v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE e.domain = 'dcl' AND e.entity = ${entity} AND e.subject_id <> ${subjectId} AND e.status IN ('PENDING', 'APPROVED', 'REJECTED') AND ${sql.ref(`v.${column}`)} = ${value} LIMIT 1`.execute(
        tx,
      )
      if (duplicate.rows[0]) throw new ArchiveApplicationError(errorKey)
    }
    switch (entity) {
      case 'operating-entity':
        await failIfDuplicate(
          'dcl_operating_entity_versions',
          'legal_identifier',
          data.legalIdentifier,
          'operating_entity_duplicate_legal_identifier',
        )
        return
      case 'vehicle':
        await failIfDuplicate(
          'dcl_vehicle_versions',
          'plate_number',
          data.plateNumber,
          'vehicle_duplicate_plate_number',
        )
        await failIfDuplicate(
          'dcl_vehicle_versions',
          'vin',
          data.vin,
          'vehicle_duplicate_vin',
        )
        return
      case 'fund-account':
        await failIfDuplicate(
          'dcl_fund_account_versions',
          'account_number',
          data.accountNumber,
          'fund_account_duplicate_account_number',
        )
        return
      case 'product':
        await failIfDuplicate(
          'dcl_product_versions',
          'barcode',
          data.barcode,
          'product_duplicate_barcode',
        )
        return
      case 'employee':
        await failIfDuplicate(
          'dcl_employee_versions',
          'legal_identifier',
          data.legalIdentifier,
          'employee_duplicate_legal_identifier',
        )
        return
      case 'supplier':
        await failIfDuplicate(
          'dcl_supplier_versions',
          'legal_identifier',
          data.legalIdentifier,
          'supplier_duplicate_legal_identifier',
        )
        return
      case 'customer':
        await failIfDuplicate(
          'dcl_customer_versions',
          'legal_identifier',
          data.legalIdentifier,
          'customer_duplicate_legal_identifier',
        )
        return
      case 'other-unit':
        await failIfDuplicate(
          'dcl_other_unit_versions',
          'legal_identifier',
          data.legalIdentifier,
          'other_unit_duplicate_legal_identifier',
        )
        return
      case 'sales-partner':
        await failIfDuplicate(
          'dcl_sales_partner_versions',
          'legal_identifier',
          data.legalIdentifier,
          'sales_partner_duplicate_legal_identifier',
        )
        return
      case 'acc-mapping': {
        const bookId = String(record(data.book).id ?? '')
        const vouEntityId = String(record(data.vouEntity).id ?? '')
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dcl:archive:acc-mapping:business-key:${bookId}:${vouEntityId}`}, 0))`.execute(
          tx,
        )
        const row = await tx
          .selectFrom('dcl_acc_mapping_versions as v')
          .innerJoin('approval_entries as e', 'e.id', 'v.approval_entry_id')
          .select('e.id')
          .where('e.domain', '=', 'dcl')
          .where('e.entity', '=', 'acc-mapping')
          .where('e.subject_id', '!=', subjectId)
          .where('e.status', 'in', ['PENDING', 'APPROVED', 'REJECTED'])
          .where('v.book_id', '=', bookId)
          .where('v.vou_entity_id', '=', vouEntityId)
          .executeTakeFirst()
        if (row)
          throw new ArchiveApplicationError(
            'acc_mapping_duplicate_book_vou_entity',
          )
        return
      }
      case 'rpt-definition':
        return
    }
  }

  private async auxFacts(
    tx: Executor,
    references: Array<[AuxiliaryFact['field'], unknown]>,
  ): Promise<AuxiliaryFact[]> {
    const ids = references.map(([, id]) => (typeof id === 'string' ? id : ''))
    const rows =
      ids.length === 0
        ? []
        : await tx
            .selectFrom('aux_objects')
            .select(['id', 'entity', 'enabled', 'code', 'data'])
            .where('id', 'in', ids)
            .execute()
    return references.map(([field, id]) => {
      const row = rows.find((item) => item.id === id)
      const data = record(row?.data)
      return {
        field,
        objectId: typeof id === 'string' ? id : '',
        available:
          row?.enabled === true && row.entity === auxiliaryEntities[field],
        code: row?.code ?? '',
        name: typeof data.name === 'string' ? data.name : '',
        data,
      }
    })
  }

  private async productReferenceFacts(
    tx: Executor,
    references: Array<[ProductReferenceFact['field'], unknown]>,
  ): Promise<ProductReferenceFact[]> {
    return (await this.auxFacts(tx, references)).map((fact) => ({
      field: fact.field as ProductReferenceFact['field'],
      objectId: fact.objectId,
      available: fact.available,
    }))
  }

  private displayName(
    entity: ArchiveEntity,
    snapshot: ArchiveSnapshot,
  ): string {
    const named =
      nullable(snapshot.displayName) ??
      nullable(snapshot.legalName) ??
      nullable(snapshot.name)
    return named ?? entity
  }

  private async freezeApprovedReference(
    tx: Executor,
    entity: ArchiveEntity,
    reference: unknown,
  ): Promise<Record<string, unknown>> {
    const requested = record(reference)
    const fact = await this.approvedFact(
      tx,
      entity,
      String(requested.objectId ?? ''),
    )
    if (!fact || fact.latestApprovedEntryId !== requested.approvalEntryId)
      return requested
    return {
      ...requested,
      objectId: fact.objectId,
      approvalEntryId: fact.latestApprovedEntryId,
      code: fact.code,
      name: fact.name,
    }
  }

  private async freezeAuxiliaryReference(
    tx: Executor,
    field: AuxiliaryFact['field'],
    reference: unknown,
    errorKey: string,
  ): Promise<Record<string, unknown>> {
    const requested = record(reference)
    const fact = (
      await this.auxFacts(tx, [[field, String(requested.id ?? '')]])
    )[0]
    if (!fact || !fact.available) throw new ArchiveApplicationError(errorKey)
    return {
      ...requested,
      id: fact.objectId,
      code: fact.code,
      name: fact.name,
      ...(typeof fact.data.quantityScale === 'number'
        ? { quantityScale: fact.data.quantityScale }
        : {}),
      ...(typeof fact.data.behaviorProfile === 'string'
        ? { behaviorProfile: fact.data.behaviorProfile }
        : {}),
    }
  }

  private async freezeAuthoritativeReferences(
    tx: Executor,
    entity: ArchiveEntity,
    snapshot: ArchiveSnapshot,
  ): Promise<ArchiveSnapshot> {
    switch (entity) {
      case 'vehicle': {
        const carrier = record(snapshot.carrier)
        const reference = await this.freezeApprovedReference(
          tx,
          carrier.kind === 'INTERNAL' ? 'operating-entity' : 'other-unit',
          {
            objectId:
              carrier.kind === 'INTERNAL'
                ? carrier.operatingEntityId
                : carrier.otherUnitId,
            approvalEntryId: carrier.approvalEntryId,
          },
        )
        return {
          ...snapshot,
          vehicleType: await this.freezeAuxiliaryReference(
            tx,
            'vehicleType',
            snapshot.vehicleType,
            'vehicle_reference_unavailable',
          ),
          carrier: {
            ...carrier,
            approvalEntryId: reference.approvalEntryId,
            code: reference.code,
            name: reference.name,
          },
        }
      }
      case 'fund-account':
      case 'employee':
        return {
          ...snapshot,
          operatingEntity: await this.freezeApprovedReference(
            tx,
            'operating-entity',
            snapshot.operatingEntity,
          ),
          ...(entity === 'employee'
            ? {
                employeeCategory: await this.freezeAuxiliaryReference(
                  tx,
                  'employeeCategory',
                  snapshot.employeeCategory,
                  'employee_reference_unavailable',
                ),
                department: await this.freezeAuxiliaryReference(
                  tx,
                  'department',
                  snapshot.department,
                  'employee_reference_unavailable',
                ),
                position: await this.freezeAuxiliaryReference(
                  tx,
                  'position',
                  snapshot.position,
                  'employee_reference_unavailable',
                ),
              }
            : {}),
        }
      case 'product':
        return {
          ...snapshot,
          productType: await this.freezeAuxiliaryReference(
            tx,
            'productType',
            snapshot.productType,
            'product_reference_unavailable',
          ),
          productCategory: await this.freezeAuxiliaryReference(
            tx,
            'productCategory',
            snapshot.productCategory,
            'product_reference_unavailable',
          ),
          pricingUnit: await this.freezeAuxiliaryReference(
            tx,
            'pricingUnit',
            snapshot.pricingUnit,
            'product_reference_unavailable',
          ),
          defaultInputUnit: await this.freezeAuxiliaryReference(
            tx,
            'defaultInputUnit',
            snapshot.defaultInputUnit,
            'product_reference_unavailable',
          ),
        }
      case 'supplier':
      case 'other-unit':
      case 'sales-partner':
        return {
          ...snapshot,
          ...((entity === 'supplier' || entity === 'other-unit') &&
          snapshot.settlementMethod !== null
            ? {
                settlementMethod: await this.freezeAuxiliaryReference(
                  tx,
                  'settlementMethod',
                  snapshot.settlementMethod,
                  `${entity.replace('-', '_')}_invalid_data`,
                ),
              }
            : {}),
          operatingEntities: await Promise.all(
            array(snapshot.operatingEntities).map((reference) =>
              this.freezeApprovedReference(tx, 'operating-entity', reference),
            ),
          ),
          ...(entity === 'supplier'
            ? {
                defaultPurchaser:
                  snapshot.defaultPurchaser === null
                    ? null
                    : await this.freezeApprovedReference(
                        tx,
                        'employee',
                        snapshot.defaultPurchaser,
                      ),
              }
            : {}),
        }
      case 'customer':
        return {
          ...snapshot,
          defaultOperatingEntity:
            snapshot.defaultOperatingEntity === null
              ? null
              : await this.freezeApprovedReference(
                  tx,
                  'operating-entity',
                  snapshot.defaultOperatingEntity,
                ),
          subunits: await Promise.all(
            array(snapshot.subunits).map(async (item) => {
              const subunit = record(item)
              return {
                ...subunit,
                settlementMethod:
                  subunit.settlementMethod === null
                    ? null
                    : await this.freezeAuxiliaryReference(
                        tx,
                        'settlementMethod',
                        subunit.settlementMethod,
                        'customer_invalid_data',
                      ),
                salesAttribution:
                  subunit.salesAttribution === null
                    ? null
                    : await this.freezeApprovedReference(
                        tx,
                        'sales-partner',
                        subunit.salesAttribution,
                      ),
              }
            }),
          ),
        }
      default:
        return snapshot
    }
  }

  private async writeSnapshot(
    tx: Executor,
    entity: ArchiveEntity,
    id: string,
    snapshot: ArchiveSnapshot,
  ): Promise<void> {
    const d = snapshot
    switch (entity) {
      case 'operating-entity':
        await tx
          .insertInto('dcl_operating_entity_versions')
          .values({
            approval_entry_id: id,
            legal_name: String(d.legalName ?? ''),
            legal_identifier: nullable(d.legalIdentifier),
            registered_address: String(d.registeredAddress ?? ''),
            contact_name: String(d.contactName ?? ''),
            contact_phone: String(d.contactPhone ?? ''),
            invoice_title: String(d.invoiceTitle ?? ''),
            invoice_address: String(d.invoiceAddress ?? ''),
            invoice_phone: String(d.invoicePhone ?? ''),
            invoice_bank: String(d.invoiceBank ?? ''),
            invoice_account: String(d.invoiceAccount ?? ''),
            remark: nullable(d.remark),
            enabled: d.enabled === true,
          })
          .execute()
        return
      case 'vehicle': {
        const c = record(d.carrier)
        await tx
          .insertInto('dcl_vehicle_versions')
          .values({
            approval_entry_id: id,
            name: String(d.name ?? ''),
            plate_number: nullable(d.plateNumber),
            vehicle_type_object_id: nullable(record(d.vehicleType).id),
            vehicle_type_snapshot: json(record(d.vehicleType)),
            carrier_affiliation_type: nullable(c.kind),
            carrier_operating_entity_id:
              c.kind === 'INTERNAL' ? nullable(c.operatingEntityId) : null,
            carrier_operating_entity_approval_entry_id:
              c.kind === 'INTERNAL' ? nullable(c.approvalEntryId) : null,
            carrier_operating_entity_code:
              c.kind === 'INTERNAL' ? nullable(c.code) : null,
            carrier_operating_entity_name:
              c.kind === 'INTERNAL' ? nullable(c.name) : null,
            carrier_other_unit_object_id:
              c.kind === 'EXTERNAL' ? nullable(c.otherUnitId) : null,
            carrier_other_unit_approval_entry_id:
              c.kind === 'EXTERNAL' ? nullable(c.approvalEntryId) : null,
            carrier_other_unit_code:
              c.kind === 'EXTERNAL' ? nullable(c.code) : null,
            carrier_other_unit_name:
              c.kind === 'EXTERNAL' ? nullable(c.name) : null,
            carrier_snapshot: json(c),
            vin: nullable(d.vin),
            engine_number: nullable(d.engineNumber),
            rated_load_micros: BigInt(
              Math.round(Number(d.ratedLoadKg ?? 0) * 1_000_000),
            ),
            bulk_liquid_capable: d.bulkWaterCarrier === true,
            remark: nullable(d.remark),
            enabled: d.enabled === true,
          })
          .execute()
        return
      }
      case 'fund-account':
        await tx
          .insertInto('dcl_fund_account_versions')
          .values({
            approval_entry_id: id,
            name: String(d.name ?? ''),
            currency: nullable(d.currency),
            account_name: nullable(d.accountName),
            account_number: nullable(d.accountNumber),
            bank_name: nullable(d.bank),
            branch_name: nullable(d.branch),
            operating_entity_id: nullable(record(d.operatingEntity).objectId),
            operating_entity_approval_entry_id: nullable(
              record(d.operatingEntity).approvalEntryId,
            ),
            operating_entity_code: nullable(record(d.operatingEntity).code),
            operating_entity_name: nullable(record(d.operatingEntity).name),
            operating_entity_snapshot: json(record(d.operatingEntity)),
            remark: nullable(d.remark),
            enabled: d.enabled === true,
          })
          .execute()
        return
      case 'product':
        await tx
          .insertInto('dcl_product_versions')
          .values({
            approval_entry_id: id,
            name: String(d.name ?? ''),
            category_id: nullable(record(d.productCategory).id),
            product_type_id: nullable(record(d.productType).id),
            behavior_profile: nullable(record(d.productType).behaviorProfile),
            default_input_unit_id: nullable(record(d.defaultInputUnit).id),
            pricing_unit_id: nullable(record(d.pricingUnit).id),
            specification: nullable(d.specification),
            model: nullable(d.model),
            barcode: nullable(d.barcode),
            source_snapshots: json({
              productType: d.productType,
              productCategory: d.productCategory,
              pricingUnit: d.pricingUnit,
              defaultInputUnit: d.defaultInputUnit,
            }),
            unit_conversions: json([]),
            default_packaging_snapshot: json({
              defaultPackageSpec: d.defaultPackageSpec,
            }),
            recyclable: d.recyclable === true,
            fixed_formula: null,
            remark: nullable(d.remark),
            enabled: d.enabled === true,
          })
          .execute()
        return
      case 'employee':
        await tx
          .insertInto('dcl_employee_versions')
          .values({
            approval_entry_id: id,
            legal_name: nullable(d.legalName),
            display_name: String(d.displayName ?? ''),
            legal_identifier: nullable(d.legalIdentifier),
            employee_category_id: nullable(record(d.employeeCategory).id),
            department_id: nullable(record(d.department).id),
            position_id: nullable(record(d.position).id),
            hired_on: nullable(d.employmentDate)
              ? new Date(String(d.employmentDate))
              : null,
            work_phone: nullable(d.workPhone),
            work_email: nullable(d.workEmail),
            operating_entity_id: nullable(record(d.operatingEntity).objectId),
            operating_entity_approval_entry_id: nullable(
              record(d.operatingEntity).approvalEntryId,
            ),
            operating_entity_code: nullable(record(d.operatingEntity).code),
            operating_entity_name: nullable(record(d.operatingEntity).name),
            source_snapshots: json({
              identityKind: d.identityKind,
              contactName: d.contactName,
              phone: d.phone,
              address: d.address,
              employeeCategory: d.employeeCategory,
              department: d.department,
              position: d.position,
            }),
            remark: nullable(d.remark),
            enabled: d.enabled === true,
          })
          .execute()
        return
      case 'supplier':
        await this.writeIdentitySet(tx, 'supplier', id, d)
        return
      case 'other-unit':
        await this.writeIdentitySet(tx, 'other-unit', id, d)
        return
      case 'sales-partner':
        await this.writeIdentitySet(tx, 'sales-partner', id, d)
        return
      case 'customer':
        await this.writeCustomer(tx, id, d)
        return
      case 'acc-mapping':
        await tx
          .insertInto('dcl_acc_mapping_versions')
          .values({
            approval_entry_id: id,
            book_id: String(record(d.book).id ?? ''),
            vou_entity_id: String(record(d.vouEntity).id ?? ''),
            book_snapshot: json(record(d.book)),
            vou_entity_snapshot: json(record(d.vouEntity)),
            default_result: String(d.defaultResult ?? ''),
            mapping_definition: json(record(d.definition)),
          })
          .execute()
        return
      case 'rpt-definition':
        await tx
          .insertInto('dcl_rpt_definition_versions')
          .values({
            approval_entry_id: id,
            name: String(d.name ?? ''),
            description: String(d.description ?? ''),
            enabled: d.enabled === true,
            sql_text: String(d.sql ?? ''),
            parameters: json(array(d.parameters)),
            columns: json(array(d.columns)),
          })
          .execute()
        return
    }
  }

  private async writeIdentitySet(
    tx: Executor,
    entity: 'supplier' | 'other-unit' | 'sales-partner',
    id: string,
    d: ArchiveSnapshot,
  ): Promise<void> {
    const common = {
      approval_entry_id: id,
      kind: String(d.identityKind ?? ''),
      legal_name: String(d.legalName ?? ''),
      display_name: String(d.displayName ?? ''),
      legal_identifier: nullable(d.legalIdentifier),
      contact_name: nullable(d.contactName),
      contact_phone: nullable(d.phone),
      address: nullable(d.address),
      default_operating_entity_id: nullable(d.defaultOperatingEntityId),
      default_operating_entity_reference: json(
        array(d.operatingEntities).find(
          (v) => record(v).objectId === d.defaultOperatingEntityId,
        ) ?? null,
      ),
      remark: nullable(d.remark),
      enabled: d.enabled === true,
    }
    if (entity === 'supplier')
      await tx
        .insertInto('dcl_supplier_versions')
        .values({
          ...common,
          settlement_method_snapshot:
            d.settlementMethod === null
              ? null
              : json(record(d.settlementMethod)),
          default_purchaser_employee_id: nullable(
            record(d.defaultPurchaser).objectId,
          ),
          default_purchaser_approval_entry_id: nullable(
            record(d.defaultPurchaser).approvalEntryId,
          ),
          default_purchaser_code: nullable(record(d.defaultPurchaser).code),
          default_purchaser_name: nullable(record(d.defaultPurchaser).name),
          default_purchaser_snapshot:
            d.defaultPurchaser === null
              ? null
              : json(record(d.defaultPurchaser)),
        })
        .execute()
    if (entity === 'other-unit')
      await tx
        .insertInto('dcl_other_unit_versions')
        .values({
          ...common,
          settlement_method_snapshot:
            d.settlementMethod === null
              ? null
              : json(record(d.settlementMethod)),
        })
        .execute()
    if (entity === 'sales-partner')
      await tx
        .insertInto('dcl_sales_partner_versions')
        .values({ ...common, capabilities: json(array(d.capabilities)) })
        .execute()
    for (const item of array(d.operatingEntities)) {
      const ref = record(item)
      const values = {
        approval_entry_id: id,
        operating_entity_id: String(ref.objectId ?? ''),
        operating_entity_approval_entry_id: String(ref.approvalEntryId ?? ''),
        operating_entity_code: String(ref.code ?? ''),
        operating_entity_name: String(ref.name ?? ''),
      }
      if (entity === 'supplier')
        await tx
          .insertInto('dcl_supplier_version_operating_entities')
          .values(values)
          .execute()
      if (entity === 'other-unit')
        await tx
          .insertInto('dcl_other_unit_version_operating_entities')
          .values(values)
          .execute()
      if (entity === 'sales-partner')
        await tx
          .insertInto('dcl_sales_partner_version_operating_entities')
          .values(values)
          .execute()
    }
  }

  private async writeCustomer(
    tx: Executor,
    id: string,
    d: ArchiveSnapshot,
  ): Promise<void> {
    const oe = record(d.defaultOperatingEntity)
    await tx
      .insertInto('dcl_customer_versions')
      .values({
        approval_entry_id: id,
        kind: String(d.identityKind ?? ''),
        legal_name: nullable(d.legalName),
        display_name: String(d.displayName ?? ''),
        legal_identifier: nullable(d.legalIdentifier),
        phone: nullable(d.phone),
        email: nullable(d.email),
        address: nullable(d.address),
        invoice_title: nullable(d.invoiceTitle),
        invoice_address: nullable(d.invoiceAddress),
        invoice_phone: nullable(d.invoicePhone),
        invoice_bank: nullable(d.invoiceBank),
        invoice_account: nullable(d.invoiceAccount),
        remittance_profiles: json(array(d.remittanceProfiles)),
        default_operating_entity_id: nullable(oe.objectId),
        default_operating_entity_approval_entry_id: nullable(
          oe.approvalEntryId,
        ),
        default_operating_entity_code: nullable(oe.code),
        default_operating_entity_name: nullable(oe.name),
        tax_attachments: json(array(d.identityAttachments)),
        enabled: d.enabled === true,
      })
      .execute()
    const owner = await tx
      .selectFrom('approval_entries')
      .select('subject_id')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
    for (const item of array(d.subunits)) {
      const s = record(item)
      const root = await tx
        .selectFrom('dcl_customer_subunit_roots')
        .select(['customer_id', 'code'])
        .where('subunit_id', '=', String(s.id ?? ''))
        .executeTakeFirst()
      if (root) {
        if (
          root.customer_id !== owner.subject_id ||
          root.code !== String(s.code ?? '')
        )
          throw new ArchiveApplicationError('customer_subunit_conflict')
      } else {
        await tx
          .insertInto('dcl_customer_subunit_roots')
          .values({
            subunit_id: String(s.id ?? ''),
            customer_id: owner.subject_id,
            code: String(s.code ?? ''),
          })
          .execute()
      }
      await tx
        .insertInto('dcl_customer_version_subunits')
        .values({
          customer_approval_entry_id: id,
          subunit_id: String(s.id ?? ''),
          name: String(s.name ?? ''),
          contact_name: nullable(s.contactName),
          contact_phone: null,
          business_address: nullable(s.address),
          customer_type_id: nullable(s.customerType),
          settlement_method_id: nullable(record(s.settlementMethod).objectId),
          settlement_snapshot:
            s.settlementMethod === null
              ? null
              : json(record(s.settlementMethod)),
          payment_snapshot: json({ receiptMethod: s.receiptMethod }),
          transport_snapshot: json({ transportMethod: s.transportMethod }),
          pricing_snapshot: json({ pricePolicy: s.pricePolicy }),
          credit_limits: json(array(s.creditLimits)),
          primary_sales_attribution_type:
            s.salesAttribution === null ? null : 'REFERENCE',
          primary_sales_attribution_object_id: nullable(
            record(s.salesAttribution).objectId,
          ),
          primary_sales_attribution_approval_entry_id: nullable(
            record(s.salesAttribution).approvalEntryId,
          ),
          primary_sales_attribution_code: nullable(
            record(s.salesAttribution).code,
          ),
          primary_sales_attribution_name: nullable(
            record(s.salesAttribution).name,
          ),
          sales_attribution_snapshot:
            s.salesAttribution === null
              ? null
              : json(record(s.salesAttribution)),
          internal_reminder: nullable(s.internalReminder),
          default_order_remark: nullable(s.defaultOrderRemark),
          business_attachments: json(array(s.attachments)),
          enabled: s.enabled === true,
        })
        .execute()
    }
  }

  private async assignCustomerSubunitCodes(
    tx: Executor,
    customerId: string,
    snapshot: ArchiveSnapshot,
  ): Promise<ArchiveSnapshot> {
    const roots = await tx
      .selectFrom('dcl_customer_subunit_roots')
      .select('code')
      .where('customer_id', '=', customerId)
      .execute()
    let next = roots.reduce((highest, root) => {
      const match = /^SUB-(\d+)$/.exec(root.code)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0)
    const knownCodes = new Set(roots.map((root) => root.code))
    const subunits = []
    for (const item of array(snapshot.subunits)) {
      const subunit = record(item)
      if (subunit.intent === 'NEW') {
        next += 1
        const code = `SUB-${String(next).padStart(4, '0')}`
        knownCodes.add(code)
        subunits.push({ ...subunit, code })
        continue
      }
      const code = String(subunit.code ?? '')
      if (!knownCodes.has(code))
        throw new ArchiveApplicationError('customer_subunit_conflict')
      subunits.push(subunit)
    }
    return { ...snapshot, subunits }
  }

  private async promoteCustomerAttachments(
    tx: Executor,
    approvalEntryId: string,
    snapshot: ArchiveSnapshot,
    actorId: string,
  ): Promise<void> {
    const owner = await tx
      .selectFrom('approval_entries')
      .select('subject_id')
      .where('id', '=', approvalEntryId)
      .executeTakeFirstOrThrow()
    const attachments = [
      ...array(snapshot.identityAttachments),
      ...array(snapshot.subunits).flatMap((item) =>
        array(record(item).attachments),
      ),
    ].map(record)
    for (const attachment of attachments) {
      const stagingId =
        typeof attachment.stagingId === 'string' ? attachment.stagingId : null
      if (!stagingId) {
        const prior = await tx
          .selectFrom('dcl_customer_attachments as a')
          .innerJoin('approval_entries as e', 'e.id', 'a.approval_entry_id')
          .select([
            'a.file_id',
            'a.file_name',
            'a.mime_type',
            'a.size_bytes',
            'a.digest',
            'a.content',
          ])
          .where('e.subject_id', '=', owner.subject_id)
          .where('a.file_id', '=', String(attachment.id ?? ''))
          .where('a.file_name', '=', String(attachment.fileName ?? ''))
          .where('a.mime_type', '=', String(attachment.contentType ?? ''))
          .where('a.size_bytes', '=', Number(attachment.sizeBytes ?? 0))
          .where('a.digest', '=', String(attachment.sha256 ?? ''))
          .orderBy('e.version_no', 'desc')
          .executeTakeFirst()
        if (!prior)
          throw new ArchiveApplicationError(
            'customer_attachment_staging_invalid',
          )
        await tx
          .insertInto('dcl_customer_attachments')
          .values({
            file_id: prior.file_id,
            approval_entry_id: approvalEntryId,
            file_name: prior.file_name,
            mime_type: prior.mime_type,
            size_bytes: prior.size_bytes,
            digest: prior.digest,
            content: prior.content,
            created_at: new Date(),
          })
          .execute()
        continue
      }
      const staged = await tx
        .selectFrom('dcl_customer_attachment_staging')
        .selectAll()
        .where('id', '=', stagingId)
        .where('owner_user_id', '=', actorId)
        .forUpdate()
        .executeTakeFirst()
      if (
        !staged ||
        staged.expires_at <= new Date() ||
        staged.file_id !== attachment.id ||
        staged.file_name !== attachment.fileName ||
        staged.mime_type !== attachment.contentType ||
        staged.size_bytes !== attachment.sizeBytes ||
        staged.digest !== attachment.sha256
      )
        throw new ArchiveApplicationError('customer_attachment_staging_invalid')
      await tx
        .insertInto('dcl_customer_attachments')
        .values({
          file_id: staged.file_id,
          approval_entry_id: approvalEntryId,
          file_name: staged.file_name,
          mime_type: staged.mime_type,
          size_bytes: staged.size_bytes,
          digest: staged.digest,
          content: staged.content,
          created_at: new Date(),
        })
        .execute()
      await tx
        .deleteFrom('dcl_customer_attachment_staging')
        .where('id', '=', staged.id)
        .execute()
    }
  }

  private async readSnapshot(
    tx: Executor,
    entity: ArchiveEntity,
    id: string,
  ): Promise<ArchiveSnapshot> {
    // Each aggregate rehydrates its own version row. JSON fields retain exact submitted reference snapshots.
    switch (entity) {
      case 'operating-entity': {
        const r = await tx
          .selectFrom('dcl_operating_entity_versions')
          .selectAll()
          .where('approval_entry_id', '=', id)
          .executeTakeFirstOrThrow()
        return {
          legalName: r.legal_name,
          legalIdentifier: r.legal_identifier ?? '',
          registeredAddress: r.registered_address,
          contactName: r.contact_name,
          contactPhone: r.contact_phone,
          invoiceTitle: r.invoice_title,
          invoiceAddress: r.invoice_address,
          invoicePhone: r.invoice_phone,
          invoiceBank: r.invoice_bank,
          invoiceAccount: r.invoice_account,
          remark: r.remark ?? '',
          enabled: r.enabled,
        }
      }
      case 'vehicle': {
        const r = await tx
          .selectFrom('dcl_vehicle_versions')
          .selectAll()
          .where('approval_entry_id', '=', id)
          .executeTakeFirstOrThrow()
        const carrier = record(r.carrier_snapshot)
        return {
          name: r.name,
          plateNumber: r.plate_number ?? '',
          vehicleType: record(r.vehicle_type_snapshot),
          carrier:
            carrier.kind === 'INTERNAL'
              ? {
                  kind: 'INTERNAL',
                  operatingEntityId: String(carrier.operatingEntityId ?? ''),
                  approvalEntryId: String(carrier.approvalEntryId ?? ''),
                }
              : {
                  kind: 'EXTERNAL',
                  otherUnitId: String(carrier.otherUnitId ?? ''),
                  approvalEntryId: String(carrier.approvalEntryId ?? ''),
                },
          vin: r.vin ?? '',
          engineNumber: r.engine_number ?? '',
          ratedLoadKg:
            r.rated_load_micros === null
              ? 0
              : Number(r.rated_load_micros) / 1_000_000,
          bulkWaterCarrier: r.bulk_liquid_capable,
          remark: r.remark ?? '',
          enabled: r.enabled,
        }
      }
      case 'fund-account': {
        const r = await tx
          .selectFrom('dcl_fund_account_versions')
          .selectAll()
          .where('approval_entry_id', '=', id)
          .executeTakeFirstOrThrow()
        return {
          name: r.name,
          currency: r.currency ?? '',
          accountName: r.account_name ?? '',
          bank: r.bank_name ?? '',
          branch: r.branch_name ?? '',
          accountNumber: r.account_number ?? '',
          operatingEntity: {
            objectId: r.operating_entity_id ?? '',
            approvalEntryId: r.operating_entity_approval_entry_id ?? '',
            code: r.operating_entity_code ?? '',
            name: r.operating_entity_name ?? '',
          },
          remark: r.remark ?? '',
          enabled: r.enabled,
        }
      }
      case 'product': {
        const r = await tx
          .selectFrom('dcl_product_versions')
          .selectAll()
          .where('approval_entry_id', '=', id)
          .executeTakeFirstOrThrow()
        const sources = record(r.source_snapshots)
        return {
          name: r.name,
          barcode: r.barcode ?? '',
          specification: r.specification ?? '',
          model: r.model ?? '',
          productType: record(sources.productType),
          productCategory: record(sources.productCategory),
          pricingUnit: record(sources.pricingUnit),
          defaultInputUnit: record(sources.defaultInputUnit),
          defaultPackageSpec:
            record(r.default_packaging_snapshot).defaultPackageSpec ?? '',
          recyclable: r.recyclable,
          remark: r.remark ?? '',
          enabled: r.enabled,
        }
      }
      case 'employee': {
        const r = await tx
          .selectFrom('dcl_employee_versions')
          .selectAll()
          .where('approval_entry_id', '=', id)
          .executeTakeFirstOrThrow()
        const sources = record(r.source_snapshots)
        return {
          identityKind: sources.identityKind ?? 'PERSON',
          legalName: r.legal_name ?? '',
          displayName: r.display_name,
          legalIdentifier: r.legal_identifier ?? '',
          contactName: sources.contactName ?? '',
          phone: sources.phone ?? '',
          address: sources.address ?? '',
          employeeCategory: record(sources.employeeCategory),
          department: record(sources.department),
          position: record(sources.position),
          employmentDate: r.hired_on?.toISOString().slice(0, 10) ?? '',
          workPhone: r.work_phone ?? '',
          workEmail: r.work_email ?? '',
          operatingEntity: {
            objectId: r.operating_entity_id ?? '',
            approvalEntryId: r.operating_entity_approval_entry_id ?? '',
            code: r.operating_entity_code ?? '',
            name: r.operating_entity_name ?? '',
          },
          remark: r.remark ?? '',
          enabled: r.enabled,
        }
      }
      case 'supplier':
        return this.readIdentitySet(tx, 'supplier', id)
      case 'other-unit':
        return this.readIdentitySet(tx, 'other-unit', id)
      case 'sales-partner':
        return this.readIdentitySet(tx, 'sales-partner', id)
      case 'customer':
        return this.readCustomer(tx, id)
      case 'acc-mapping': {
        const r = await tx
          .selectFrom('dcl_acc_mapping_versions')
          .selectAll()
          .where('approval_entry_id', '=', id)
          .executeTakeFirstOrThrow()
        return {
          book: record(r.book_snapshot),
          vouEntity: record(r.vou_entity_snapshot),
          defaultResult: r.default_result,
          definition: record(r.mapping_definition),
        }
      }
      case 'rpt-definition': {
        const r = await tx
          .selectFrom('dcl_rpt_definition_versions')
          .selectAll()
          .where('approval_entry_id', '=', id)
          .executeTakeFirstOrThrow()
        return {
          name: r.name,
          description: r.description,
          enabled: r.enabled,
          sql: r.sql_text,
          parameters: array(r.parameters),
          columns: array(r.columns),
        }
      }
    }
  }

  private async readIdentitySet(
    tx: Executor,
    entity: 'supplier' | 'other-unit' | 'sales-partner',
    id: string,
  ): Promise<ArchiveSnapshot> {
    const row =
      entity === 'supplier'
        ? await sql<IdentitySetRow>`SELECT kind, legal_name, display_name, legal_identifier, contact_name, contact_phone, address, default_operating_entity_id, default_purchaser_employee_id, default_purchaser_approval_entry_id, default_purchaser_code, default_purchaser_name, remark, enabled, settlement_method_snapshot, default_purchaser_snapshot, NULL::jsonb AS capabilities FROM dcl_supplier_versions WHERE approval_entry_id = ${id}`.execute(
            tx,
          )
        : entity === 'other-unit'
          ? await sql<IdentitySetRow>`SELECT kind, legal_name, display_name, legal_identifier, contact_name, contact_phone, address, default_operating_entity_id, NULL::varchar AS default_purchaser_employee_id, NULL::varchar AS default_purchaser_approval_entry_id, NULL::varchar AS default_purchaser_code, NULL::varchar AS default_purchaser_name, remark, enabled, settlement_method_snapshot, NULL::jsonb AS default_purchaser_snapshot, NULL::jsonb AS capabilities FROM dcl_other_unit_versions WHERE approval_entry_id = ${id}`.execute(
              tx,
            )
          : await sql<IdentitySetRow>`SELECT kind, legal_name, display_name, legal_identifier, contact_name, contact_phone, address, default_operating_entity_id, NULL::varchar AS default_purchaser_employee_id, NULL::varchar AS default_purchaser_approval_entry_id, NULL::varchar AS default_purchaser_code, NULL::varchar AS default_purchaser_name, remark, enabled, NULL::jsonb AS settlement_method_snapshot, NULL::jsonb AS default_purchaser_snapshot, capabilities FROM dcl_sales_partner_versions WHERE approval_entry_id = ${id}`.execute(
              tx,
            )
    const item = row.rows[0]
    if (!item) throw new ArchiveApplicationError('approval_not_found')
    const operatingEntities =
      entity === 'supplier'
        ? await sql<OperatingEntityReferenceRow>`SELECT operating_entity_id, operating_entity_approval_entry_id, operating_entity_code, operating_entity_name FROM dcl_supplier_version_operating_entities WHERE approval_entry_id = ${id}`.execute(
            tx,
          )
        : entity === 'other-unit'
          ? await sql<OperatingEntityReferenceRow>`SELECT operating_entity_id, operating_entity_approval_entry_id, operating_entity_code, operating_entity_name FROM dcl_other_unit_version_operating_entities WHERE approval_entry_id = ${id}`.execute(
              tx,
            )
          : await sql<OperatingEntityReferenceRow>`SELECT operating_entity_id, operating_entity_approval_entry_id, operating_entity_code, operating_entity_name FROM dcl_sales_partner_version_operating_entities WHERE approval_entry_id = ${id}`.execute(
              tx,
            )
    const base: ArchiveSnapshot = {
      identityKind: item.kind,
      legalName: item.legal_name,
      displayName: item.display_name,
      legalIdentifier: item.legal_identifier ?? '',
      contactName: item.contact_name ?? '',
      phone: item.contact_phone ?? '',
      address: item.address ?? '',
      operatingEntities: operatingEntities.rows.map((reference) => ({
        objectId: reference.operating_entity_id,
        approvalEntryId: reference.operating_entity_approval_entry_id,
        code: reference.operating_entity_code,
        name: reference.operating_entity_name,
      })),
      defaultOperatingEntityId: item.default_operating_entity_id,
      remark: item.remark ?? '',
      enabled: item.enabled,
    }
    if (entity === 'supplier')
      return {
        ...base,
        settlementMethod: item.settlement_method_snapshot,
        defaultPurchaser: item.default_purchaser_employee_id
          ? {
              objectId: item.default_purchaser_employee_id,
              approvalEntryId: item.default_purchaser_approval_entry_id ?? '',
              code: item.default_purchaser_code ?? '',
              name: item.default_purchaser_name ?? '',
            }
          : null,
      }
    if (entity === 'other-unit')
      return { ...base, settlementMethod: item.settlement_method_snapshot }
    return { ...base, capabilities: array(item.capabilities) }
  }

  private async readCustomer(
    tx: Executor,
    id: string,
  ): Promise<ArchiveSnapshot> {
    const r = await tx
      .selectFrom('dcl_customer_versions')
      .selectAll()
      .where('approval_entry_id', '=', id)
      .executeTakeFirstOrThrow()
    const subs = await tx
      .selectFrom('dcl_customer_version_subunits as v')
      .innerJoin(
        'dcl_customer_subunit_roots as r',
        'r.subunit_id',
        'v.subunit_id',
      )
      .selectAll('v')
      .select('r.code as root_code')
      .where('v.customer_approval_entry_id', '=', id)
      .execute()
    return {
      identityKind: r.kind,
      legalName: r.legal_name ?? '',
      displayName: r.display_name,
      legalIdentifier: r.legal_identifier ?? '',
      phone: r.phone ?? '',
      email: r.email ?? '',
      address: r.address ?? '',
      invoiceTitle: r.invoice_title ?? '',
      invoiceAddress: r.invoice_address ?? '',
      invoicePhone: r.invoice_phone ?? '',
      invoiceBank: r.invoice_bank ?? '',
      invoiceAccount: r.invoice_account ?? '',
      remittanceProfiles: array(r.remittance_profiles),
      defaultOperatingEntity: r.default_operating_entity_id
        ? {
            objectId: r.default_operating_entity_id,
            approvalEntryId: r.default_operating_entity_approval_entry_id ?? '',
            code: r.default_operating_entity_code ?? '',
            name: r.default_operating_entity_name ?? '',
          }
        : null,
      identityAttachments: array(r.tax_attachments),
      subunits: subs.map((s) => ({
        intent: 'EXISTING',
        id: s.subunit_id,
        code: s.root_code,
        name: s.name,
        contactName: s.contact_name ?? '',
        address: s.business_address ?? '',
        customerType: s.customer_type_id ?? '',
        settlementMethod: s.settlement_snapshot,
        receiptMethod: record(s.payment_snapshot).receiptMethod ?? '',
        transportMethod: record(s.transport_snapshot).transportMethod ?? '',
        pricePolicy: record(s.pricing_snapshot).pricePolicy ?? '',
        creditLimits: array(s.credit_limits),
        salesAttribution: s.primary_sales_attribution_object_id
          ? {
              objectId: s.primary_sales_attribution_object_id,
              approvalEntryId:
                s.primary_sales_attribution_approval_entry_id ?? '',
              code: s.primary_sales_attribution_code ?? '',
              name: s.primary_sales_attribution_name ?? '',
            }
          : null,
        internalReminder: s.internal_reminder ?? '',
        defaultOrderRemark: s.default_order_remark ?? '',
        attachments: array(s.business_attachments),
        enabled: s.enabled,
      })),
      enabled: r.enabled,
    }
  }

  private async loadEntry(
    tx: Executor,
    entity: ArchiveEntity,
    submissionId: string,
    subjectId: string,
    lock: boolean,
  ): Promise<ApprovalEntry> {
    let query = tx
      .selectFrom('approval_entries')
      .selectAll()
      .where('id', '=', submissionId)
      .where('subject_id', '=', subjectId)
      .where('entity', '=', entity)
    if (lock) query = query.forUpdate()
    const row = await query.executeTakeFirst()
    if (!row) throw new ArchiveApplicationError('approval_not_found')
    return {
      id: row.id,
      domain: row.domain,
      entity: row.entity,
      subjectId: row.subject_id,
      versionNo: row.version_no,
      status: row.status as ApprovalStatus,
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

  private async readSubmission(
    tx: Executor,
    entity: ArchiveEntity,
    submissionId: string,
    actor: ApprovalActor,
  ): Promise<ArchiveSubmissionView> {
    const row = await tx
      .selectFrom('approval_entries as e')
      .innerJoin('dcl_subjects as s', 's.id', 'e.subject_id')
      .select([
        'e.id',
        'e.subject_id',
        'e.version_no',
        'e.status',
        'e.revision',
        'e.submitted_by',
        'e.submitted_at',
        'e.approved_by',
        'e.approved_at',
        'e.rejected_by',
        'e.rejected_at',
        'e.rejection_reason',
        's.code',
      ])
      .where('e.id', '=', submissionId)
      .where('e.entity', '=', entity)
      .executeTakeFirst()
    if (!row) throw new ArchiveApplicationError('approval_not_found')
    const entry = await this.loadEntry(
      tx,
      entity,
      submissionId,
      row.subject_id,
      false,
    )
    const validity =
      entity === 'rpt-definition'
        ? await tx
            .selectFrom('rpt_definition_validities')
            .select(['status', 'diagnostic', 'validated_at', 'validated_by'])
            .where('approval_entry_id', '=', submissionId)
            .executeTakeFirst()
        : undefined
    return {
      entity,
      subjectId: row.subject_id,
      code: row.code,
      submissionId: row.id,
      versionNo: row.version_no,
      status: row.status as ApprovalStatus,
      revision: String(row.revision),
      submittedBy: row.submitted_by,
      submittedAt: row.submitted_at.toISOString(),
      approvedBy: row.approved_by,
      approvedAt: row.approved_at?.toISOString() ?? null,
      rejectedBy: row.rejected_by,
      rejectedAt: row.rejected_at?.toISOString() ?? null,
      rejectionReason: row.rejection_reason,
      snapshot: await this.readSnapshot(tx, entity, submissionId),
      availableApprovalActions: availableApprovalActions(entry, actor),
      canDelete:
        (entry.status === 'PENDING' || entry.status === 'REJECTED') &&
        entry.metadata.submitted.actorId === actor.id &&
        (actor.trusted === true ||
          actor.permissions.includes(`/dcl/${entity}/delete`)),
      ...(entity === 'rpt-definition'
        ? {
            validity: validity
              ? {
                  status: validity.status as 'VALID' | 'INVALID',
                  diagnostic: validity.diagnostic,
                  validatedAt: validity.validated_at.toISOString(),
                  validatedBy: validity.validated_by,
                }
              : null,
          }
        : {}),
    }
  }

  private async ensureUnapproveAllowed(
    tx: Executor,
    entity: ArchiveEntity,
    entry: ApprovalEntry,
  ): Promise<void> {
    const latest = await tx
      .selectFrom('approval_entries')
      .select('id')
      .where('domain', '=', 'dcl')
      .where('entity', '=', entity)
      .where('subject_id', '=', entry.subjectId)
      .where('status', '=', 'APPROVED')
      .orderBy('version_no', 'desc')
      .executeTakeFirst()
    if (latest?.id !== entry.id)
      throw new ArchiveApplicationError('approval_not_latest_approved')
    const open = await tx
      .selectFrom('approval_entries')
      .select('id')
      .where('domain', '=', 'dcl')
      .where('entity', '=', entity)
      .where('subject_id', '=', entry.subjectId)
      .where('status', 'in', ['PENDING', 'REJECTED'])
      .executeTakeFirst()
    if (open) throw new ArchiveApplicationError('approval_open_version_exists')
    const blockers = [
      ...(await this.exactReferenceBlockers(tx, entry)),
      ...(entry.entity === 'acc-mapping'
        ? await this.accMappingReferenceBlockers(tx, entry.id)
        : []),
    ]
    if (blockers.length)
      throw new ArchiveApplicationError(
        'approval_strong_reference_exists',
        blockers,
      )
  }

  private async syncAccMappingSubjectUsages(
    tx: Executor,
    approvalEntryId: string,
  ): Promise<void> {
    const mapping = await sql<{ mapping_definition: JsonValue }>`
      SELECT mapping_definition
      FROM dcl_acc_mapping_versions
      WHERE approval_entry_id = ${approvalEntryId}
    `.execute(tx)
    const definition = record(mapping.rows[0]?.mapping_definition)
    const subjectIds = new Set<string>()
    for (const template of array(definition.templates)) {
      for (const line of array(record(template).lines)) {
        const normalized = record(line)
        if (normalized.subjectSource === 'FIXED') {
          const subjectId = String(normalized.subjectValue ?? '').trim()
          if (subjectId) subjectIds.add(subjectId)
        }
        const counterpartId = String(
          normalized.costCounterpartSubjectId ?? '',
        ).trim()
        if (counterpartId) subjectIds.add(counterpartId)
      }
    }
    const asset = record(definition.assetConfiguration)
    for (const field of [
      'assetSubjectId',
      'accumulatedDepreciationSubjectId',
      'depreciationExpenseSubjectId',
    ]) {
      const subjectId = String(asset[field] ?? '').trim()
      if (subjectId) subjectIds.add(subjectId)
    }
    await sql`DELETE FROM dcl_acc_mapping_subject_usages
      WHERE approval_entry_id = ${approvalEntryId}`.execute(tx)
    for (const subjectId of subjectIds)
      await sql`INSERT INTO dcl_acc_mapping_subject_usages (
        approval_entry_id, subject_id
      ) VALUES (${approvalEntryId}, ${subjectId})
      ON CONFLICT DO NOTHING`.execute(tx)
  }

  private async accMappingReferenceBlockers(
    tx: Executor,
    approvalEntryId: string,
  ): Promise<ArchiveBlocker[]> {
    const references = await sql<{
      document_type: string
      document_id: string
    }>`SELECT document_type, document_id
      FROM dcl_acc_mapping_reference_facts
      WHERE mapping_approval_entry_id = ${approvalEntryId}
      ORDER BY document_type, document_id`.execute(tx)
    return references.rows.map((reference) => ({
      kind: 'ACC_MAPPING_REFERENCE' as const,
      mappingApprovalEntryId: approvalEntryId,
      documentType: reference.document_type,
      documentId: reference.document_id,
    }))
  }

  private async exactReferenceBlockers(
    tx: Executor,
    entry: ApprovalEntry,
  ): Promise<ArchiveBlocker[]> {
    const predicate = sql`e.domain = 'dcl' AND e.id <> ${entry.id} AND e.status IN ('PENDING', 'APPROVED', 'REJECTED')`
    const results =
      entry.entity === 'operating-entity'
        ? await Promise.all([
            sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'carrier' AS field FROM dcl_vehicle_versions v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE ${predicate} AND v.carrier_operating_entity_approval_entry_id = ${entry.id}`.execute(
              tx,
            ),
            sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'operatingEntity' AS field FROM dcl_fund_account_versions v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE ${predicate} AND v.operating_entity_approval_entry_id = ${entry.id}`.execute(
              tx,
            ),
            sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'operatingEntity' AS field FROM dcl_employee_versions v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE ${predicate} AND v.operating_entity_approval_entry_id = ${entry.id}`.execute(
              tx,
            ),
            sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'operatingEntities' AS field FROM dcl_supplier_version_operating_entities v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE ${predicate} AND v.operating_entity_approval_entry_id = ${entry.id}`.execute(
              tx,
            ),
            sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'operatingEntities' AS field FROM dcl_other_unit_version_operating_entities v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE ${predicate} AND v.operating_entity_approval_entry_id = ${entry.id}`.execute(
              tx,
            ),
            sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'operatingEntities' AS field FROM dcl_sales_partner_version_operating_entities v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE ${predicate} AND v.operating_entity_approval_entry_id = ${entry.id}`.execute(
              tx,
            ),
            sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'defaultOperatingEntity' AS field FROM dcl_customer_versions v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE ${predicate} AND v.default_operating_entity_approval_entry_id = ${entry.id}`.execute(
              tx,
            ),
          ])
        : entry.entity === 'other-unit'
          ? [
              await sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'carrier' AS field FROM dcl_vehicle_versions v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE ${predicate} AND v.carrier_other_unit_approval_entry_id = ${entry.id}`.execute(
                tx,
              ),
            ]
          : entry.entity === 'employee'
            ? await Promise.all([
                sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'defaultPurchaser' AS field FROM dcl_supplier_versions v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE ${predicate} AND v.default_purchaser_approval_entry_id = ${entry.id}`.execute(
                  tx,
                ),
                sql<ReferenceBlockerRow>`SELECT e.entity, e.subject_id, e.id, 'salesAttribution' AS field FROM dcl_customer_version_subunits v JOIN approval_entries e ON e.id = v.customer_approval_entry_id WHERE ${predicate} AND v.primary_sales_attribution_approval_entry_id = ${entry.id}`.execute(
                  tx,
                ),
              ])
            : []
    return results.flatMap((result) =>
      result.rows.map((row) => ({
        kind: 'DCL_APPROVAL_REFERENCE' as const,
        entity: row.entity,
        subjectId: row.subject_id,
        submissionId: row.id,
        field: row.field,
        approvalEntryId: entry.id,
      })),
    )
  }

  private async validateReport(
    tx: Transaction<DB>,
    submissionId: string,
    actorId: string,
  ): Promise<void> {
    const snapshot = await this.readSnapshot(tx, 'rpt-definition', submissionId)
    const reportSql = String(snapshot.sql ?? '').trim()
    if (
      !/^(select|with)\b/i.test(reportSql) ||
      /\b(insert|update|delete|merge|copy|alter|create|drop|grant|revoke|call|do)\b/i.test(
        reportSql,
      ) ||
      /;/.test(reportSql)
    ) {
      await tx
        .insertInto('rpt_definition_validities')
        .values({
          approval_entry_id: submissionId,
          status: 'INVALID',
          diagnostic: 'Only one read-only SELECT/WITH statement is allowed.',
          validated_at: new Date(),
          validated_by: actorId,
        })
        .onConflict((oc) =>
          oc.column('approval_entry_id').doUpdateSet({
            status: 'INVALID',
            diagnostic: 'Only one read-only SELECT/WITH statement is allowed.',
            validated_at: new Date(),
            validated_by: actorId,
          }),
        )
        .execute()
      return
    }
    try {
      await sql.raw('SAVEPOINT rpt_definition_validation').execute(tx)
      try {
        await sql.raw(`EXPLAIN ${reportSql}`).execute(tx)
      } catch (error) {
        await sql
          .raw('ROLLBACK TO SAVEPOINT rpt_definition_validation')
          .execute(tx)
        await sql.raw('RELEASE SAVEPOINT rpt_definition_validation').execute(tx)
        throw error
      }
      await sql.raw('RELEASE SAVEPOINT rpt_definition_validation').execute(tx)
      await tx
        .insertInto('rpt_definition_validities')
        .values({
          approval_entry_id: submissionId,
          status: 'VALID',
          diagnostic: null,
          validated_at: new Date(),
          validated_by: actorId,
        })
        .onConflict((oc) =>
          oc.column('approval_entry_id').doUpdateSet({
            status: 'VALID',
            diagnostic: null,
            validated_at: new Date(),
            validated_by: actorId,
          }),
        )
        .execute()
    } catch (error) {
      await tx
        .insertInto('rpt_definition_validities')
        .values({
          approval_entry_id: submissionId,
          status: 'INVALID',
          diagnostic:
            error instanceof Error
              ? error.message.slice(0, 2000)
              : 'Invalid report query.',
          validated_at: new Date(),
          validated_by: actorId,
        })
        .onConflict((oc) =>
          oc.column('approval_entry_id').doUpdateSet({
            status: 'INVALID',
            diagnostic:
              error instanceof Error
                ? error.message.slice(0, 2000)
                : 'Invalid report query.',
            validated_at: new Date(),
            validated_by: actorId,
          }),
        )
        .execute()
      return
    }
  }
}
