import { createHash } from 'node:crypto'

import {
  availableApprovalActions,
  decideApproval,
  prepareAccMappingSubmit,
  prepareRptDefinitionSubmit,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
  type ReferenceBlocker,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'

import type { ArchiveEntity as DclArchiveEntity } from './archive-contract.ts'

type ArchiveEntity = DclArchiveEntity
import type { DB, JsonValue } from '../db/generated.ts'
import {
  ApprovalPersistence,
  ApprovalPersistenceError,
} from '../platform/approval.ts'
import {
  VersionedArchives,
  VersionedArchiveError,
  type VersionedArchiveScope,
} from '../platform/versioned-archives.ts'
import type {
  RptColumn,
  RptDefinition,
  RptDefinitionValidator,
  RptParameter,
} from '../rpt/service.ts'

export type ArchiveExecutor = Kysely<DB> | Transaction<DB>
type Executor = ArchiveExecutor
export type ArchiveSnapshot = Record<string, unknown>

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
  enabled?: boolean
  latestApproved: ArchiveSubmissionView | null
  openCandidate: ArchiveSubmissionView | null
}

export type ArchiveBlocker =
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
  const keyword = filters.keyword
  if (keyword) {
    const data = record(snapshot)
    const keywordMatches =
      entity === 'acc-mapping'
        ? includesKeyword(keyword, [
            nullable(record(data.book).code),
            nullable(record(data.book).name),
            nullable(record(data.vouEntity).code),
            nullable(record(data.vouEntity).name),
          ])
        : includesKeyword(keyword, [
            code,
            nullable(data.name),
            nullable(data.description),
          ])
    if (!keywordMatches) return false
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
  'acc-mapping': '',
  'rpt-definition': 'rpt',
}

type ArchiveDomain = 'dcl'

export function archiveDomain(_entity: ArchiveEntity): ArchiveDomain {
  return 'dcl'
}

function archiveScope(
  entity: ArchiveEntity,
  subjectId: string,
): VersionedArchiveScope<ArchiveDomain, ArchiveEntity> {
  return { domain: 'dcl', entity, subjectId }
}

