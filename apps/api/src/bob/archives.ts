import { createHash } from 'node:crypto'

import {
  availableApprovalActions,
  prepareOtherUnitSubmit,
  prepareSalesPartnerSubmit,
  prepareSupplierSubmit,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
  type ReferenceBlocker,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { BobArchiveEntity } from './archive-contract.ts'
import type { DB, JsonValue } from '../db/generated.ts'

type ArchiveEntity = BobArchiveEntity
import {
  AuxApplicationError,
  resolveAuxCurrentReference,
} from '../aux/service.ts'
import {
  ApprovalPersistence,
  ApprovalPersistenceError,
} from '../platform/approval.ts'
import {
  VersionedArchives,
  VersionedArchiveError,
  type VersionedArchiveScope,
} from '../platform/versioned-archives.ts'

export type ArchiveExecutor = Kysely<DB> | Transaction<DB>
type Executor = ArchiveExecutor
export type ArchiveSnapshot = Record<string, unknown>

type AuxiliaryField = 'settlementMethod'
type AuxiliaryFact = {
  field: AuxiliaryField
  objectId: string
  available: boolean
  code: string
  name: string
  data: Record<string, unknown>
}

const auxiliaryEntities: Record<AuxiliaryField, string> = {
  settlementMethod: 'settlement-method',
}

function fixedAuxMoney(value: unknown, errorKey: string): string {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())
  )
    throw new BobArchiveApplicationError(errorKey)
  const [whole, fraction = ''] = value.trim().split('.')
  return `${whole}.${fraction.padEnd(2, '0')}`
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
  enabled?: boolean
  latestApproved: ArchiveSubmissionView | null
  openCandidate: ArchiveSubmissionView | null
}

