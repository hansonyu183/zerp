import { sql, type Kysely, type RawBuilder } from 'kysely'
import {
  purchaseInboundScopeCovers,
  type ApprovalActor,
  type PurchaseInboundMode,
  type PurchaseInboundScope,
} from '@zerp/model'
import type { DB } from '../db/generated.ts'
import { purchaseInboundAccess } from '../app/purchase-inbound-access.ts'
import { SessionError } from '../app/session.ts'

export function purchaseInboundModePredicate(
  scope: PurchaseInboundScope | undefined,
  approvalEntryId: RawBuilder<string>,
): RawBuilder<boolean> {
  const independent = sql<boolean>`EXISTS (SELECT 1 FROM vou_product_line_snapshots line WHERE line.approval_entry_id = ${approvalEntryId})`
  switch (scope) {
    case 'ALL':
      return sql<boolean>`TRUE`
    case 'INDEPENDENT_PRIOR':
      return independent
    case 'ORDER_REFERENCE':
      return sql<boolean>`NOT (${independent})`
    default:
      return sql<boolean>`FALSE`
  }
}

export async function purchaseInboundDocumentMode(
  db: Kysely<DB>,
  documentId: string,
  submissionId?: string,
): Promise<PurchaseInboundMode | undefined> {
  const result = await sql<{ independent: boolean }>`SELECT
      EXISTS (SELECT 1 FROM vou_product_line_snapshots line WHERE line.approval_entry_id = e.id) AS independent
    FROM approval_entries e
    WHERE e.domain = 'vou' AND e.entity = 'purchase-inbound' AND e.subject_id = ${documentId}
      ${submissionId ? sql`AND e.id = ${submissionId}` : sql``}
    ORDER BY CASE WHEN e.status IN ('PENDING', 'REJECTED') THEN 0 ELSE 1 END,
      e.submitted_at DESC, e.id DESC
    LIMIT 1`.execute(db)
  if (!result.rows[0]) return undefined
  return result.rows[0].independent ? 'INDEPENDENT_PRIOR' : 'ORDER_REFERENCE'
}

export async function assertPurchaseInboundDocumentAccess(
  db: Kysely<DB>,
  actor: ApprovalActor,
  path: string,
  documentId: string,
  submissionId?: string,
): Promise<void> {
  const mode = await purchaseInboundDocumentMode(db, documentId, submissionId)
  if (!mode) return
  const access = await purchaseInboundAccess(db, actor)
  if (!purchaseInboundScopeCovers(access[path], mode))
    throw new SessionError('forbidden')
}

export async function scopedPurchaseInboundActor(
  db: Kysely<DB>,
  actor: ApprovalActor,
  mode: PurchaseInboundMode,
): Promise<ApprovalActor> {
  const access = await purchaseInboundAccess(db, actor)
  return {
    ...actor,
    permissions: actor.permissions.filter(
      (path) =>
        !path.startsWith('/vou/purchase-inbound/') ||
        purchaseInboundScopeCovers(access[path], mode),
    ),
  }
}
