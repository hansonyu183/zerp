import { sql, type Kysely, type RawBuilder } from 'kysely'
import {
  servicePayloadContext,
  servicePermissionContexts,
  type ServiceContext,
  type ApprovalActor,
  type VouEntity,
  type VouPayload,
} from '@zerp/model'
import type { DB } from '../db/generated.ts'
import { serviceAccess } from '../app/service-access.ts'
import { SessionError } from '../app/session.ts'

export function serviceContextPredicate(
  entity: VouEntity,
  contexts: readonly ServiceContext[] | undefined,
  entryId: RawBuilder<string>,
): RawBuilder<boolean> {
  const allowed = (contexts ?? []).filter((context) =>
    servicePermissionContexts(`/vou/${entity}/query`).includes(context),
  )
  if (!allowed.length) return sql<boolean>`FALSE`
  if (
    servicePermissionContexts(`/vou/${entity}/query`).every((context) =>
      allowed.includes(context),
    )
  )
    return sql<boolean>`TRUE`
  const conditions = allowed.map((context) => {
    if (context.startsWith('PRIOR_'))
      return sql<boolean>`EXISTS (
      SELECT 1 FROM vou_prior_facts prior WHERE prior.approval_entry_id = ${entryId}
        AND prior.source_component = 'SERVICE' AND prior.source_document_type = ${context.slice(6)}
    )`
    const ordinary = sql<boolean>`NOT EXISTS (SELECT 1 FROM vou_prior_facts prior WHERE prior.approval_entry_id = ${entryId})`
    if (context === 'CONTRACT')
      return sql<boolean>`${ordinary} AND EXISTS (
      SELECT 1 FROM vou_service_acceptance_details detail WHERE detail.approval_entry_id = ${entryId} AND detail.contract_document_id IS NOT NULL
    )`
    return sql<boolean>`${ordinary} AND EXISTS (SELECT 1 FROM vou_reference_snapshots party
      WHERE party.approval_entry_id = ${entryId} AND party.field = 'counterparty' AND party.line_no = 0 AND party.item_no = 0
        AND party.reference_entity = ${context === 'OTHER_UNIT' ? 'other-unit' : 'sales-partner'})`
  })
  return sql<boolean>`(${sql.join(conditions, sql` OR `)})`
}
export async function assertServicePayloadAccess(
  db: Kysely<DB>,
  actor: ApprovalActor,
  path: string,
  entity: VouEntity,
  payload: VouPayload,
) {
  if (!servicePermissionContexts(path).length) return
  const context = servicePayloadContext(entity, payload)
  const access = await serviceAccess(db, actor)
  if (!context || !access[path]?.includes(context))
    throw new SessionError('forbidden')
}
export async function assertServiceDocumentAccess(
  db: Kysely<DB>,
  actor: ApprovalActor,
  path: string,
  entity: VouEntity,
  documentId: string,
  submissionId?: string,
) {
  if (!servicePermissionContexts(path).length) return
  const access = await serviceAccess(db, actor)
  const row = await sql<{ allowed: boolean }>`
    SELECT ${serviceContextPredicate(entity, access[path], sql`entry.id`)} AS allowed
    FROM approval_entries entry WHERE entry.domain = 'vou' AND entry.entity = ${entity} AND entry.subject_id = ${documentId}
      ${submissionId ? sql`AND entry.id = ${submissionId}` : sql``}
    ORDER BY CASE WHEN entry.status IN ('PENDING','REJECTED') THEN 0 ELSE 1 END, entry.submitted_at DESC, entry.id DESC LIMIT 1
  `.execute(db)
  if (row.rows[0] && !row.rows[0].allowed) throw new SessionError('forbidden')
}
export async function scopedServiceActor(
  db: Kysely<DB>,
  actor: ApprovalActor,
  entity: VouEntity,
  payload: VouPayload,
): Promise<ApprovalActor> {
  const context = servicePayloadContext(entity, payload)
  const access = await serviceAccess(db, actor)
  return {
    ...actor,
    permissions: actor.permissions.filter(
      (path) =>
        !path.startsWith(`/vou/${entity}/`) ||
        (context !== undefined && access[path]?.includes(context)),
    ),
  }
}

export async function scopedServiceDocumentActor(
  db: Kysely<DB>,
  actor: ApprovalActor,
  entity: VouEntity,
  documentId: string,
  submissionId: string,
): Promise<ApprovalActor> {
  const access = await serviceAccess(db, actor)
  const rows = await sql<{ context: ServiceContext | null }>`
    SELECT CASE
      WHEN prior.source_document_type IS NOT NULL THEN 'PRIOR_' || prior.source_document_type
      WHEN entry.entity = 'service-acceptance' AND EXISTS (SELECT 1 FROM vou_service_acceptance_details detail WHERE detail.approval_entry_id = entry.id AND detail.contract_document_id IS NOT NULL) THEN 'CONTRACT'
      WHEN party.reference_entity = 'other-unit' THEN 'OTHER_UNIT'
      WHEN party.reference_entity = 'sales-partner' THEN 'SALES_PARTNER'
      ELSE NULL END AS context
    FROM approval_entries entry LEFT JOIN vou_prior_facts prior ON prior.approval_entry_id = entry.id
    LEFT JOIN vou_reference_snapshots party ON party.approval_entry_id = entry.id AND party.field = 'counterparty' AND party.line_no = 0 AND party.item_no = 0
    WHERE entry.id = ${submissionId} AND entry.subject_id = ${documentId} AND entry.entity = ${entity} AND entry.domain = 'vou'
  `.execute(db)
  const context = rows.rows[0]?.context
  return {
    ...actor,
    permissions: actor.permissions.filter(
      (path) =>
        !path.startsWith(`/vou/${entity}/`) ||
        (context && access[path]?.includes(context)),
    ),
  }
}
