import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import {
  availableApprovalActions,
  prepareOtherUnitSubmit,
  prepareSalesPartnerSubmit,
  prepareSupplierSubmit,
  prepareProductSubmit,
  prepareCustomerSubmit,
  type ProductMaterialFact,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
  type ReferenceBlocker,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type {
  BobArchiveEntity,
  CustomerAttachmentReadInput,
} from './archive-contract.ts'
import type { DB, JsonValue } from '../db/generated.ts'

import { AttachmentStore } from '../platform/attachment-store.ts'
import {
  cancelAttachmentDeletion,
  drainAttachmentDeletions,
  enqueueAttachmentDeletions,
  lockAttachmentStorageKey,
} from '../platform/attachment-deletion.ts'
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

type AuxiliaryField =
  | 'paymentMethod'
  | 'customerType'
  | 'settlementMethod'
  | 'productType'
  | 'productCategory'
  | 'pricingUnit'
  | 'defaultInputUnit'
  | 'measurementUnit'
type AuxiliaryFact = {
  field: AuxiliaryField
  objectId: string
  available: boolean
  code: string
  name: string
  data: Record<string, unknown>
}

const auxiliaryEntities: Record<AuxiliaryField, string> = {
  customerType: 'dictionary-item',
  paymentMethod: 'payment-method',
  settlementMethod: 'settlement-method',
  productType: 'product-type',
  productCategory: 'product-category',
  pricingUnit: 'measurement-unit',
  defaultInputUnit: 'measurement-unit',
  measurementUnit: 'measurement-unit',
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
    productTypeId?: string
    productCategoryId?: string
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
      kind: 'PRODUCT_REFERENCE' | 'CUSTOMER_REFERENCE'
      domain: 'bob' | 'vou' | 'acc'
      entity: string
      objectId: string
      approvalEntryId: string
      field: string
    }
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
  entity: ArchiveEntity,
  code: string | null,
  snapshot: ArchiveSnapshot,
  filters: ArchiveQueryInput['filters'],
): boolean {
  if (entity === 'product') {
    if (
      filters.productTypeId &&
      record(snapshot.productType).id !== filters.productTypeId
    )
      return false
    if (
      filters.productCategoryId &&
      record(snapshot.productCategory).id !== filters.productCategoryId
    )
      return false
    return (
      !filters.keyword ||
      includesKeyword(filters.keyword, [
        code,
        nullable(snapshot.name),
        nullable(snapshot.barcode),
        nullable(snapshot.specification),
        nullable(snapshot.model),
      ])
    )
  }
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
  customer: 'CUS',
  product: 'PRD',
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

function customerAttachmentContentMatches(
  mimeType: string,
  content: Buffer,
): boolean {
  if (mimeType === 'application/pdf')
    return content.subarray(0, 5).toString() === '%PDF-'
  if (mimeType === 'image/png')
    return content
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mimeType === 'image/jpeg')
    return (
      content[0] === 0xff &&
      content[1] === 0xd8 &&
      content[content.length - 2] === 0xff &&
      content[content.length - 1] === 0xd9
    )
  return false
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
  private readonly attachmentStore: AttachmentStore
  private readonly db: Kysely<DB>
  private readonly approval = new ApprovalPersistence()
  private readonly versioning = new VersionedArchives()

  constructor(
    db: Kysely<DB>,
    options: { attachmentStore?: AttachmentStore } = {},
  ) {
    this.attachmentStore =
      options.attachmentStore ??
      new AttachmentStore(
        process.env.ATTACHMENT_STORAGE_ROOT ?? '/var/lib/zerp/attachments',
      )
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
    const preparedPermanentKeys = new Set<string>()
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
        if (entity === 'product')
          await this.lockProductSubjects(tx, input.subjectId, input.snapshot)
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
            (entity === 'product' || entity === 'customer') &&
              action === 'submit-change' &&
              history.some(
                (entry) =>
                  entry.id === input.expectedLatestApprovedSubmissionId &&
                  entry.status === 'APPROVED',
              )
              ? await this.readSnapshot(
                  tx,
                  entity,
                  input.expectedLatestApprovedSubmissionId!,
                )
              : undefined,
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
        if (entity === 'customer')
          plan.data = await this.assignCustomerSubunitCodes(
            tx,
            input.subjectId.trim(),
            plan.data,
          )
        if (entity === 'customer' && action === 'submit-new')
          requirePermission(actor, '/bob/customer/save-subunits')
        if (entity === 'customer' && action === 'submit-change') {
          const latest = [...history]
            .filter((item) => item.status === 'APPROVED')
            .at(-1)
          if (
            latest &&
            !isDeepStrictEqual(
              array((await this.readSnapshot(tx, entity, latest.id)).subunits),
              array(plan.data.subunits),
            )
          )
            requirePermission(actor, '/bob/customer/save-subunits')
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
        if (entity === 'customer')
          await this.promoteCustomerAttachments(
            tx,
            input.submissionId.trim(),
            input.snapshot,
            actor.id,
            preparedPermanentKeys,
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
      if (entity === 'customer')
        await this.discardPreparedCustomerAttachments(preparedPermanentKeys)
      if (error instanceof BobArchiveApplicationError) throw error
      if (error instanceof VersionedArchiveError)
        throw new BobArchiveApplicationError(error.errorKey)
      if (pgCode(error) === '23505')
        throw new BobArchiveApplicationError('archive_conflict')
      throw error
    }
    if (entity === 'customer')
      await this.finalizeCustomerAttachments(input.snapshot, actor.id)
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
        if (entity === 'product') {
          await this.loadEntry(
            tx,
            entity,
            input.submissionId,
            input.subjectId,
            false,
          )
          await this.lockProductSubjects(
            tx,
            input.subjectId,
            await this.readSnapshot(tx, entity, input.submissionId),
          )
        }
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
    const domain = archiveDomain(entity)
    let outcome: {
      result: { submissionId: string; deleted: true }
      storageKeys: string[]
    }
    try {
      outcome = await this.db.transaction().execute(async (tx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${domain}:archive:${entity}:${input.subjectId}`}, 0))`.execute(
          tx,
        )
        const entry = await this.loadEntry(
          tx,
          entity,
          input.submissionId,
          input.subjectId,
          true,
        )
        const candidateStorageKeys =
          entity === 'customer'
            ? await tx
                .selectFrom('bob_customer_attachments')
                .select('storage_key')
                .where('approval_entry_id', '=', entry.id)
                .execute()
                .then((rows) => [
                  ...new Set(rows.map((row) => row.storage_key)),
                ])
            : []
        await sql`DELETE FROM aux_reference_facts WHERE source LIKE ${`${domain}:${entity}:${input.submissionId}:%`}`.execute(
          tx,
        )
        await this.approval.delete(tx, {
          entry,
          actor,
          expectedRevision: input.expectedRevision,
          occurredAt: new Date(),
          requestId,
        })
        let unreferencedStorageKeys = candidateStorageKeys
        if (candidateStorageKeys.length > 0) {
          const referenced = await tx
            .selectFrom('bob_customer_attachments')
            .select('storage_key')
            .where('storage_key', 'in', candidateStorageKeys)
            .execute()
          const referencedKeys = new Set(
            referenced.map((row) => row.storage_key),
          )
          unreferencedStorageKeys = candidateStorageKeys.filter(
            (storageKey) => !referencedKeys.has(storageKey),
          )
          await enqueueAttachmentDeletions(tx, unreferencedStorageKeys)
        }
        return {
          result: { submissionId: entry.id, deleted: true as const },
          storageKeys: unreferencedStorageKeys,
        }
      })
    } catch (error) {
      if (error instanceof ApprovalPersistenceError)
        throw new BobArchiveApplicationError(error.errorKey)
      throw error
    }
    await drainAttachmentDeletions(
      this.db,
      this.attachmentStore,
      outcome.storageKeys,
    )
    return outcome.result
  }

  async readCustomerAttachment(
    input: CustomerAttachmentReadInput,
    actor: ApprovalActor,
  ) {
    requirePermission(actor, '/bob/customer/attachment-read')
    requirePermission(
      actor,
      input.source === 'current'
        ? '/bob/customer/get'
        : '/bob/customer/submission-get',
    )
    try {
      return await this.db.transaction().execute(async (tx) => {
        const scope = archiveScope(
          'customer',
          input.source === 'current' ? input.objectId : input.subjectId,
        )
        const entry =
          input.source === 'current'
            ? await this.versioning.latestApproved(tx, scope)
            : await this.versioning.exact(tx, scope, input.submissionId)
        if (!entry)
          throw new BobArchiveApplicationError('customer_attachment_not_found')
        const file = await tx
          .selectFrom('bob_customer_attachments')
          .selectAll()
          .where('approval_entry_id', '=', entry.id)
          .where('file_id', '=', input.fileId)
          .executeTakeFirst()
        if (!file)
          throw new BobArchiveApplicationError('customer_attachment_not_found')
        await lockAttachmentStorageKey(tx, file.storage_key)
        const content = await this.attachmentStore.read(file.storage_key)
        if (
          content.length !== file.size_bytes ||
          createHash('sha256').update(content).digest('hex') !== file.digest
        )
          throw new BobArchiveApplicationError(
            'customer_attachment_invalid_content',
          )
        return {
          fileName: file.file_name,
          mimeType: file.mime_type,
          size: file.size_bytes,
          digest: file.digest,
          contentBase64: content.toString('base64'),
        }
      })
    } catch (error) {
      if (error instanceof VersionedArchiveError)
        throw new BobArchiveApplicationError(error.errorKey)
      throw error
    }
  }

  async stageCustomerAttachment(
    input: CustomerAttachmentStageInput,
    actor: ApprovalActor,
  ): Promise<CustomerAttachmentStageView> {
    requirePermission(actor, '/bob/customer/attachment-stage')
    const content = Buffer.from(input.contentBase64, 'base64')
    const digest = createHash('sha256').update(content).digest('hex')
    if (
      content.length !== input.size ||
      digest !== input.digest ||
      !/^[0-9a-f]{64}$/.test(input.digest) ||
      input.size < 1 ||
      input.size > 10_485_760 ||
      !customerAttachmentContentMatches(input.mimeType, content)
    )
      throw new BobArchiveApplicationError(
        'customer_attachment_invalid_content',
      )
    const now = new Date(),
      expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const storageKey = `staging/${actor.id}/${input.stagingId}`
    try {
      return await this.db.transaction().execute(async (tx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bob:customer:attachment:${input.stagingId}`}, 0))`.execute(
          tx,
        )
        await lockAttachmentStorageKey(tx, storageKey)
        const existing = await tx
          .selectFrom('bob_customer_attachment_staging')
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
            throw new BobArchiveApplicationError(
              'customer_attachment_staging_conflict',
            )
          await this.attachmentStore.stage({
            ownerId: actor.id,
            stagingId: input.stagingId,
            content,
          })
          if (existing.expires_at <= now)
            await tx
              .updateTable('bob_customer_attachment_staging')
              .set({
                storage_key: storageKey,
                created_at: now,
                expires_at: expiresAt,
              })
              .where('id', '=', existing.id)
              .executeTakeFirstOrThrow()
          await cancelAttachmentDeletion(tx, storageKey)
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
        await this.attachmentStore.stage({
          ownerId: actor.id,
          stagingId: input.stagingId,
          content,
        })
        await tx
          .insertInto('bob_customer_attachment_staging')
          .values({
            id: input.stagingId,
            file_id: input.fileId,
            owner_user_id: actor.id,
            file_name: input.fileName,
            mime_type: input.mimeType,
            size_bytes: input.size,
            digest: input.digest,
            storage_key: storageKey,
            created_at: now,
            expires_at: expiresAt,
          })
          .execute()
        await cancelAttachmentDeletion(tx, storageKey)
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
    } catch (error) {
      await this.db.transaction().execute(async (tx) => {
        await enqueueAttachmentDeletions(tx, [storageKey])
      })
      await drainAttachmentDeletions(this.db, this.attachmentStore)
      throw error
    }
  }

  async cleanupCustomerAttachments(
    actor: ApprovalActor,
  ): Promise<{ deleted: number }> {
    requirePermission(actor, '/bob/customer/attachment-cleanup')
    await drainAttachmentDeletions(this.db, this.attachmentStore)
    const expired = await this.db
      .selectFrom('bob_customer_attachment_staging')
      .select('id')
      .where('expires_at', '<=', new Date())
      .execute()
    let deleted = 0
    for (const attachment of expired) {
      const storageKey = await this.db.transaction().execute(async (tx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bob:customer:attachment:${attachment.id}`}, 0))`.execute(
          tx,
        )
        const staged = await tx
          .selectFrom('bob_customer_attachment_staging')
          .select(['id', 'storage_key', 'expires_at'])
          .where('id', '=', attachment.id)
          .forUpdate()
          .executeTakeFirst()
        if (!staged || staged.expires_at > new Date()) return null
        const result = await tx
          .deleteFrom('bob_customer_attachment_staging')
          .where('id', '=', staged.id)
          .executeTakeFirst()
        if (Number(result.numDeletedRows) !== 1)
          throw new BobArchiveApplicationError(
            'customer_attachment_staging_invalid',
          )
        await enqueueAttachmentDeletions(tx, [staged.storage_key])
        return staged.storage_key
      })
      if (storageKey) {
        deleted += 1
        await drainAttachmentDeletions(this.db, this.attachmentStore, [
          storageKey,
        ])
      }
    }
    return { deleted }
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
    if (
      entity === 'customer' &&
      !array(input.snapshot.subunits).some(
        (item) => record(item).enabled === true,
      )
    ) {
      const current = await tx
        .selectFrom('bob_subjects')
        .select('enabled')
        .where('id', '=', input.subjectId)
        .where('entity', '=', 'customer')
        .executeTakeFirst()
      if (!current || current.enabled)
        return { ok: false, errorKey: 'customer_invalid_data', blockers: [] }
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
    tx: Executor,
  ): Promise<unknown> {
    const data = record(command.data)
    const base = { ...command, data }
    switch (entity) {
      case 'customer':
        return prepareCustomerSubmit(
          base as never,
          {
            subject,
            defaultOperatingEntity: adoptedAuxFact(data.defaultOperatingEntity),
            customerTypes: (
              await this.auxFacts(
                tx,
                array(data.subunits).map((value) => [
                  'customerType',
                  record(record(value).customerType).id,
                ]),
              )
            ).map((fact) => ({
              objectId: fact.objectId,
              available: fact.available,
            })),
            salesAttributions: await Promise.all(
              array(data.subunits).map(async (value) => {
                const attribution = record(
                  record(value).primarySalesAttribution,
                )
                const type = String(attribution.type ?? '') as
                  'INTERNAL_EMPLOYEE' | 'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER'
                if (type === 'INTERNAL_EMPLOYEE')
                  return {
                    ...adoptedAuxFact(attribution),
                    latestApprovedEntryId: '',
                    type,
                  }
                const entity = 'sales-partner'
                const fact = await this.approvedFact(
                  tx,
                  entity,
                  String(attribution.objectId ?? ''),
                )
                if (!fact)
                  return {
                    objectId: String(attribution.objectId ?? ''),
                    latestApprovedEntryId: '',
                    enabled: false,
                    type,
                  }
                let enabled = fact.enabled
                if (entity === 'sales-partner') {
                  const snapshot = await readBusinessIdentitySnapshot(
                    tx,
                    entity,
                    fact.latestApprovedEntryId,
                  )
                  enabled =
                    enabled &&
                    array(snapshot.capabilities).includes(type) &&
                    !(
                      data.identityKind !== 'OTHER' &&
                      String(data.legalIdentifier ?? '').trim() &&
                      String(data.legalIdentifier)
                        .replace(/\s/g, '')
                        .toUpperCase() ===
                        String(snapshot.legalIdentifier ?? '')
                          .replace(/\s/g, '')
                          .toUpperCase()
                    )
                }
                return {
                  objectId: fact.objectId,
                  latestApprovedEntryId: fact.latestApprovedEntryId,
                  enabled,
                  type,
                }
              }),
            ),
          } as never,
        )
      case 'product':
        return prepareProductSubmit(
          base as never,
          {
            subject,
            references: [
              'productType',
              'productCategory',
              'pricingUnit',
              'defaultInputUnit',
            ].map((field) => ({
              field,
              objectId: String(record(data[field]).id ?? ''),
              available: !!record(data[field]).id,
            })),
            materials: (
              await this.productMaterialFacts(
                tx,
                array(record(data.fixedFormula).components).map((component) =>
                  record(record(component).material),
                ),
              )
            ).map((fact) =>
              fact.objectId === command.subjectId
                ? { ...fact, enabled: false }
                : fact,
            ),
          } as never,
        )

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

  private async approvedFact(
    tx: Executor,
    entity: 'sales-partner',
    objectId: string,
  ) {
    if (!objectId) return undefined
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bob:archive:${entity}:${objectId}`},0))`.execute(
      tx,
    )
    const result = await sql<{
      id: string
      code: string
      enabled: boolean
      name: string
    }>`SELECT e.id,s.code,s.enabled,v.display_name AS name FROM bob_subjects s JOIN LATERAL(SELECT id FROM approval_entries WHERE domain='bob' AND entity=${entity} AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true JOIN bob_sales_partner_versions v ON v.approval_entry_id=e.id WHERE s.id=${objectId} AND s.entity=${entity}`.execute(
      tx,
    )
    const row = result.rows[0]
    return row
      ? {
          objectId,
          latestApprovedEntryId: row.id,
          enabled: row.enabled,
          code: row.code,
          name: row.name,
        }
      : undefined
  }

  private async freezeApprovedReference(
    tx: Executor,
    entity: 'sales-partner',
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

  private async ensureNoDuplicateBusinessKey(
    tx: Executor,
    entity: ArchiveEntity,
    subjectId: string,
    data: ArchiveSnapshot,
  ): Promise<void> {
    if (entity === 'product') {
      const barcode = nullable(data.barcode)?.toUpperCase()
      if (!barcode) return
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bob:archive:product:barcode:${barcode}`},0))`.execute(
        tx,
      )
      const duplicate =
        await sql`SELECT e.id FROM bob_product_versions v JOIN approval_entries e ON e.id=v.approval_entry_id WHERE e.domain='bob' AND e.entity='product' AND e.subject_id<>${subjectId} AND upper(trim(v.barcode))=${barcode} AND (e.status IN ('PENDING','REJECTED') OR (e.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain=e.domain AND newer.entity=e.entity AND newer.subject_id=e.subject_id AND newer.status='APPROVED' AND newer.version_no>e.version_no))) LIMIT 1`.execute(
          tx,
        )
      if (duplicate.rows.length)
        throw new BobArchiveApplicationError('product_duplicate_barcode')
      return
    }
    const table =
      entity === 'customer'
        ? 'bob_customer_versions'
        : entity === 'supplier'
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
    }>`SELECT e.id FROM ${sql.table(table)} AS v JOIN approval_entries e ON e.id = v.approval_entry_id WHERE e.domain = 'bob' AND e.entity = ${entity} AND e.subject_id <> ${subjectId} AND (e.status IN ('PENDING','REJECTED') OR (e.status='APPROVED' AND (${entity} <> 'customer' OR NOT EXISTS (SELECT 1 FROM approval_entries newer WHERE newer.domain=e.domain AND newer.entity=e.entity AND newer.subject_id=e.subject_id AND newer.status='APPROVED' AND newer.version_no>e.version_no)))) AND v.legal_identifier = ${value} LIMIT 1`.execute(
      tx,
    )
    if (duplicate.rows[0]) throw new BobArchiveApplicationError(errorKey)
  }

  private async lockProductSubjects(
    tx: Executor,
    subjectId: string,
    snapshot: ArchiveSnapshot,
  ): Promise<void> {
    const ids = [
      ...new Set([
        subjectId,
        ...array(record(snapshot.fixedFormula).components).map((value) =>
          String(record(record(value).material).objectId ?? ''),
        ),
      ]),
    ]
      .filter(Boolean)
      .sort()
    await tx
      .selectFrom('bob_subjects')
      .select('id')
      .where('entity', '=', 'product')
      .where('id', 'in', ids)
      .orderBy('id')
      .forUpdate()
      .execute()
  }

  private async productMaterialFacts(
    tx: Executor,
    references: Array<Record<string, unknown>>,
  ): Promise<ProductMaterialFact[]> {
    return Promise.all(
      references.map(async (reference) => {
        const objectId = String(reference.objectId ?? '')
        const fact = await this.productApprovedFact(tx, objectId)
        if (!fact)
          return {
            objectId,
            latestApprovedEntryId: '',
            enabled: false,
            behaviorProfile: 'RAW_MATERIAL',
          }
        const snapshot = await this.readSnapshot(
          tx,
          'product',
          fact.latestApprovedEntryId,
        )
        return {
          objectId: fact.objectId,
          latestApprovedEntryId: fact.latestApprovedEntryId,
          enabled: fact.enabled,
          behaviorProfile: String(
            record(snapshot.productType).behaviorProfile ?? '',
          ) as ProductMaterialFact['behaviorProfile'],
        }
      }),
    )
  }

  private async productApprovedFact(tx: Executor, objectId: string) {
    await tx
      .selectFrom('bob_subjects')
      .select('id')
      .where('id', '=', objectId)
      .where('entity', '=', 'product')
      .forShare()
      .execute()
    const result = await sql<{
      object_id: string
      id: string
      enabled: boolean
      code: string
      name: string
    }>`SELECT s.id AS object_id,e.id,s.enabled,s.code,v.name FROM bob_subjects s JOIN LATERAL (SELECT id FROM approval_entries WHERE domain='bob' AND entity='product' AND subject_id=s.id AND status='APPROVED' ORDER BY version_no DESC LIMIT 1) e ON true JOIN bob_product_versions v ON v.approval_entry_id=e.id WHERE s.id=${objectId} AND s.entity='product'`.execute(
      tx,
    )
    const row = result.rows[0]
    return row
      ? {
          objectId: row.object_id,
          latestApprovedEntryId: row.id,
          enabled: row.enabled,
          code: row.code,
          name: row.name,
        }
      : undefined
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

  private async freezeProductMaterial(tx: Executor, reference: unknown) {
    const requested = record(reference)
    const fact = await this.productApprovedFact(
      tx,
      String(requested.objectId ?? ''),
    )
    if (!fact || fact.latestApprovedEntryId !== requested.approvalEntryId)
      return requested
    return {
      objectId: fact.objectId,
      approvalEntryId: fact.latestApprovedEntryId,
      code: fact.code,
      name: fact.name,
    }
  }

  private async freezeProductReference(
    tx: Executor,
    field: AuxiliaryField,
    reference: unknown,
    errorKey: string,
    previous?: ArchiveSnapshot,
  ): Promise<Record<string, unknown>> {
    if (previous) {
      const candidates =
        auxiliaryEntities[field] === 'measurement-unit'
          ? [
              previous.pricingUnit,
              previous.defaultInputUnit,
              ...array(previous.unitConversions).map(
                (value) => record(value).unit,
              ),
              record(record(previous.fixedFormula).output).enteredUnit,
              ...array(record(previous.fixedFormula).components).map(
                (value) => record(record(value).quantity).enteredUnit,
              ),
            ]
          : [previous[field]]
      const adopted = candidates
        .map(record)
        .find(
          (value) =>
            value.id === record(reference).id && typeof value.id === 'string',
        )
      if (adopted) return adopted
    }
    const fact = (await this.auxFacts(tx, [[field, record(reference).id]]))[0]
    if (!fact || !fact.available) throw new BobArchiveApplicationError(errorKey)
    if (auxiliaryEntities[field] === 'measurement-unit') {
      const symbol = fact.data.symbol
      const quantityScale = fact.data.quantityScale
      if (
        typeof symbol !== 'string' ||
        !symbol.trim() ||
        !Number.isInteger(quantityScale) ||
        Number(quantityScale) < 0 ||
        Number(quantityScale) > 6
      )
        throw new BobArchiveApplicationError(errorKey)
      return {
        id: fact.objectId,
        code: fact.code,
        name: fact.name,
        symbol: symbol.trim(),
        quantityScale,
      }
    }
    if (field === 'productType') {
      const behaviorProfile = fact.data.behaviorProfile
      if (
        behaviorProfile !== 'RAW_MATERIAL' &&
        behaviorProfile !== 'STANDARD_FINISHED' &&
        behaviorProfile !== 'CUSTOM_FINISHED' &&
        behaviorProfile !== 'PACKAGING'
      )
        throw new BobArchiveApplicationError(errorKey)
      return {
        id: fact.objectId,
        code: fact.code,
        name: fact.name,
        behaviorProfile,
      }
    }
    return { id: fact.objectId, code: fact.code, name: fact.name }
  }

  private async freezeProductQuantity(
    tx: Executor,
    quantity: Record<string, unknown>,
    previous?: ArchiveSnapshot,
  ): Promise<Record<string, unknown>> {
    return {
      ...quantity,
      enteredUnit: await this.freezeProductReference(
        tx,
        'measurementUnit',
        quantity.enteredUnit,
        'product_reference_unavailable',
        previous,
      ),
    }
  }

  private async freezeCustomerType(
    tx: Executor,
    reference: unknown,
  ): Promise<Record<string, unknown>> {
    const fact = (
      await this.auxFacts(tx, [
        ['customerType', String(record(reference).id ?? '')],
      ])
    )[0]
    if (!fact?.available)
      throw new BobArchiveApplicationError('customer_invalid_data')
    return { id: fact.objectId, code: fact.code, name: fact.name }
  }

  private async freezeAuthoritativeReferences(
    tx: Transaction<DB>,
    entity: ArchiveEntity,
    snapshot: ArchiveSnapshot,
    previous?: ArchiveSnapshot,
  ): Promise<ArchiveSnapshot> {
    if (entity === 'customer')
      return {
        ...snapshot,
        defaultOperatingEntity:
          previous &&
          isDeepStrictEqual(
            previous.defaultOperatingEntity,
            snapshot.defaultOperatingEntity,
          )
            ? previous.defaultOperatingEntity
            : snapshot.defaultOperatingEntity === null
              ? null
              : await this.freezeCurrentReference(
                  tx,
                  'operating-entity',
                  snapshot.defaultOperatingEntity,
                ),
        subunits: await Promise.all(
          array(snapshot.subunits).map(async (item) => {
            const subunit = record(item)
            const old = array(previous?.subunits)
              .map(record)
              .find((value) => value.id === subunit.id)
            const attribution = record(subunit.primarySalesAttribution)
            const attributionType = String(attribution.type ?? '')
            return {
              ...subunit,
              customerType:
                old && isDeepStrictEqual(old.customerType, subunit.customerType)
                  ? old.customerType
                  : await this.freezeCustomerType(tx, subunit.customerType),
              settlementMethod: subunit.settlementMethod,
              paymentMethod: subunit.paymentMethod,
              primarySalesAttribution:
                old &&
                isDeepStrictEqual(
                  old.primarySalesAttribution,
                  subunit.primarySalesAttribution,
                )
                  ? old.primarySalesAttribution
                  : {
                      ...(attributionType === 'INTERNAL_EMPLOYEE'
                        ? await this.freezeCurrentReference(
                            tx,
                            'employee',
                            attribution,
                          )
                        : await this.freezeApprovedReference(
                            tx,
                            'sales-partner',
                            attribution,
                          )),
                      type: attributionType,
                    },
            }
          }),
        ),
      }
    if (entity === 'product')
      return {
        ...snapshot,
        productType: await this.freezeProductReference(
          tx,
          'productType',
          snapshot.productType,
          'product_reference_unavailable',
          previous,
        ),
        productCategory: await this.freezeProductReference(
          tx,
          'productCategory',
          snapshot.productCategory,
          'product_reference_unavailable',
          previous,
        ),
        pricingUnit: await this.freezeProductReference(
          tx,
          'pricingUnit',
          snapshot.pricingUnit,
          'product_reference_unavailable',
          previous,
        ),
        defaultInputUnit: await this.freezeProductReference(
          tx,
          'defaultInputUnit',
          snapshot.defaultInputUnit,
          'product_reference_unavailable',
          previous,
        ),
        unitConversions: await Promise.all(
          array(snapshot.unitConversions).map(async (value) => {
            const conversion = record(value)
            return {
              ...conversion,
              unit: await this.freezeProductReference(
                tx,
                'measurementUnit',
                conversion.unit,
                'product_reference_unavailable',
                previous,
              ),
            }
          }),
        ),
        fixedFormula:
          snapshot.fixedFormula === null
            ? null
            : {
                ...record(snapshot.fixedFormula),
                output: await this.freezeProductQuantity(
                  tx,
                  record(record(snapshot.fixedFormula).output),
                  previous,
                ),
                components: await Promise.all(
                  array(record(snapshot.fixedFormula).components).map(
                    async (value) => {
                      const component = record(value)
                      return {
                        ...component,
                        material: await this.freezeProductMaterial(
                          tx,
                          component.material,
                        ),
                        quantity: await this.freezeProductQuantity(
                          tx,
                          record(component.quantity),
                          previous,
                        ),
                      }
                    },
                  ),
                ),
              },
      }
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
    if (entity === 'customer') {
      if (snapshot.defaultOperatingEntity)
        references.push([
          'defaultOperatingEntity',
          String(record(snapshot.defaultOperatingEntity).objectId ?? ''),
        ])
      array(snapshot.subunits).forEach((value, index) => {
        const ref = record(record(value).primarySalesAttribution)
        if (ref.type === 'INTERNAL_EMPLOYEE')
          references.push([
            `subunits[${index}].primarySalesAttribution`,
            String(ref.objectId ?? ''),
          ])
      })
    }
    for (const [field, id] of references)
      await sql`INSERT INTO aux_reference_facts(id,aux_object_id,source) VALUES (${ulid()},${id},${`${archiveDomain(entity)}:${entity}:${submissionId}:${field}`})`.execute(
        tx,
      )
  }

  private async writeCustomer(
    tx: Executor,
    id: string,
    d: ArchiveSnapshot,
  ): Promise<void> {
    const oe = record(d.defaultOperatingEntity)
    await tx
      .insertInto('bob_customer_versions')
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
        .selectFrom('bob_customer_subunit_roots')
        .select(['customer_id', 'code'])
        .where('subunit_id', '=', String(s.id ?? ''))
        .executeTakeFirst()
      if (root) {
        if (
          root.customer_id !== owner.subject_id ||
          root.code !== String(s.code ?? '')
        )
          throw new BobArchiveApplicationError('customer_subunit_conflict')
      } else {
        await tx
          .insertInto('bob_customer_subunit_roots')
          .values({
            subunit_id: String(s.id ?? ''),
            customer_id: owner.subject_id,
            code: String(s.code ?? ''),
          })
          .execute()
      }
      await tx
        .insertInto('bob_customer_version_subunits')
        .values({
          customer_approval_entry_id: id,
          subunit_id: String(s.id ?? ''),
          name: String(s.name ?? ''),
          contact_name: nullable(s.contactName),
          contact_phone: null,
          business_address: nullable(s.address),
          customer_type_id: String(record(s.customerType).id),
          customer_type_snapshot: json(record(s.customerType)),
          settlement_method_id: nullable(record(s.settlementMethod).id),
          settlement_snapshot:
            s.settlementMethod === null
              ? null
              : json(record(s.settlementMethod)),
          payment_snapshot:
            s.paymentMethod === null ? null : json(record(s.paymentMethod)),
          transport_snapshot: json(record(s.transportPolicy)),
          pricing_snapshot: json(record(s.pricingPolicy)),
          credit_limits: json(array(s.creditLimits)),
          primary_sales_attribution_type: nullable(
            record(s.primarySalesAttribution).type,
          ),
          primary_sales_attribution_object_id: nullable(
            record(s.primarySalesAttribution).objectId,
          ),
          primary_sales_attribution_approval_entry_id: nullable(
            record(s.primarySalesAttribution).approvalEntryId,
          ),
          primary_sales_attribution_code: nullable(
            record(s.primarySalesAttribution).code,
          ),
          primary_sales_attribution_name: nullable(
            record(s.primarySalesAttribution).name,
          ),
          sales_attribution_snapshot: json(record(s.primarySalesAttribution)),
          internal_reminder: nullable(s.internalReminder),
          default_order_remark: nullable(s.defaultSalesOrderRemark),
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
      .selectFrom('bob_customer_subunit_roots')
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
        throw new BobArchiveApplicationError('customer_subunit_conflict')
      subunits.push(subunit)
    }
    return { ...snapshot, subunits }
  }

  private async promoteCustomerAttachments(
    tx: Executor,
    approvalEntryId: string,
    snapshot: ArchiveSnapshot,
    actorId: string,
    preparedPermanentKeys: Set<string>,
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
          .selectFrom('bob_customer_attachments as a')
          .innerJoin('approval_entries as e', 'e.id', 'a.approval_entry_id')
          .select([
            'a.file_id',
            'a.file_name',
            'a.mime_type',
            'a.size_bytes',
            'a.digest',
            'a.storage_key',
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
          throw new BobArchiveApplicationError(
            'customer_attachment_staging_invalid',
          )
        await tx
          .insertInto('bob_customer_attachments')
          .values({
            file_id: prior.file_id,
            approval_entry_id: approvalEntryId,
            file_name: prior.file_name,
            mime_type: prior.mime_type,
            size_bytes: prior.size_bytes,
            digest: prior.digest,
            storage_key: prior.storage_key,
            created_at: new Date(),
          })
          .execute()
        continue
      }
      const staged = await tx
        .selectFrom('bob_customer_attachment_staging')
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
        throw new BobArchiveApplicationError(
          'customer_attachment_staging_invalid',
        )
      const content = await this.attachmentStore.read(staged.storage_key)
      if (
        content.length !== staged.size_bytes ||
        !customerAttachmentContentMatches(staged.mime_type, content) ||
        createHash('sha256').update(content).digest('hex') !== staged.digest
      )
        throw new BobArchiveApplicationError(
          'customer_attachment_staging_invalid',
        )
      const prepared = await this.attachmentStore.promote({
        stagingKey: staged.storage_key,
        permanentKey: `permanent/bob/customer/${approvalEntryId}/${staged.file_id}`,
      })
      if (prepared.created) preparedPermanentKeys.add(prepared.key)
      await tx
        .insertInto('bob_customer_attachments')
        .values({
          file_id: staged.file_id,
          approval_entry_id: approvalEntryId,
          file_name: staged.file_name,
          mime_type: staged.mime_type,
          size_bytes: staged.size_bytes,
          digest: staged.digest,
          storage_key: prepared.key,
          created_at: new Date(),
        })
        .execute()
      await tx
        .deleteFrom('bob_customer_attachment_staging')
        .where('id', '=', staged.id)
        .execute()
    }
  }

  private customerStagingAttachments(snapshot: ArchiveSnapshot) {
    return [
      ...array(snapshot.identityAttachments),
      ...array(snapshot.subunits).flatMap((item) =>
        array(record(item).attachments),
      ),
    ]
      .map(record)
      .filter(
        (
          attachment,
        ): attachment is Record<string, unknown> & {
          stagingId: string
          id: string
        } =>
          typeof attachment.stagingId === 'string' &&
          typeof attachment.id === 'string',
      )
  }

  private async finalizeCustomerAttachments(
    snapshot: ArchiveSnapshot,
    ownerId: string,
  ): Promise<void> {
    await Promise.all(
      this.customerStagingAttachments(snapshot).map(async (attachment) => {
        try {
          await this.attachmentStore.finalize(
            `staging/${ownerId}/${attachment.stagingId}`,
          )
        } catch {
          // DB is already committed. A later orphan pass can retry removal.
        }
      }),
    )
  }

  private async discardPreparedCustomerAttachments(
    keys: ReadonlySet<string>,
  ): Promise<void> {
    await Promise.all(
      [...keys].map(async (key) => {
        try {
          await this.attachmentStore.remove(key)
        } catch {
          // The original submission error remains authoritative.
        }
      }),
    )
  }

  private async writeSnapshot(
    tx: Executor,
    entity: ArchiveEntity,
    id: string,
    snapshot: ArchiveSnapshot,
  ): Promise<void> {
    const d = snapshot
    if (entity === 'customer') return this.writeCustomer(tx, id, snapshot)
    if (entity === 'product') {
      await tx
        .insertInto('bob_product_versions')
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
          unit_conversions: json(array(d.unitConversions)),
          default_packaging_snapshot: json({
            defaultPackagingSpec: d.defaultPackagingSpec,
          }),
          recyclable: d.recyclable === true,
          fixed_formula:
            d.fixedFormula === null ? null : json(record(d.fixedFormula)),
          remark: nullable(d.remark),
        })
        .execute()
      return
    }
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

  private async readCustomer(
    tx: Executor,
    id: string,
  ): Promise<ArchiveSnapshot> {
    const r = await tx
      .selectFrom('bob_customer_versions')
      .selectAll()
      .where('approval_entry_id', '=', id)
      .executeTakeFirstOrThrow()
    const subs = await tx
      .selectFrom('bob_customer_version_subunits as v')
      .innerJoin(
        'bob_customer_subunit_roots as r',
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
        customerType: record(s.customer_type_snapshot),
        settlementMethod: s.settlement_snapshot,
        paymentMethod: s.payment_snapshot,
        transportPolicy: record(s.transport_snapshot),
        pricingPolicy: record(s.pricing_snapshot),
        creditLimits: array(s.credit_limits),
        primarySalesAttribution: s.primary_sales_attribution_object_id
          ? {
              type: s.primary_sales_attribution_type,
              objectId: s.primary_sales_attribution_object_id,
              ...(s.primary_sales_attribution_type === 'INTERNAL_EMPLOYEE'
                ? {}
                : {
                    approvalEntryId:
                      s.primary_sales_attribution_approval_entry_id ?? '',
                  }),
              code: s.primary_sales_attribution_code ?? '',
              name: s.primary_sales_attribution_name ?? '',
            }
          : {},
        internalReminder: s.internal_reminder ?? '',
        defaultSalesOrderRemark: s.default_order_remark ?? '',
        attachments: array(s.business_attachments),
        enabled: s.enabled,
      })),
    }
  }

  private async readSnapshot(
    tx: Executor,
    entity: ArchiveEntity,
    id: string,
  ): Promise<ArchiveSnapshot> {
    if (entity === 'customer') return this.readCustomer(tx, id)
    if (entity === 'product') {
      const r = await tx
        .selectFrom('bob_product_versions')
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
        unitConversions: array(r.unit_conversions),
        defaultPackagingSpec:
          record(r.default_packaging_snapshot).defaultPackagingSpec ?? '',
        recyclable: r.recyclable,
        fixedFormula: r.fixed_formula === null ? null : record(r.fixed_formula),
        remark: r.remark ?? '',
      }
    }
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
    if (entity === 'product' || entity === 'customer') {
      const previous = (
        await this.versioning.history(tx as Transaction<DB>, scope)
      ).find(
        (candidate) =>
          candidate.id !== entry.id && candidate.status === 'APPROVED',
      )
      if (previous && entity === 'customer') {
        const root = await tx
          .selectFrom('bob_subjects')
          .select('enabled')
          .where('id', '=', entry.subjectId)
          .executeTakeFirstOrThrow()
        const snapshot = await this.readSnapshot(tx, entity, previous.id)
        if (
          root.enabled &&
          !array(snapshot.subunits).some(
            (subunit) => record(subunit).enabled === true,
          )
        )
          throw new BobArchiveApplicationError(
            'customer_enabled_subunit_required',
          )
      }
      if (previous)
        await this.ensureNoDuplicateBusinessKey(
          tx,
          entity,
          entry.subjectId,
          await this.readSnapshot(tx, entity, previous.id),
        )
    }
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
    if (entry.entity === 'customer') {
      const references = await sql<{
        domain: 'vou' | 'acc'
        entity: string
        subject_id: string
        id: string
        field: string
      }>`
        SELECT e.domain,e.entity,e.subject_id,e.id,r.field FROM vou_reference_snapshots r JOIN approval_entries e ON e.id=r.approval_entry_id WHERE r.approval_reference_id=${entry.id} AND e.status='APPROVED'
        UNION
        SELECT e.domain,e.entity,e.subject_id,e.id,'containers.subunit' FROM acc_opening_container_balances r JOIN approval_entries e ON e.id=r.opening_approval_entry_id WHERE r.customer_approval_entry_id=${entry.id} AND e.status='APPROVED'
        UNION
        SELECT e.domain,e.entity,e.subject_id,e.id,'customerSubunit' FROM acc_container_entries r JOIN approval_entries e ON e.id=r.vou_approval_entry_id WHERE r.customer_approval_entry_id=${entry.id} AND e.status='APPROVED'
        UNION
        SELECT e.domain,e.entity,e.subject_id,e.id,'bills.originatingCounterparty' FROM acc_opening_snapshots s JOIN approval_entries e ON e.id=s.approval_entry_id CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.payload->'bills','[]'::jsonb)) bill WHERE bill->'originatingCounterparty'->>'approvalEntryId'=${entry.id} AND e.status='APPROVED'
        ORDER BY domain,entity,subject_id,id,field`.execute(tx)
      return references.rows.map((row) => ({
        kind: 'CUSTOMER_REFERENCE' as const,
        domain: row.domain,
        entity: row.entity,
        objectId: row.subject_id,
        approvalEntryId: row.id,
        field: row.field,
      }))
    }
    if (entry.entity === 'product') {
      const references = await sql<{
        domain: 'bob' | 'vou'
        entity: string
        subject_id: string
        id: string
        field: string
      }>`
        SELECT e.domain,e.entity,e.subject_id,e.id,r.field
        FROM vou_reference_snapshots r JOIN approval_entries e ON e.id=r.approval_entry_id
        WHERE r.approval_reference_id=${entry.id} AND e.status='APPROVED'
        UNION ALL
        SELECT e.domain,e.entity,e.subject_id,e.id,'fixedFormula.components[' || (component.ordinality-1)::text || '].material'
        FROM bob_product_versions v JOIN approval_entries e ON e.id=v.approval_entry_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.fixed_formula->'components','[]'::jsonb)) WITH ORDINALITY AS component(value,ordinality)
        WHERE e.status='APPROVED' AND component.value->'material'->>'approvalEntryId'=${entry.id}
        ORDER BY domain,entity,subject_id,id,field`.execute(tx)
      return references.rows.map((row) => ({
        kind: 'PRODUCT_REFERENCE' as const,
        domain: row.domain,
        entity: row.entity,
        objectId: row.subject_id,
        approvalEntryId: row.id,
        field: row.field,
      }))
    }
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