export type ArchiveBlocker =
  | {
      kind: 'AUX_CURRENT_REFERENCE'
      entity: 'vehicle'
      objectId: string
      field: 'carrier'
      approvalEntryId: string
    }
  | {
      kind: 'AUX_REFERENCE'
      entity: 'operating-entity' | 'employee'
      objectId: string
    }
  | {
      kind: 'SUBMISSION_REFERENCE'
      field: string
      objectId: string
      expectedApprovalEntryId: string
      currentApprovalEntryId?: string
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

export class BobArchiveApplicationError extends Error {
  readonly errorKey: string
  readonly data: { blockers: ArchiveBlocker[] } | null

  constructor(errorKey: string, blockers: ArchiveBlocker[] = []) {
    super(errorKey)
    this.name = 'BobArchiveApplicationError'
    this.errorKey = errorKey
    this.data = blockers.length === 0 ? null : { blockers }
  }
}

/** Rehydrates one immutable BOB business snapshot without current enabled state. */
export async function readBusinessIdentitySnapshot(
  tx: ArchiveExecutor,
  entity: 'supplier' | 'other-unit' | 'sales-partner',
  submissionId: string,
): Promise<ArchiveSnapshot> {
  const row =
    entity === 'supplier'
      ? await sql<IdentitySetRow>`SELECT kind, legal_name, display_name, legal_identifier, contact_name, contact_phone, address, default_operating_entity_id, default_purchaser_employee_id, default_purchaser_approval_entry_id, default_purchaser_code, default_purchaser_name, remark, settlement_method_snapshot, default_purchaser_snapshot, NULL::jsonb AS capabilities FROM bob_supplier_versions WHERE approval_entry_id = ${submissionId}`.execute(
          tx,
        )
      : entity === 'other-unit'
        ? await sql<IdentitySetRow>`SELECT kind, legal_name, display_name, legal_identifier, contact_name, contact_phone, address, default_operating_entity_id, NULL::varchar AS default_purchaser_employee_id, NULL::varchar AS default_purchaser_approval_entry_id, NULL::varchar AS default_purchaser_code, NULL::varchar AS default_purchaser_name, remark, settlement_method_snapshot, NULL::jsonb AS default_purchaser_snapshot, NULL::jsonb AS capabilities FROM bob_other_unit_versions WHERE approval_entry_id = ${submissionId}`.execute(
            tx,
          )
        : await sql<IdentitySetRow>`SELECT kind, legal_name, display_name, legal_identifier, contact_name, contact_phone, address, default_operating_entity_id, NULL::varchar AS default_purchaser_employee_id, NULL::varchar AS default_purchaser_approval_entry_id, NULL::varchar AS default_purchaser_code, NULL::varchar AS default_purchaser_name, remark, NULL::jsonb AS settlement_method_snapshot, NULL::jsonb AS default_purchaser_snapshot, capabilities FROM bob_sales_partner_versions WHERE approval_entry_id = ${submissionId}`.execute(
            tx,
          )
  const item = row.rows[0]
  if (!item) throw new BobArchiveApplicationError('approval_not_found')
  const operatingEntities =
    entity === 'supplier'
      ? await sql<OperatingEntityReferenceRow>`SELECT operating_entity_id, operating_entity_approval_entry_id, operating_entity_code, operating_entity_name FROM bob_supplier_version_operating_entities WHERE approval_entry_id = ${submissionId}`.execute(
          tx,
        )
      : entity === 'other-unit'
        ? await sql<OperatingEntityReferenceRow>`SELECT operating_entity_id, operating_entity_approval_entry_id, operating_entity_code, operating_entity_name FROM bob_other_unit_version_operating_entities WHERE approval_entry_id = ${submissionId}`.execute(
            tx,
          )
        : await sql<OperatingEntityReferenceRow>`SELECT operating_entity_id, operating_entity_approval_entry_id, operating_entity_code, operating_entity_name FROM bob_sales_partner_version_operating_entities WHERE approval_entry_id = ${submissionId}`.execute(
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
      code: reference.operating_entity_code,
      name: reference.operating_entity_name,
    })),
    defaultOperatingEntityId: item.default_operating_entity_id,
    remark: item.remark ?? '',
  }
  if (entity === 'supplier')
    return {
      ...base,
      settlementMethod: item.settlement_method_snapshot,
      defaultPurchaser: item.default_purchaser_employee_id
        ? {
            objectId: item.default_purchaser_employee_id,
            code: item.default_purchaser_code ?? '',
            name: item.default_purchaser_name ?? '',
          }
        : null,
    }
  if (entity === 'other-unit')
    return { ...base, settlementMethod: item.settlement_method_snapshot }
  return { ...base, capabilities: array(item.capabilities) }
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
  if (filters.enabled !== undefined && summary.enabled !== filters.enabled)
    return false
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
  _entity: ArchiveEntity,
  code: string | null,
  snapshot: ArchiveSnapshot,
  filters: ArchiveQueryInput['filters'],
): boolean {
  if (filters.keyword) {
    const data = record(snapshot)
    if (
      !includesKeyword(filters.keyword, [
        code,
        nullable(data.legalName),
        nullable(data.displayName),
        nullable(data.legalIdentifier),
      ])
    )
      return false
  }
  return true
}

const entityCodes: Record<ArchiveEntity, string> = {
  supplier: 'SUP',
  'other-unit': 'OTU',
  'sales-partner': 'SLP',
}

type ArchiveDomain = 'bob'

export function archiveDomain(_entity: ArchiveEntity): ArchiveDomain {
  return 'bob'
}

function archiveScope(
  entity: ArchiveEntity,
  subjectId: string,
): VersionedArchiveScope<ArchiveDomain, ArchiveEntity> {
  return { domain: 'bob', entity, subjectId }
}

function archiveActionPath(entity: ArchiveEntity, action: string): string {
  const routedAction =
    action === 'query'
      ? 'submission-query'
      : action === 'get'
        ? 'submission-get'
        : action
  return `/bob/${entity}/${routedAction}`
}