function archiveActionPath(entity: ArchiveEntity, action: string): string {
  return `/dcl/${entity}/${action}`
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

function requiredVersionNo(value: number | null): number {
  if (value === null)
    throw new ArchiveApplicationError('archive_invalid_history')
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
export class ArchiveService {
  private readonly db: Kysely<DB>
  private readonly rptValidator: RptDefinitionValidator
  private readonly approval = new ApprovalPersistence()
  private readonly versioning = new VersionedArchives()

  constructor(db: Kysely<DB>, rptValidator: RptDefinitionValidator) {
    this.db = db
    this.rptValidator = rptValidator
  }

  async query(
    entity: ArchiveEntity,
    input: ArchiveQueryInput,
    actor: ApprovalActor,
  ): Promise<{ items: ArchiveQueryView[]; total: number }> {
    requirePermission(actor, archiveActionPath(entity, 'query'))
    const subjectTable = 'dcl_subjects'
    const selected = await sql<{
      id: string
      subject_id: string
      version_no: number
      status: string
      code: string | null
      subject_enabled: boolean | null
    }>`SELECT e.id, e.subject_id, e.version_no, e.status, s.code
              , ${sql`NULL::boolean`} AS subject_enabled
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
        ...(row.subject_enabled === null
          ? {}
          : { enabled: row.subject_enabled }),
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
          ...(subject.enabled === undefined
            ? {}
            : { enabled: subject.enabled }),
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
        if (!entry) throw new ArchiveApplicationError('approval_not_found')
        return this.readSubmission(tx, entity, entry.id, actor)
      })
    } catch (error) {
      if (error instanceof VersionedArchiveError)
        throw new ArchiveApplicationError(error.errorKey)
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
        throw new ArchiveApplicationError(error.errorKey)
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
    const subjectTable = 'dcl_subjects'
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
            throw new ArchiveApplicationError('archive_idempotency_conflict')
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
          snapshot: input.snapshot,
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
          throw new ArchiveApplicationError(
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
          if (entity === 'acc-mapping') code = null
          else {
            const counter = await tx
              .updateTable('archive_code_counters')
              .set((eb) => ({ next_value: eb('next_value', '+', 1) }))
              .where('entity', '=', entity)
              .returning('next_value')
              .executeTakeFirstOrThrow()
            const digits = entity === 'rpt-definition' ? 6 : 4
            code = `${entityCodes[entity]}-${String(counter.next_value - 1).padStart(digits, '0')}`
          }
          await tx
            .insertInto(subjectTable)
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
      if (error instanceof ArchiveApplicationError) throw error
      if (error instanceof VersionedArchiveError)
        throw new ArchiveApplicationError(error.errorKey)
      if (pgCode(error) === '23505')
        throw new ArchiveApplicationError('archive_conflict')
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
    if (action === 'approve' && entity === 'rpt-definition') {
      const entry = await this.loadEntry(
        this.db,
        entity,
        input.submissionId,
        input.subjectId,
        false,
      )
      const preflight = decideApproval({
        action,
        entry,
        actor,
        expectedRevision: input.expectedRevision,
        occurredAt: new Date().toISOString(),
        requestId,
      })
      if (!preflight.ok)
        throw new ArchiveApplicationError(preflight.error.errorKey)
      await this.validateReport(this.db, input.submissionId, actor.id)
    }
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
        const updatedEntry = await this.approval.transition(tx, {
          action,
          entry,
          actor,
          expectedRevision: input.expectedRevision,
          occurredAt,
          requestId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        })
        if (entity === 'acc-mapping') {
          if (updatedEntry.status === 'APPROVED')
            await this.syncAccMappingSubjectUsages(tx, entry.id)
          else if (entry.status === 'APPROVED')
            await sql`DELETE FROM dcl_acc_mapping_subject_usages
            WHERE approval_entry_id = ${entry.id}`.execute(tx)
        }
        if (
          entity === 'rpt-definition' &&
          (updatedEntry.status === 'APPROVED' || entry.status === 'APPROVED')
        )
          await this.syncRptPermissions(tx, entry.subjectId, actor.id)
        return this.readSubmission(tx, entity, entry.id, actor)
      })
    } catch (error) {
      if (error instanceof ApprovalPersistenceError)
        throw new ArchiveApplicationError(error.errorKey)
      if (error instanceof VersionedArchiveError)
        throw new ArchiveApplicationError(error.errorKey)
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
            .deleteFrom('dcl_subjects')
            .where('id', '=', entry.subjectId)
            .execute()
        return { submissionId: entry.id, deleted: true as const }
      })
    } catch (error) {
      if (error instanceof ApprovalPersistenceError)
        throw new ArchiveApplicationError(error.errorKey)
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

  private async ensureNoDuplicateBusinessKey(
    tx: Executor,
    entity: ArchiveEntity,
    subjectId: string,
    data: ArchiveSnapshot,
  ): Promise<void> {
    switch (entity) {
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

  private async writeSnapshot(
    tx: Executor,
    entity: ArchiveEntity,
    id: string,
    snapshot: ArchiveSnapshot,
  ): Promise<void> {
    const d = snapshot
    switch (entity) {
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

  private async readSnapshot(
    tx: Executor,
    entity: ArchiveEntity,
    id: string,
  ): Promise<ArchiveSnapshot> {
    // Each aggregate rehydrates its own version row. JSON fields retain exact submitted reference snapshots.
    switch (entity) {
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
        throw new ArchiveApplicationError('approval_not_versioned')
      return entry
    } catch (error) {
      if (error instanceof ApprovalPersistenceError)
        throw new ArchiveApplicationError(error.errorKey)
      throw error
    }
  }

  private async readSubmission(
    tx: Executor,
    entity: ArchiveEntity,
    submissionId: string,
    actor: ApprovalActor,
  ): Promise<ArchiveSubmissionView> {
    const subjectTable = 'dcl_subjects'
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
    const scope = archiveScope(entity, entry.subjectId)
    const latest = await this.versioning.latestApproved(
      tx as Transaction<DB>,
      scope,
    )
    if (latest?.id !== entry.id)
      throw new ArchiveApplicationError('approval_not_latest_approved')
    const open = await this.versioning.open(tx as Transaction<DB>, scope)
    if (open) throw new ArchiveApplicationError('approval_open_version_exists')
    const blockers =
      entry.entity === 'acc-mapping'
        ? await this.accMappingReferenceBlockers(tx, entry.id)
        : []
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

  private async validateReport(
    executor: Executor,
    submissionId: string,
    actorId: string,
  ): Promise<void> {
    const snapshot = await this.readSnapshot(
      executor,
      'rpt-definition',
      submissionId,
    )
    const entry = await executor
      .selectFrom('approval_entries as e')
      .innerJoin('dcl_subjects as s', 's.id', 'e.subject_id')
      .select(['e.subject_id', 's.code'])
      .where('e.id', '=', submissionId)
      .where('e.domain', '=', 'dcl')
      .where('e.entity', '=', 'rpt-definition')
      .executeTakeFirstOrThrow()
    if (!entry.code)
      throw new ArchiveApplicationError('archive_invalid_history')
    const definition: RptDefinition = {
      subjectId: entry.subject_id,
      approvalEntryId: submissionId,
      code: entry.code,
      name: String(snapshot.name ?? ''),
      sql: String(snapshot.sql ?? ''),
      parameters: array(snapshot.parameters) as RptParameter[],
      columns: array(snapshot.columns) as RptColumn[],
    }
    let diagnostic: string | null = null
    try {
      await this.rptValidator.validate(definition)
    } catch (error) {
      diagnostic =
        error instanceof Error
          ? error.message.slice(0, 2000)
          : 'Invalid report query.'
    }
    const validatedAt = new Date()
    await executor
      .insertInto('rpt_definition_validities')
      .values({
        approval_entry_id: submissionId,
        status: diagnostic === null ? 'VALID' : 'INVALID',
        diagnostic,
        validated_at: validatedAt,
        validated_by: actorId,
      })
      .onConflict((oc) =>
        oc.column('approval_entry_id').doUpdateSet({
          status: diagnostic === null ? 'VALID' : 'INVALID',
          diagnostic,
          validated_at: validatedAt,
          validated_by: actorId,
        }),
      )
      .execute()
    if (diagnostic !== null)
      throw new ArchiveApplicationError('rpt_definition_invalid')
  }

  private async syncRptPermissions(
    tx: Transaction<DB>,
    subjectId: string,
    actorId: string,
  ) {
    const subject = await tx
      .selectFrom('dcl_subjects')
      .select('code')
      .where('id', '=', subjectId)
      .where('entity', '=', 'rpt-definition')
      .executeTakeFirstOrThrow()
    if (!subject.code)
      throw new ArchiveApplicationError('archive_invalid_history')
    const current = await tx
      .selectFrom('approval_entries as e')
      .innerJoin(
        'dcl_rpt_definition_versions as v',
        'v.approval_entry_id',
        'e.id',
      )
      .leftJoin(
        'rpt_definition_validities as validity',
        'validity.approval_entry_id',
        'e.id',
      )
      .select(['v.name', 'v.enabled', 'validity.status as validity'])
      .where('e.domain', '=', 'dcl')
      .where('e.entity', '=', 'rpt-definition')
      .where('e.subject_id', '=', subjectId)
      .where('e.status', '=', 'APPROVED')
      .orderBy('e.version_no', 'desc')
      .executeTakeFirst()
    const status =
      current?.enabled === true && current.validity === 'VALID'
        ? ('ENABLED' as const)
        : ('DISABLED' as const)
    const description = current?.name || subject.code
    for (const action of ['query', 'export'] as const) {
      const path = `/rpt/${subject.code}/${action}`
      const id = `01J${createHash('sha256').update(path).digest('hex').slice(0, 23).toUpperCase()}`
      await tx
        .insertInto('app_permissions')
        .values({
          id,
          path,
          domain: 'rpt',
          entity: subject.code,
          action,
          description,
          status,
          created_by: actorId,
          updated_by: actorId,
        })
        .onConflict((conflict) =>
          conflict.column('path').doUpdateSet({
            status,
            description,
            updated_at: new Date(),
            updated_by: actorId,
          }),
        )
        .execute()
    }
  }
}
