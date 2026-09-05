import { createHash } from 'node:crypto'

import {
  availableApprovalActions,
  decideApproval,
  prepareWarehouseSubmit,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
  type WarehouseData,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { DB, JsonValue } from '../db/generated.ts'

type Executor = Kysely<DB> | Transaction<DB>

export interface WarehouseWireSnapshot {
  name: string
  address: string | null
  contactName: string | null
  contactPhone: string | null
  managerEmployeeId: string | null
  managerEmployeeApprovalEntryId: string | null
  managerEmployeeCode: string | null
  managerEmployeeName: string | null
  remark: string | null
  enabled: boolean
}

export interface WarehouseSubmitInput {
  subjectId: string
  submissionId: string
  idempotencyKey: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
  snapshot: WarehouseWireSnapshot
}

export interface WarehouseReviewInput {
  subjectId: string
  submissionId: string
  expectedRevision: string
  reason?: string
}

export interface WarehouseSubmissionView {
  subjectId: string
  code: string
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
  snapshot: WarehouseWireSnapshot
  availableApprovalActions: ReturnType<typeof availableApprovalActions>
  canDelete: boolean
}

export type WarehouseSubmissionListItem = Omit<
  WarehouseSubmissionView,
  'snapshot'
>

export interface WarehouseQueryView {
  entity: 'warehouse'
  subjectId: string
  code: string
  name: string
  enabled: boolean
  managerName: string | null
  latestApproved: WarehouseSubmissionListItem | null
  openCandidate: WarehouseSubmissionListItem | null
}

function warehouseSubmissionListItem(
  submission: WarehouseSubmissionView,
): WarehouseSubmissionListItem {
  const { snapshot: _snapshot, ...item } = submission
  return item
}

export interface WarehouseQueryInput {
  page: number
  pageSize: 20
  filters: {
    keyword?: string
    status?: ApprovalStatus
    enabled?: boolean
  }
}

interface WarehouseReferenceBlockerData {
  references: Array<{
    domain: string
    entity: string
    businessId: string
    businessCode: string
  }>
}

interface WarehouseFieldBlockerData {
  fieldBlockers: Array<{
    field: 'manager'
    objectId: string
    expectedApprovalEntryId: string
    currentApprovalEntryId?: string
  }>
}

interface WarehouseDisableBlockerData {
  inventory: Array<Record<string, unknown>>
  documents: Array<Record<string, unknown>>
  sources: Array<Record<string, unknown>>
  references: Array<Record<string, unknown>>
}

type WarehouseFailureData =
  | WarehouseReferenceBlockerData
  | WarehouseFieldBlockerData
  | WarehouseDisableBlockerData
  | null

export class WarehouseApplicationError extends Error {
  readonly errorKey: string
  readonly data: WarehouseFailureData

  constructor(errorKey: string, data: WarehouseFailureData = null) {
    super(errorKey)
    this.name = 'WarehouseApplicationError'
    this.errorKey = errorKey
    this.data = data
  }
}

function asNullable(value: string): string | null {
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function toModelData(snapshot: WarehouseWireSnapshot): WarehouseData {
  const hasManager = [
    snapshot.managerEmployeeId,
    snapshot.managerEmployeeApprovalEntryId,
    snapshot.managerEmployeeCode,
    snapshot.managerEmployeeName,
  ].some((value) => value !== null)
  const manager = hasManager
    ? {
        employeeId: snapshot.managerEmployeeId ?? '',
        approvalEntryId: snapshot.managerEmployeeApprovalEntryId ?? '',
        code: snapshot.managerEmployeeCode ?? '',
        displayName: snapshot.managerEmployeeName ?? '',
      }
    : undefined
  return {
    name: snapshot.name,
    address: snapshot.address ?? '',
    contactName: snapshot.contactName ?? '',
    contactPhone: snapshot.contactPhone ?? '',
    ...(manager ? { manager } : {}),
    remark: snapshot.remark ?? '',
    enabled: snapshot.enabled,
  }
}

function hashRequest(action: string, input: WarehouseSubmitInput): string {
  const snapshot = input.snapshot
  return createHash('sha256')
    .update(
      JSON.stringify({
        action,
        subjectId: input.subjectId.trim(),
        submissionId: input.submissionId.trim(),
        idempotencyKey: input.idempotencyKey.trim(),
        expectedLatestApprovedSubmissionId:
          input.expectedLatestApprovedSubmissionId?.trim() ?? null,
        expectedLatestApprovedRevision:
          input.expectedLatestApprovedRevision?.replace(/^0+(?=\d)/, '') ??
          null,
        snapshot: {
          name: snapshot.name.trim(),
          address: asNullable(snapshot.address ?? ''),
          contactName: asNullable(snapshot.contactName ?? ''),
          contactPhone: asNullable(snapshot.contactPhone ?? ''),
          managerEmployeeId: asNullable(snapshot.managerEmployeeId ?? ''),
          managerEmployeeApprovalEntryId: asNullable(
            snapshot.managerEmployeeApprovalEntryId ?? '',
          ),
          remark: asNullable(snapshot.remark ?? ''),
          enabled: snapshot.enabled,
        },
      }),
    )
    .digest('hex')
}

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

function requirePermission(actor: ApprovalActor, permission: string): void {
  if (actor.trusted !== true && !actor.permissions.includes(permission))
    throw new WarehouseApplicationError('forbidden')
}

function requiredWarehouseCode(value: string | null): string {
  if (!value) throw new WarehouseApplicationError('warehouse_invalid_history')
  return value
}

function requiredVersionNo(value: number | null): number {
  if (value === null)
    throw new WarehouseApplicationError('warehouse_invalid_history')
  return value
}

export class WarehouseService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async query(
    input: WarehouseQueryInput,
    actor: ApprovalActor,
  ): Promise<{
    items: WarehouseQueryView[]
    total: number
    page: number
    pageSize: 20
  }> {
    requirePermission(actor, '/dcl/warehouse/query')
    const keyword = input.filters.keyword?.trim() ?? null
    const status = input.filters.status ?? null
    const enabled = input.filters.enabled ?? null
    const summaries = sql<{
      subject_id: string
      code: string
      latest_approved_id: string | null
      open_candidate_id: string | null
      name: string
      enabled: boolean
      manager_name: string | null
    }>`
      WITH latest_approved AS (
        SELECT DISTINCT ON (subject_id) *
        FROM approval_entries
        WHERE domain = 'dcl' AND entity = 'warehouse' AND status = 'APPROVED'
        ORDER BY subject_id, version_no DESC
      ), open_candidate AS (
        SELECT DISTINCT ON (subject_id) *
        FROM approval_entries
        WHERE domain = 'dcl'
          AND entity = 'warehouse'
          AND status IN ('PENDING', 'REJECTED')
        ORDER BY subject_id, version_no DESC
      )
      SELECT
        s.id AS subject_id,
        s.code,
        approved.id AS latest_approved_id,
        candidate.id AS open_candidate_id,
        CASE WHEN candidate.id IS NOT NULL
          THEN candidate_version.name ELSE approved_version.name END AS name,
        CASE WHEN candidate.id IS NOT NULL
          THEN candidate_version.enabled ELSE approved_version.enabled END AS enabled,
        CASE WHEN candidate.id IS NOT NULL
          THEN candidate_version.manager_employee_name
          ELSE approved_version.manager_employee_name END AS manager_name
      FROM dcl_subjects s
      LEFT JOIN latest_approved approved ON approved.subject_id = s.id
      LEFT JOIN dcl_warehouse_versions approved_version
        ON approved_version.approval_entry_id = approved.id
      LEFT JOIN open_candidate candidate ON candidate.subject_id = s.id
      LEFT JOIN dcl_warehouse_versions candidate_version
        ON candidate_version.approval_entry_id = candidate.id
      WHERE s.entity = 'warehouse'
        AND (approved.id IS NOT NULL OR candidate.id IS NOT NULL)
        AND (
          (
            approved.id IS NOT NULL
            AND (${status}::text IS NULL OR approved.status = ${status})
            AND (${enabled}::boolean IS NULL OR approved_version.enabled = ${enabled})
            AND (
              ${keyword}::text IS NULL
              OR lower(concat_ws(' ', s.code, approved_version.name,
                approved_version.address, approved_version.contact_name,
                approved_version.contact_phone,
                approved_version.manager_employee_code,
                approved_version.manager_employee_name))
                LIKE '%' || lower(${keyword}) || '%'
            )
          )
          OR (
            candidate.id IS NOT NULL
            AND (${status}::text IS NULL OR candidate.status = ${status})
            AND (${enabled}::boolean IS NULL OR candidate_version.enabled = ${enabled})
            AND (
              ${keyword}::text IS NULL
              OR lower(concat_ws(' ', s.code, candidate_version.name,
                candidate_version.address, candidate_version.contact_name,
                candidate_version.contact_phone,
                candidate_version.manager_employee_code,
                candidate_version.manager_employee_name))
                LIKE '%' || lower(${keyword}) || '%'
            )
          )
        )
    `
    const count = await sql<{ count: string }>`
      WITH filtered AS (${summaries})
      SELECT count(*)::text AS count FROM filtered
    `.execute(this.db)
    const offset = (input.page - 1) * input.pageSize
    const result = await sql<{
      subject_id: string
      code: string
      latest_approved_id: string | null
      open_candidate_id: string | null
      name: string
      enabled: boolean
      manager_name: string | null
    }>`
      WITH filtered AS (${summaries})
      SELECT * FROM filtered
      ORDER BY code ASC, subject_id ASC
      LIMIT ${input.pageSize} OFFSET ${offset}
    `.execute(this.db)
    const items = await Promise.all(
      result.rows.map(async (row) => {
        const [latestApproved, openCandidate] = await Promise.all([
          row.latest_approved_id
            ? this.readSubmission(this.db, row.latest_approved_id, actor)
            : null,
          row.open_candidate_id
            ? this.readSubmission(this.db, row.open_candidate_id, actor)
            : null,
        ])
        return {
          entity: 'warehouse',
          subjectId: row.subject_id,
          code: row.code,
          name: row.name,
          enabled: row.enabled,
          managerName: row.manager_name,
          latestApproved: latestApproved
            ? warehouseSubmissionListItem(latestApproved)
            : null,
          openCandidate: openCandidate
            ? warehouseSubmissionListItem(openCandidate)
            : null,
        } satisfies WarehouseQueryView
      }),
    )
    return {
      items,
      total: Number(count.rows[0]?.count ?? 0),
      page: input.page,
      pageSize: input.pageSize,
    }
  }

  async get(
    subjectId: string,
    actor: ApprovalActor,
  ): Promise<WarehouseSubmissionView> {
    requirePermission(actor, '/dcl/warehouse/get')
    const result = await sql<{ id: string }>`
      SELECT id
      FROM approval_entries
      WHERE domain = 'dcl' AND entity = 'warehouse' AND subject_id = ${subjectId}
      ORDER BY
        CASE WHEN status IN ('PENDING', 'REJECTED') THEN 0 ELSE 1 END,
        version_no DESC
      LIMIT 1
    `.execute(this.db)
    const row = result.rows[0]
    if (!row) throw new WarehouseApplicationError('approval_not_found')
    return this.readSubmission(this.db, row.id, actor)
  }

  async versions(
    subjectId: string,
    actor: ApprovalActor,
  ): Promise<WarehouseSubmissionView[]> {
    requirePermission(actor, '/dcl/warehouse/versions')
    const rows = await this.db
      .selectFrom('approval_entries')
      .select('id')
      .where('domain', '=', 'dcl')
      .where('entity', '=', 'warehouse')
      .where('subject_id', '=', subjectId)
      .orderBy('version_no', 'desc')
      .execute()
    return Promise.all(
      rows.map((row) => this.readSubmission(this.db, row.id, actor)),
    )
  }

  async auditHistory(subjectId: string, actor: ApprovalActor) {
    requirePermission(actor, '/dcl/warehouse/audit-history')
    const rows = await this.db
      .selectFrom('approval_events')
      .selectAll()
      .where('domain', '=', 'dcl')
      .where('entity', '=', 'warehouse')
      .where('subject_id', '=', subjectId)
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute()
    return rows.map((row) => ({
      id: row.id,
      submissionId: row.entry_id,
      versionNo: requiredVersionNo(row.version_no),
      action: row.action as
        | 'SUBMITTED'
        | 'APPROVED'
        | 'REJECTED'
        | 'UNREJECTED'
        | 'UNAPPROVED'
        | 'DELETED',
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

  async reference(search: string | undefined, actor: ApprovalActor) {
    requirePermission(actor, '/bob/warehouse/reference')
    const pattern = '%' + (search?.trim() ?? '') + '%'
    const result = await sql<{
      subject_id: string
      approval_entry_id: string
      version_no: number
      code: string
      name: string
      enabled: boolean
    }>`
      SELECT DISTINCT ON (e.subject_id)
        e.subject_id,
        e.id AS approval_entry_id,
        e.version_no,
        s.code,
        w.name,
        w.enabled
      FROM approval_entries e
      JOIN dcl_subjects s ON s.id = e.subject_id
      JOIN dcl_warehouse_versions w ON w.approval_entry_id = e.id
      WHERE e.domain = 'dcl'
        AND e.entity = 'warehouse'
        AND e.status = 'APPROVED'
        AND w.enabled
        AND (s.code ILIKE ${pattern} OR w.name ILIKE ${pattern})
      ORDER BY e.subject_id, e.version_no DESC
    `.execute(this.db)
    return result.rows.map((row) => ({
      subjectId: row.subject_id,
      approvalEntryId: row.approval_entry_id,
      versionNo: requiredVersionNo(row.version_no),
      code: row.code,
      name: row.name,
      enabled: true as const,
    }))
  }

  async managerReference(
    employeeId: string,
    action: 'submit-new' | 'submit-change',
    actor: ApprovalActor,
  ) {
    requirePermission(actor, `/dcl/warehouse/${action}`)
    return this.currentManagerReference(this.db, employeeId.trim())
  }

  async submit(
    action: 'submit-new' | 'submit-change',
    input: WarehouseSubmitInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<WarehouseSubmissionView> {
    requirePermission(actor, '/dcl/warehouse/' + action)
    const idempotencyKey = input.idempotencyKey.trim()
    const expectedLatestApprovedRevision =
      input.expectedLatestApprovedRevision?.replace(/^0+(?=\d)/, '') ?? null
    const requestHash = hashRequest(action, input)
    try {
      return await this.db.transaction().execute(async (transaction) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`.execute(
          transaction,
        )
        const previous = await transaction
          .selectFrom('dcl_warehouse_idempotency')
          .select(['request_hash', 'response'])
          .where('idempotency_key', '=', idempotencyKey)
          .executeTakeFirst()
        if (previous) {
          if (previous.request_hash !== requestHash)
            throw new WarehouseApplicationError(
              'warehouse_idempotency_conflict',
            )
          return previous.response as unknown as WarehouseSubmissionView
        }

        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${
          'dcl:warehouse:' + input.subjectId
        }, 0))`.execute(transaction)
        const subject = await transaction
          .selectFrom('dcl_subjects')
          .select('id')
          .where('id', '=', input.subjectId)
          .executeTakeFirst()
        const history = await transaction
          .selectFrom('approval_entries')
          .select(['id', 'version_no', 'status', 'revision'])
          .where('domain', '=', 'dcl')
          .where('entity', '=', 'warehouse')
          .where('subject_id', '=', input.subjectId)
          .orderBy('version_no', 'asc')
          .forUpdate()
          .execute()
        let manager:
          | {
              employeeId: string
              latestApprovedEntryId: string
              code: string
              displayName: string
              enabled: boolean
            }
          | undefined
        if (input.snapshot.managerEmployeeId) {
          manager =
            (await this.currentManagerReference(
              transaction,
              input.snapshot.managerEmployeeId,
            )) ?? undefined
        }
        const occurredAt = new Date().toISOString()
        const decision = prepareWarehouseSubmit(
          {
            action,
            actor,
            requestId,
            occurredAt,
            submissionId: input.submissionId,
            idempotencyKey,
            subjectId: input.subjectId,
            expectedLatestApprovedSubmissionId:
              input.expectedLatestApprovedSubmissionId,
            expectedLatestApprovedRevision,
            data: toModelData(input.snapshot),
          },
          {
            subject: {
              exists: subject !== undefined,
              history: history.map((row) => ({
                entryId: row.id,
                versionNo: requiredVersionNo(row.version_no),
                status: row.status as ApprovalStatus,
                revision: String(row.revision),
              })),
            },
            ...(manager ? { manager } : {}),
          },
        )
        if (!decision.ok)
          throw new WarehouseApplicationError(
            decision.error.errorKey,
            decision.error.blockers
              ? { fieldBlockers: decision.error.blockers }
              : null,
          )
        const plan = decision.plan
        let code: string
        if (plan.createSubject) {
          const counter = await transaction
            .updateTable('dcl_code_counters')
            .set((builder) => ({
              next_value: builder('next_value', '+', 1),
            }))
            .where('entity', '=', 'warehouse')
            .returning('next_value')
            .executeTakeFirstOrThrow()
          code = 'WHS-' + String(counter.next_value - 1).padStart(4, '0')
          await transaction
            .insertInto('dcl_subjects')
            .values({
              id: plan.subjectId,
              entity: 'warehouse',
              code,
              created_at: new Date(occurredAt),
              created_by: actor.id,
            })
            .execute()
        } else {
          const current = await transaction
            .selectFrom('dcl_subjects')
            .select('code')
            .where('id', '=', plan.subjectId)
            .executeTakeFirstOrThrow()
          code = requiredWarehouseCode(current.code)
        }
        await transaction
          .insertInto('approval_entries')
          .values({
            id: plan.submissionId,
            domain: 'dcl',
            entity: 'warehouse',
            subject_id: plan.subjectId,
            version_no: plan.versionNo,
            status: 'PENDING',
            revision: '1',
            submitted_by: actor.id,
            submitted_at: new Date(occurredAt),
            approved_by: null,
            approved_at: null,
            rejected_by: null,
            rejected_at: null,
            rejection_reason: null,
            updated_by: actor.id,
            updated_at: new Date(occurredAt),
          })
          .execute()
        await transaction
          .insertInto('dcl_warehouse_versions')
          .values({
            approval_entry_id: plan.submissionId,
            name: plan.data.name,
            address: asNullable(plan.data.address),
            contact_name: asNullable(plan.data.contactName),
            contact_phone: asNullable(plan.data.contactPhone),
            manager_employee_id: plan.data.manager?.employeeId ?? null,
            manager_employee_approval_entry_id:
              plan.data.manager?.approvalEntryId ?? null,
            manager_employee_code: plan.data.manager?.code ?? null,
            manager_employee_name: plan.data.manager?.displayName ?? null,
            remark: asNullable(plan.data.remark),
            enabled: plan.data.enabled,
          })
          .execute()
        await transaction
          .insertInto('approval_events')
          .values({
            id: ulid(),
            entry_id: plan.submissionId,
            domain: 'dcl',
            entity: 'warehouse',
            subject_id: plan.subjectId,
            version_no: plan.versionNo,
            action: 'SUBMITTED',
            from_status: null,
            to_status: 'PENDING',
            from_revision: null,
            to_revision: '1',
            actor_id: actor.id,
            reason: null,
            request_id: requestId,
            created_at: new Date(occurredAt),
          })
          .execute()
        const view = await this.readSubmission(
          transaction,
          plan.submissionId,
          actor,
        )
        await transaction
          .insertInto('dcl_warehouse_idempotency')
          .values({
            idempotency_key: plan.idempotencyKey,
            request_hash: requestHash,
            subject_id: plan.subjectId,
            submission_id: plan.submissionId,
            response: view as unknown as JsonValue,
            created_at: new Date(occurredAt),
          })
          .execute()
        return view
      })
    } catch (error) {
      if (error instanceof WarehouseApplicationError) throw error
      if (pgCode(error) === '23505')
        throw new WarehouseApplicationError('warehouse_conflict')
      throw error
    }
  }

  async review(
    action: 'approve' | 'reject' | 'unreject' | 'unapprove',
    input: WarehouseReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<WarehouseSubmissionView> {
    requirePermission(actor, '/dcl/warehouse/' + action)
    return this.db.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${
        'dcl:warehouse:' + input.subjectId
      }, 0))`.execute(transaction)
      const entry = await this.loadApprovalEntry(
        transaction,
        input.submissionId,
        input.subjectId,
        true,
      )
      if (action === 'unapprove') {
        const latestApproved = await transaction
          .selectFrom('approval_entries')
          .select('id')
          .where('subject_id', '=', input.subjectId)
          .where('status', '=', 'APPROVED')
          .orderBy('version_no', 'desc')
          .executeTakeFirst()
        if (latestApproved?.id !== input.submissionId)
          throw new WarehouseApplicationError('approval_not_latest_approved')
        const open = await transaction
          .selectFrom('approval_entries')
          .select('id')
          .where('subject_id', '=', input.subjectId)
          .where('status', 'in', ['PENDING', 'REJECTED'])
          .executeTakeFirst()
        if (open)
          throw new WarehouseApplicationError('approval_open_version_exists')
        const references = await transaction
          .selectFrom('dcl_warehouse_reference_facts')
          .select(['domain', 'entity', 'business_id', 'business_code'])
          .where('approval_entry_id', '=', input.submissionId)
          .execute()
        if (references.length > 0)
          throw new WarehouseApplicationError('warehouse_unapprove_blocked', {
            references: references.map((row) => ({
              domain: row.domain,
              entity: row.entity,
              businessId: row.business_id,
              businessCode: row.business_code,
            })),
          })
      }
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
        throw new WarehouseApplicationError(decision.error.errorKey)
      const plan = decision.plan
      if (
        (action === 'approve' &&
          !(await this.snapshotEnabled(transaction, input.submissionId))) ||
        (action === 'unapprove' &&
          !(await this.previousApprovedEnabled(
            transaction,
            input.subjectId,
            entry.versionNo ?? 0,
          )))
      )
        await this.ensureNoDisableBlockers(transaction, input.subjectId)

      const updated = await transaction
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
        .where('id', '=', input.submissionId)
        .where('revision', '=', String(plan.fromRevision))
        .executeTakeFirst()
      if (Number(updated.numUpdatedRows) !== 1)
        throw new WarehouseApplicationError('approval_stale_revision')
      await transaction
        .insertInto('approval_events')
        .values({
          id: ulid(),
          entry_id: input.submissionId,
          domain: 'dcl',
          entity: 'warehouse',
          subject_id: input.subjectId,
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
      return this.readSubmission(transaction, input.submissionId, actor)
    })
  }

  async delete(
    input: Omit<WarehouseReviewInput, 'reason'>,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<{ submissionId: string; deleted: true }> {
    requirePermission(actor, '/dcl/warehouse/delete')
    return this.db.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${
        'dcl:warehouse:' + input.subjectId
      }, 0))`.execute(transaction)
      const entry = await this.loadApprovalEntry(
        transaction,
        input.submissionId,
        input.subjectId,
        true,
      )
      if (entry.revision !== input.expectedRevision)
        throw new WarehouseApplicationError('approval_stale_revision')
      if (entry.status !== 'PENDING' && entry.status !== 'REJECTED')
        throw new WarehouseApplicationError('approval_invalid_transition')
      if (entry.metadata.submitted.actorId !== actor.id)
        throw new WarehouseApplicationError('approval_invalid_actor')
      const references = await transaction
        .selectFrom('dcl_warehouse_reference_facts')
        .select('id')
        .where('approval_entry_id', '=', input.submissionId)
        .executeTakeFirst()
      if (references)
        throw new WarehouseApplicationError('warehouse_delete_blocked')
      const occurredAt = new Date()
      await transaction
        .insertInto('approval_events')
        .values({
          id: ulid(),
          entry_id: input.submissionId,
          domain: 'dcl',
          entity: 'warehouse',
          subject_id: input.subjectId,
          version_no: entry.versionNo ?? 1,
          action: 'DELETED',
          from_status: entry.status,
          to_status: null,
          from_revision: entry.revision,
          to_revision: null,
          actor_id: actor.id,
          reason: null,
          request_id: requestId,
          created_at: occurredAt,
        })
        .execute()
      const deleted = await transaction
        .deleteFrom('approval_entries')
        .where('id', '=', input.submissionId)
        .where('revision', '=', entry.revision)
        .executeTakeFirst()
      if (Number(deleted.numDeletedRows) !== 1)
        throw new WarehouseApplicationError('approval_stale_revision')
      const remaining = await transaction
        .selectFrom('approval_entries')
        .select('id')
        .where('subject_id', '=', input.subjectId)
        .executeTakeFirst()
      if (!remaining)
        await transaction
          .deleteFrom('dcl_subjects')
          .where('id', '=', input.subjectId)
          .execute()
      return { submissionId: input.submissionId, deleted: true as const }
    })
  }

  private async loadApprovalEntry(
    executor: Executor,
    submissionId: string,
    subjectId: string,
    lock: boolean,
  ): Promise<ApprovalEntry> {
    let query = executor
      .selectFrom('approval_entries')
      .selectAll()
      .where('id', '=', submissionId)
      .where('subject_id', '=', subjectId)
    if (lock) query = query.forUpdate()
    const row = await query.executeTakeFirst()
    if (!row) throw new WarehouseApplicationError('approval_not_found')
    return {
      id: row.id,
      domain: row.domain,
      entity: row.entity,
      subjectId: row.subject_id,
      versionNo: requiredVersionNo(row.version_no),
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

  private async currentManagerReference(
    executor: Executor,
    employeeId: string,
  ): Promise<{
    employeeId: string
    latestApprovedEntryId: string
    code: string
    displayName: string
    enabled: boolean
  } | null> {
    const row = await sql<{
      employee_id: string
      latest_approved_entry_id: string
      code: string
      display_name: string
      enabled: boolean
    }>`
      SELECT e.subject_id AS employee_id,
        e.id AS latest_approved_entry_id,
        s.code,
        v.display_name,
        v.enabled
      FROM approval_entries e
      JOIN dcl_subjects s ON s.id = e.subject_id
      JOIN dcl_employee_versions v ON v.approval_entry_id = e.id
      WHERE e.domain = 'dcl'
        AND e.entity = 'employee'
        AND e.subject_id = ${employeeId}
        AND e.status = 'APPROVED'
      ORDER BY e.version_no DESC
      LIMIT 1
    `.execute(executor)
    const current = row.rows[0]
    return current
      ? {
          employeeId: current.employee_id,
          latestApprovedEntryId: current.latest_approved_entry_id,
          code: current.code,
          displayName: current.display_name,
          enabled: current.enabled,
        }
      : null
  }

  private async readSubmission(
    executor: Executor,
    submissionId: string,
    actor: ApprovalActor,
  ): Promise<WarehouseSubmissionView> {
    const row = await executor
      .selectFrom('approval_entries as e')
      .innerJoin('dcl_subjects as s', 's.id', 'e.subject_id')
      .innerJoin('dcl_warehouse_versions as w', 'w.approval_entry_id', 'e.id')
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
        'w.name',
        'w.address',
        'w.contact_name',
        'w.contact_phone',
        'w.manager_employee_id',
        'w.manager_employee_approval_entry_id',
        'w.manager_employee_code',
        'w.manager_employee_name',
        'w.remark',
        'w.enabled',
      ])
      .where('e.id', '=', submissionId)
      .executeTakeFirst()
    if (!row) throw new WarehouseApplicationError('approval_not_found')
    const entry = await this.loadApprovalEntry(
      executor,
      submissionId,
      row.subject_id,
      false,
    )
    return {
      subjectId: row.subject_id,
      code: requiredWarehouseCode(row.code),
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
      snapshot: {
        name: row.name,
        address: row.address,
        contactName: row.contact_name,
        contactPhone: row.contact_phone,
        managerEmployeeId: row.manager_employee_id,
        managerEmployeeApprovalEntryId: row.manager_employee_approval_entry_id,
        managerEmployeeCode: row.manager_employee_code,
        managerEmployeeName: row.manager_employee_name,
        remark: row.remark,
        enabled: row.enabled,
      },
      availableApprovalActions: availableApprovalActions(entry, actor),
      canDelete:
        (entry.status === 'PENDING' || entry.status === 'REJECTED') &&
        entry.metadata.submitted.actorId === actor.id &&
        (actor.trusted === true ||
          actor.permissions.includes('/dcl/warehouse/delete')),
    }
  }

  private async snapshotEnabled(
    executor: Executor,
    submissionId: string,
  ): Promise<boolean> {
    const row = await executor
      .selectFrom('dcl_warehouse_versions')
      .select('enabled')
      .where('approval_entry_id', '=', submissionId)
      .executeTakeFirstOrThrow()
    return row.enabled
  }

  private async previousApprovedEnabled(
    executor: Executor,
    subjectId: string,
    beforeVersion: number,
  ): Promise<boolean> {
    const row = await executor
      .selectFrom('approval_entries as e')
      .innerJoin('dcl_warehouse_versions as w', 'w.approval_entry_id', 'e.id')
      .select('w.enabled')
      .where('e.subject_id', '=', subjectId)
      .where('e.status', '=', 'APPROVED')
      .where('e.version_no', '<', beforeVersion)
      .orderBy('e.version_no', 'desc')
      .executeTakeFirst()
    return row?.enabled ?? false
  }

  private async ensureNoDisableBlockers(
    executor: Executor,
    subjectId: string,
  ): Promise<void> {
    const rows = await executor
      .selectFrom('dcl_warehouse_usage_facts')
      .selectAll()
      .where('warehouse_id', '=', subjectId)
      .execute()
    if (rows.length === 0) return
    const data: WarehouseDisableBlockerData = {
      inventory: [],
      documents: [],
      sources: [],
      references: [],
    }
    for (const row of rows) {
      if (row.kind === 'INVENTORY' && BigInt(row.quantity_micros ?? 0) === 0n)
        continue
      const key =
        row.kind === 'INVENTORY'
          ? 'inventory'
          : row.kind === 'DOCUMENT'
            ? 'documents'
            : row.kind === 'SOURCE'
              ? 'sources'
              : 'references'
      data[key]!.push({
        entity: row.entity,
        businessId: row.business_id,
        businessCode: row.business_code,
        ...(row.quantity_micros === null
          ? {}
          : { quantityMicros: String(row.quantity_micros) }),
      })
    }
    if (
      data.inventory.length === 0 &&
      data.documents.length === 0 &&
      data.sources.length === 0 &&
      data.references.length === 0
    )
      return
    throw new WarehouseApplicationError('warehouse_disable_blocked', data)
  }
}
