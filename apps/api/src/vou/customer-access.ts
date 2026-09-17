import { sql, type Kysely, type RawBuilder } from 'kysely'
import type { VouEntity, VouPayload } from '@zerp/model'
import { vouPayloadReferences } from '@zerp/model'
import type { DB } from '../db/generated.ts'
import { SessionError } from '../app/session.ts'
import {
  customerAccess,
  customerPredicate,
  assertCustomerAccess,
  type CustomerAccess,
  type CustomerAccessActor,
} from '../app/customer-access.ts'
import { vouEntityDetailTables } from './detail-tables.ts'

// Stored parent links are the same links used by document lineage validation.
const parentEdges = sql.join(
  Object.values(vouEntityDetailTables).map(
    (table) =>
      sql`SELECT document_id, parent_document_id FROM ${sql.table(table)} WHERE parent_document_id IS NOT NULL`,
  ),
  sql` UNION ALL `,
)

/** A complete document may only be returned if every customer it exposes is visible. */
export function documentCustomerPredicate(
  access: CustomerAccess,
  documentId: RawBuilder<unknown>,
): RawBuilder<boolean> {
  if (access.scope === 'ALL') return sql<boolean>`true`
  return sql<boolean>`NOT EXISTS (
    WITH RECURSIVE document_scope(id) AS (
      SELECT ${documentId}::varchar
      UNION
      SELECT edge.parent_document_id FROM (${parentEdges}) edge JOIN document_scope child ON child.id = edge.document_id
    )
    SELECT 1 FROM document_scope document
    JOIN approval_entries entry ON entry.subject_id = document.id AND entry.domain = 'vou'
    JOIN vou_reference_snapshots reference ON reference.approval_entry_id = entry.id
    LEFT JOIN approval_entries referenced ON referenced.id = reference.approval_reference_id
    WHERE (reference.reference_entity = 'customer' OR (referenced.domain = 'dcl' AND referenced.entity = 'customer'))
      AND NOT (${customerPredicate(access, sql`reference.object_id`)})
  )`
}

export async function assertDocumentCustomerAccess(
  db: Kysely<DB>,
  actor: CustomerAccessActor,
  documentId: string,
): Promise<void> {
  const access = await customerAccess(db, actor)
  const result = await sql<{
    allowed: boolean
  }>`SELECT ${documentCustomerPredicate(access, sql`${documentId}`)} AS allowed`.execute(
    db,
  )
  if (!result.rows[0]?.allowed) throw new SessionError('forbidden')
}

export async function assertPayloadCustomerAccess(
  db: Kysely<DB>,
  actor: CustomerAccessActor,
  entity: VouEntity,
  payload: VouPayload,
): Promise<void> {
  for (const { candidateEntity, reference } of vouPayloadReferences(
    entity,
    payload,
  )) {
    if (candidateEntity === 'customer')
      await assertCustomerAccess(db, actor, reference.objectId)
  }
  if (payload.parentDocumentId)
    await assertDocumentCustomerAccess(db, actor, payload.parentDocumentId)
}