function requirePermission(actor: ApprovalActor, path: string): void {
  if (actor.trusted !== true && !actor.permissions.includes(path))
    throw new BobArchiveApplicationError('forbidden')
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

function requiredVersionNo(value: number | null): number {
  if (value === null)
    throw new BobArchiveApplicationError('archive_invalid_history')
  return value
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

/** Versioned archive persistence. Entity payloads remain explicit below. */
export class BobArchiveService {
  private readonly db: Kysely<DB>
  private readonly approval = new ApprovalPersistence()
  private readonly versioning = new VersionedArchives()

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async query(
    entity: ArchiveEntity,
    input: ArchiveQueryInput,
    actor: ApprovalActor,
  ): Promise<{ items: ArchiveQueryView[]; total: number }> {
    requirePermission(actor, archiveActionPath(entity, 'query'))
    const subjectTable = 'bob_subjects'
    const selected = await sql<{
      id: string
      subject_id: string
      version_no: number
      status: string
      code: string | null
      subject_enabled: boolean | null
    }>`SELECT e.id, e.subject_id, e.version_no, e.status, s.code
              , ${sql.ref('s.enabled')} AS subject_enabled
       FROM approval_entries e
       JOIN ${sql.table(subjectTable)} s ON s.id = e.subject_id
       WHERE e.domain = ${archiveDomain(entity)} AND e.entity = ${entity}
       ORDER BY s.code ASC, s.id ASC, e.version_no DESC`.execute(this.db)
    const rows = selected.rows
    const subjectEntries = new Map<
      string,
      {
        code: string | null
        enabled?: boolean
        latestApprovedId: string | null
        openCandidateId: string | null
      }
    >()
    for (const row of rows) {
      const subject = subjectEntries.get(row.subject_id) ?? {
        code: row.code,
        enabled: row.subject_enabled === true,
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
          enabled: subject.enabled === true,
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
    requirePermission(actor, archiveActionPath(entity, 'get'))
    try {
      return await this.db.transaction().execute(async (tx) => {
        const scope = archiveScope(entity, subjectId)
        const entry = approvalEntryId
          ? await this.versioning.exact(tx, scope, approvalEntryId)
          : (await this.versioning.history(tx, scope))[0]
        if (!entry) throw new BobArchiveApplicationError('approval_not_found')
        return this.readSubmission(tx, entity, entry.id, actor)
      })
    } catch (error) {
      if (error instanceof VersionedArchiveError)
        throw new BobArchiveApplicationError(error.errorKey)
      throw error
    }
  }

  async versions(
    entity: ArchiveEntity,
    subjectId: string,
    actor: ApprovalActor,
  ): Promise<ArchiveSubmissionView[]> {
    requirePermission(actor, archiveActionPath(entity, 'versions'))
    try {
      return await this.db.transaction().execute(async (tx) => {
        const history = await this.versioning.history(
          tx,
          archiveScope(entity, subjectId),
        )
        return Promise.all(
          history.map((entry) =>
            this.readSubmission(tx, entity, entry.id, actor),
          ),
        )
      })
    } catch (error) {
      if (error instanceof VersionedArchiveError)
        throw new BobArchiveApplicationError(error.errorKey)
      throw error
    }
  }

  async auditHistory(
    entity: ArchiveEntity,
    subjectId: string,
    actor: ApprovalActor,
  ): Promise<ArchiveAuditView[]> {
    requirePermission(actor, archiveActionPath(entity, 'audit-history'))
    const events = await this.approval.auditHistory(
      this.db,
      archiveScope(entity, subjectId),
    )
    return events.map((event) => ({
      id: event.id,
      submissionId: event.entryId,
      versionNo: requiredVersionNo(event.versionNo),
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      fromRevision: event.fromRevision,
      toRevision: event.toRevision,
      actorId: event.actorId,
      reason: event.reason,
      createdAt: event.createdAt,
    }))
  }

  async submit(
    entity: ArchiveEntity,
    action: 'submit-new' | 'submit-change',
    input: ArchiveSubmitInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<ArchiveSubmissionView> {
    requirePermission(actor, archiveActionPath(entity, action))
    const domain = archiveDomain(entity)
    const subjectTable = 'bob_subjects'
    const idempotencyKey = input.idempotencyKey.trim()
    const hash = requestHash(action, entity, input)
    let view: ArchiveSubmissionView
    try {
      view = await this.db.transaction().execute(async (tx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${domain}:archive:${entity}:idempotency:${idempotencyKey}`}, 0))`.execute(
          tx,
        )
        const prior = await tx
          .selectFrom('archive_idempotency')
          .select(['request_hash', 'response'])
          .where('entity', '=', entity)
          .where('idempotency_key', '=', idempotencyKey)
          .executeTakeFirst()
        if (prior) {
          if (prior.request_hash !== hash)
            throw new BobArchiveApplicationError('archive_idempotency_conflict')
          return prior.response as unknown as ArchiveSubmissionView
        }
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${domain}:archive:${entity}:${input.subjectId}`}, 0))`.execute(
          tx,
        )
        const subject = await tx
          .selectFrom(subjectTable)
          .select('id')
          .where('id', '=', input.subjectId)
          .where('entity', '=', entity)
          .executeTakeFirst()
        const history = (
          await this.versioning.history(
            tx,
            archiveScope(entity, input.subjectId),
            true,
          )
        ).toReversed()
        const occurredAt = new Date()
        const authoritativeInput = {
          ...input,
          snapshot: await this.freezeAuthoritativeReferences(
            tx,
            entity,
            input.snapshot,
          ),
        }
        const prepared = await this.prepare(
          entity,
          action,
          authoritativeInput,
          actor,
          requestId,
          occurredAt.toISOString(),
          subject !== undefined,
          history.map((entry) => ({
            id: entry.id,
            version_no: requiredVersionNo(entry.versionNo),
            status: entry.status,
            revision: entry.revision,
          })),
          tx,
        )
        if (!prepared.ok)
          throw new BobArchiveApplicationError(
            prepared.errorKey,
            prepared.blockers,
          )
        const plan = prepared.plan
        await this.ensureNoDuplicateBusinessKey(
          tx,
          entity,
          input.subjectId.trim(),
          plan.data,
        )
        let code: string | null
        if (plan.createSubject) {
          const counter = await tx
            .updateTable('archive_code_counters')
            .set((eb) => ({ next_value: eb('next_value', '+', 1) }))
            .where('entity', '=', entity)
            .returning('next_value')
            .executeTakeFirstOrThrow()
          code = `${entityCodes[entity]}-${String(counter.next_value - 1).padStart(4, '0')}`
          await tx
            .insertInto(subjectTable)
            .values({
              id: input.subjectId.trim(),
              entity,
              code,
              enabled: true,
              revision: '1',
              created_at: occurredAt,
              created_by: actor.id,
            })
            .execute()
        } else {
          const current = await tx
            .selectFrom(subjectTable)
            .select('code')
            .where('id', '=', input.subjectId)
            .executeTakeFirstOrThrow()
          code = current.code
        }
        await this.approval.create(tx, {
          entryId: input.submissionId.trim(),
          domain,
          entity,
          subjectId: input.subjectId.trim(),
          versionNo: plan.versionNo,
          actorId: actor.id,
          occurredAt,
          requestId,
        })
        await this.writeSnapshot(
          tx,
          entity,
          input.submissionId.trim(),
          plan.data,
        )
        await this.registerPeopleReferences(
          tx,
          entity,
          input.submissionId.trim(),
          plan.data,
        )
        const view = await this.readSubmission(
          tx,
          entity,
          input.submissionId.trim(),
          actor,
        )
        await tx
          .insertInto('archive_idempotency')
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
      if (error instanceof BobArchiveApplicationError) throw error
      if (error instanceof VersionedArchiveError)
        throw new BobArchiveApplicationError(error.errorKey)
      if (pgCode(error) === '23505')
        throw new BobArchiveApplicationError('archive_conflict')
      throw error
    }
    return view
  }

  async review(
    entity: ArchiveEntity,
    action: ApprovalAction,
    input: ArchiveReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<ArchiveSubmissionView> {
    requirePermission(actor, archiveActionPath(entity, action))
    try {
      return await this.db.transaction().execute(async (tx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${archiveDomain(entity)}:archive:${entity}:${input.subjectId}`}, 0))`.execute(
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
        const occurredAt = new Date()
        await this.approval.transition(tx, {
          action,
          entry,
          actor,
          expectedRevision: input.expectedRevision,
          occurredAt,
          requestId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        })
        return this.readSubmission(tx, entity, entry.id, actor)
      })
    } catch (error) {
      if (error instanceof ApprovalPersistenceError)
        throw new BobArchiveApplicationError(error.errorKey)
      if (error instanceof VersionedArchiveError)
        throw new BobArchiveApplicationError(error.errorKey)
      throw error
    }
  }

  async delete(
    entity: ArchiveEntity,
    input: Omit<ArchiveReviewInput, 'reason'>,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<{ submissionId: string; deleted: true }> {
    requirePermission(actor, archiveActionPath(entity, 'delete'))
    try {
      return await this.db.transaction().execute(async (tx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bob:archive:${entity}:${input.subjectId}`}, 0))`.execute(
          tx,
        )
        const entry = await this.loadEntry(
          tx,
          entity,
          input.submissionId,
          input.subjectId,
          true,
        )
        await sql`DELETE FROM aux_reference_facts WHERE source LIKE ${`bob:${entity}:${input.submissionId}:%`}`.execute(
          tx,
        )
        await this.approval.delete(tx, {
          entry,
          actor,
          expectedRevision: input.expectedRevision,
          occurredAt: new Date(),
          requestId,
        })
        const remaining = await tx
          .selectFrom('approval_entries')
          .select('id')
          .where('domain', '=', 'bob')
          .where('entity', '=', entity)
          .where('subject_id', '=', entry.subjectId)
          .executeTakeFirst()
        if (!remaining)
          await tx
            .deleteFrom('bob_subjects')
            .where('id', '=', entry.subjectId)
            .execute()
        return { submissionId: entry.id, deleted: true as const }
      })
    } catch (error) {
      if (error instanceof ApprovalPersistenceError)
        throw new BobArchiveApplicationError(error.errorKey)
      throw error
    }
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
    const history = (
      await this.versioning.history(
        tx as Transaction<DB>,
        archiveScope(entity, entry.subjectId),
      )
    )
      .filter((candidate) => candidate.id !== entry.id)
      .toReversed()
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
          ? latestApproved.revision
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
      history.map((candidate) => ({
        id: candidate.id,
        version_no: requiredVersionNo(candidate.versionNo),
        status: candidate.status,
        revision: candidate.revision,
      })),
      tx,
    )
    if (!prepared.ok)
      throw new BobArchiveApplicationError(prepared.errorKey, prepared.blockers)
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
    _tx: Executor,
  ): Promise<unknown> {
    const data = record(command.data)
    const base = { ...command, data }
    switch (entity) {
      case 'supplier':
        return prepareSupplierSubmit(
          base as never,
          {
            subject,
            operatingEntities: array(data.operatingEntities).map(
              adoptedAuxFact,
            ),
            defaultPurchaser: adoptedAuxFact(data.defaultPurchaser),
          } as never,
        )
      case 'other-unit':
        return prepareOtherUnitSubmit(
          base as never,
          {
            subject,
            operatingEntities: array(data.operatingEntities).map(
              adoptedAuxFact,
            ),
          } as never,
        )
      case 'sales-partner':
        return prepareSalesPartnerSubmit(
          base as never,
          {
            subject,
            operatingEntities: array(data.operatingEntities).map(
              adoptedAuxFact,
            ),
          } as never,
        )
    }
  }

  private async ensureNoDuplicateBusinessKey(
    tx: Executor,
    entity: ArchiveEntity,
    subjectId: string,
    data: ArchiveSnapshot,
  ): Promise<void> {
    const table =
      entity === 'supplier'
        ? 'bob_supplier_versions'
        : entity === 'other-unit'
          ? 'bob_other_unit_versions'
          : 'bob_sales_partner_versions'
    const errorKey = `${entity.replace('-', '_')}_duplicate_legal_identifier`
    const value = data.legalIdentifier
    if (typeof value !== 'string' || !value.trim()) return
    const normalized = value.trim().toUpperCase()
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bob:archive:${entity}:business-key:legal_identifier:${normalized}`}, 0))`.execute(
      tx,
    )
    const duplicate = await sql<{
      id: string
    }>`SELECT e.id FROM ${sql.table(table)} AS v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE e.domain = 'bob' AND e.entity = ${entity} AND e.subject_id <> ${subjectId} AND e.status IN ('PENDING', 'APPROVED', 'REJECTED') AND v.legal_identifier = ${value} LIMIT 1`.execute(
      tx,
    )
    if (duplicate.rows[0]) throw new BobArchiveApplicationError(errorKey)
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
            .orderBy('id')
            .forShare()
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

  private async freezeCurrentReference(
    tx: Transaction<DB>,
    entity: 'operating-entity' | 'employee',
    reference: unknown,
  ): Promise<Record<string, unknown>> {
    const objectId = String(record(reference).objectId ?? '')
    try {
      const current = await resolveAuxCurrentReference(tx, entity, objectId)
      return {
        objectId: current.objectId,
        code: current.code,
        name: current.name,
      }
    } catch (error) {
      if (error instanceof AuxApplicationError)
        throw new BobArchiveApplicationError('archive_reference_unavailable', [
          { kind: 'AUX_REFERENCE', entity, objectId },
        ])
      throw error
    }
  }

  private async freezeAuxiliaryReference(
    tx: Executor,
    reference: unknown,
    errorKey: string,
  ): Promise<Record<string, unknown>> {
    const requested = record(reference)
    const fact = (
      await this.auxFacts(tx, [
        ['settlementMethod', String(requested.id ?? '')],
      ])
    )[0]
    if (!fact || !fact.available) throw new BobArchiveApplicationError(errorKey)
    const termCode =
      typeof fact.data.termCode === 'string' ? fact.data.termCode : ''
    const ruleType =
      typeof fact.data.ruleType === 'string' ? fact.data.ruleType : ''
    const monthOffset = fact.data.monthOffset
    const dayOfMonth = fact.data.dayOfMonth
    const dayOffset = fact.data.dayOffset
    if (
      ![
        'PREPAID',
        'CASH_ON_DELIVERY',
        'ARRIVAL_3',
        'ARRIVAL_5',
        'ARRIVAL_7',
        'ARRIVAL_15',
        'ARRIVAL_30',
        'MONTHLY_CURRENT',
        'MONTHLY_30',
        'MONTHLY_60',
        'MONTHLY_90',
      ].includes(termCode) ||
      !['RELATIVE_DAYS', 'MONTH_END'].includes(ruleType) ||
      !Number.isInteger(monthOffset) ||
      !Number.isInteger(dayOfMonth) ||
      !Number.isInteger(dayOffset)
    )
      throw new BobArchiveApplicationError(errorKey)
    return {
      id: fact.objectId,
      code: fact.code,
      name: fact.name,
      termCode,
      ruleType,
      monthOffset,
      dayOfMonth,
      dayOffset,
      defaultSalesSurcharge: fixedAuxMoney(
        fact.data.defaultSalesSurcharge,
        errorKey,
      ),
    }
  }

  private async freezeAuthoritativeReferences(
    tx: Transaction<DB>,
    entity: ArchiveEntity,
    snapshot: ArchiveSnapshot,
  ): Promise<ArchiveSnapshot> {
    return {
      ...snapshot,
      ...((entity === 'supplier' || entity === 'other-unit') &&
      snapshot.settlementMethod !== null
        ? {
            settlementMethod: await this.freezeAuxiliaryReference(
              tx,
              snapshot.settlementMethod,
              `${entity.replace('-', '_')}_invalid_data`,
            ),
          }
        : {}),
      operatingEntities: await Promise.all(
        array(snapshot.operatingEntities).map((reference) =>
          this.freezeCurrentReference(tx, 'operating-entity', reference),
        ),
      ),
      ...(entity === 'supplier'
        ? {
            defaultPurchaser:
              snapshot.defaultPurchaser === null
                ? null
                : await this.freezeCurrentReference(
                    tx,
                    'employee',
                    snapshot.defaultPurchaser,
                  ),
          }
        : {}),
    }
  }

  private async registerPeopleReferences(
    tx: Transaction<DB>,
    entity: ArchiveEntity,
    submissionId: string,
    snapshot: ArchiveSnapshot,
  ): Promise<void> {
    const references: Array<[string, string]> = []
    if (
      entity === 'supplier' ||
      entity === 'other-unit' ||
      entity === 'sales-partner'
    ) {
      array(snapshot.operatingEntities).forEach((reference, index) =>
        references.push([
          `operatingEntities[${index}]`,
          String(record(reference).objectId ?? ''),
        ]),
      )
      if (entity === 'supplier' && snapshot.defaultPurchaser)
        references.push([
          'defaultPurchaser',
          String(record(snapshot.defaultPurchaser).objectId ?? ''),
        ])
    }
    for (const [field, id] of references)
      await sql`INSERT INTO aux_reference_facts(id,aux_object_id,source) VALUES (${ulid()},${id},${`${archiveDomain(entity)}:${entity}:${submissionId}:${field}`})`.execute(
        tx,
      )
  }

  private async writeSnapshot(
    tx: Executor,
    entity: ArchiveEntity,
    id: string,
    snapshot: ArchiveSnapshot,
  ): Promise<void> {
    await this.writeIdentitySet(tx, entity, id, snapshot)
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
    }
    if (entity === 'supplier')
      await tx
        .insertInto('bob_supplier_versions')
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
        .insertInto('bob_other_unit_versions')
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
        .insertInto('bob_sales_partner_versions')
        .values({ ...common, capabilities: json(array(d.capabilities)) })
        .execute()
    for (const item of array(d.operatingEntities)) {
      const ref = record(item)
      const table =
        entity === 'supplier'
          ? 'bob_supplier_version_operating_entities'
          : entity === 'other-unit'
            ? 'bob_other_unit_version_operating_entities'
            : 'bob_sales_partner_version_operating_entities'
      await sql`INSERT INTO ${sql.table(table)} (approval_entry_id,operating_entity_id,operating_entity_approval_entry_id,operating_entity_code,operating_entity_name)
        VALUES (${id},${String(ref.objectId ?? '')},NULL,${String(ref.code ?? '')},${String(ref.name ?? '')})`.execute(
        tx,
      )
    }
  }

  private async readSnapshot(
    tx: Executor,
    entity: ArchiveEntity,
    id: string,
  ): Promise<ArchiveSnapshot> {
    return this.readIdentitySet(tx, entity, id)
  }

  private async readIdentitySet(
    tx: Executor,
    entity: 'supplier' | 'other-unit' | 'sales-partner',
    id: string,
  ): Promise<ArchiveSnapshot> {
    return readBusinessIdentitySnapshot(tx, entity, id)
  }

  private async loadEntry(
    tx: Executor,
    entity: ArchiveEntity,
    submissionId: string,
    subjectId: string,
    lock: boolean,
  ): Promise<ApprovalEntry> {
    try {
      const entry = await this.approval.load(
        tx,
        {
          entryId: submissionId,
          domain: archiveDomain(entity),
          entity,
          subjectId,
        },
        lock,
      )
      if (entry.versionNo === null)
        throw new BobArchiveApplicationError('approval_not_versioned')
      return entry
    } catch (error) {
      if (error instanceof ApprovalPersistenceError)
        throw new BobArchiveApplicationError(error.errorKey)
      throw error
    }
  }

  private async readSubmission(
    tx: Executor,
    entity: ArchiveEntity,
    submissionId: string,
    actor: ApprovalActor,
  ): Promise<ArchiveSubmissionView> {
    const subjectTable = 'bob_subjects'
    const selected = await sql<{
      id: string
      subject_id: string
      version_no: number
      status: string
      revision: string | number | bigint
      submitted_by: string
      submitted_at: Date
      approved_by: string | null
      approved_at: Date | null
      rejected_by: string | null
      rejected_at: Date | null
      rejection_reason: string | null
      code: string | null
    }>`SELECT e.id, e.subject_id, e.version_no, e.status, e.revision,
              e.submitted_by, e.submitted_at, e.approved_by, e.approved_at,
              e.rejected_by, e.rejected_at, e.rejection_reason, s.code
       FROM approval_entries e
       JOIN ${sql.table(subjectTable)} s ON s.id = e.subject_id
       WHERE e.id = ${submissionId} AND e.domain = ${archiveDomain(entity)}
         AND e.entity = ${entity}`.execute(tx)
    const row = selected.rows[0]
    if (!row) throw new BobArchiveApplicationError('approval_not_found')
    const entry = await this.loadEntry(
      tx,
      entity,
      submissionId,
      row.subject_id,
      false,
    )
    return {
      entity,
      subjectId: row.subject_id,
      code: row.code,
      submissionId: row.id,
      versionNo: requiredVersionNo(row.version_no),
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
          actor.permissions.includes(archiveActionPath(entity, 'delete'))),
    }
  }

  private async ensureUnapproveAllowed(
    tx: Executor,
    entity: ArchiveEntity,
    entry: ApprovalEntry,
  ): Promise<void> {
    const scope = archiveScope(entity, entry.subjectId)
    const latest = await this.versioning.latestApproved(
      tx as Transaction<DB>,
      scope,
    )
    if (latest?.id !== entry.id)
      throw new BobArchiveApplicationError('approval_not_latest_approved')
    const open = await this.versioning.open(tx as Transaction<DB>, scope)
    if (open)
      throw new BobArchiveApplicationError('approval_open_version_exists')
    const blockers = await this.exactReferenceBlockers(tx, entry)
    if (blockers.length)
      throw new BobArchiveApplicationError(
        'approval_strong_reference_exists',
        blockers,
      )
  }

  private async exactReferenceBlockers(
    tx: Executor,
    entry: ApprovalEntry,
  ): Promise<ArchiveBlocker[]> {
    if (entry.entity !== 'other-unit') return []
    const result = await sql<{
      id: string
    }>`SELECT id FROM aux_objects WHERE entity = 'vehicle' AND data->'carrier'->>'approvalEntryId' = ${entry.id}`.execute(
      tx,
    )
    return result.rows.map((row) => ({
      kind: 'AUX_CURRENT_REFERENCE' as const,
      entity: 'vehicle' as const,
      objectId: row.id,
      field: 'carrier' as const,
      approvalEntryId: entry.id,
    }))
  }
}

function adoptedAuxFact(reference: unknown) {
  const objectId = String(record(reference).objectId ?? '')
  return { objectId, enabled: objectId.length > 0 }
}
