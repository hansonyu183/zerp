import { vouPriorDocumentTypes } from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { VouEntity, VouPayload, VouPriorFact } from '@zerp/model'
import type { DB } from '../db/generated.ts'
import { VouApplicationError } from './service.ts'

type Executor = Kysely<DB> | Transaction<DB>
export function priorFact(payload: VouPayload): VouPriorFact | undefined {
  return 'priorFact' in payload ? payload.priorFact : undefined
}

export async function readPriorFact(
  executor: Executor,
  approvalEntryId: string,
) {
  const row = await executor
    .selectFrom('vou_prior_facts')
    .selectAll()
    .where('approval_entry_id', '=', approvalEntryId)
    .executeTakeFirst()
  if (!row) return undefined
  return {
    sourceInstanceId: row.source_instance_id,
    sourceSchema: row.source_schema,
    sourceDocumentType:
      row.source_document_type as VouPriorFact['sourceDocumentType'],
    sourceDocumentKey: row.source_document_key,
    sourceDocumentNo: row.source_document_no,
    capturedAt: new Date(row.captured_at).toISOString(),
    snapshotDigest: row.snapshot_digest,
  } satisfies VouPriorFact
}

// Callers hold the same control-book row lock as opening approval.
export async function assertPriorFactEditable(tx: Transaction<DB>) {
  const opening = await sql<{ id: string }>`
    SELECT entry.id FROM acc_books book JOIN approval_entries entry
      ON entry.subject_id = book.id AND entry.domain = 'vou'
      AND entry.entity = 'opening' AND entry.status = 'APPROVED'
    WHERE book.control_book LIMIT 1
  `.execute(tx)
  if (opening.rows.length)
    throw new VouApplicationError('vou_prior_fact_frozen')
}

function sameCapture(a: VouPriorFact, b: VouPriorFact) {
  return (
    a.sourceInstanceId === b.sourceInstanceId &&
    a.sourceSchema === b.sourceSchema &&
    Date.parse(a.capturedAt) === Date.parse(b.capturedAt) &&
    a.snapshotDigest === b.snapshotDigest
  )
}

export async function validatePriorFact(
  tx: Transaction<DB>,
  entity: VouEntity,
  documentId: string,
  payload: VouPayload,
) {
  const fact = priorFact(payload)
  if (!fact) return
  const allowed: readonly string[] =
    entity in vouPriorDocumentTypes
      ? vouPriorDocumentTypes[entity as keyof typeof vouPriorDocumentTypes]
      : []
  if (
    !allowed.includes(fact.sourceDocumentType) ||
    !/^[0-9a-f]{64}$/.test(fact.snapshotDigest) ||
    !Number.isFinite(Date.parse(fact.capturedAt)) ||
    payload.businessDate > fact.capturedAt.slice(0, 10) ||
    [
      fact.sourceInstanceId,
      fact.sourceSchema,
      fact.sourceDocumentKey,
      fact.sourceDocumentNo,
    ].some((v) => typeof v !== 'string' || !v.trim())
  )
    throw new VouApplicationError('vou_prior_fact_invalid')
  await assertPriorFactEditable(tx)
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['vou:prior-source', fact.sourceInstanceId, fact.sourceSchema, fact.sourceDocumentType, fact.sourceDocumentKey])}, 0))`.execute(
    tx,
  )
  const duplicate = await sql<{ document_id: string }>`
    SELECT entry.subject_id AS document_id FROM vou_prior_facts prior
    JOIN approval_entries entry ON entry.id = prior.approval_entry_id
    WHERE prior.source_instance_id = ${fact.sourceInstanceId} AND prior.source_schema = ${fact.sourceSchema}
      AND prior.source_document_type = ${fact.sourceDocumentType} AND prior.source_document_key = ${fact.sourceDocumentKey}
      AND entry.subject_id <> ${documentId} LIMIT 1
  `.execute(tx)
  if (duplicate.rows.length)
    throw new VouApplicationError('vou_prior_fact_source_conflict')
  if (entity === 'purchase-order') {
    if (payload.parentDocumentId)
      throw new VouApplicationError('vou_prior_fact_invalid')
    return
  }
  if (payload.parentEntity !== 'purchase-order' || !payload.parentDocumentId)
    throw new VouApplicationError('vou_prior_fact_invalid')
  const ids = [
    payload.parentDocumentId,
    ...('returnLines' in payload
      ? payload.returnLines.map((line) => line.sourceDocumentId)
      : []),
  ]
  for (const id of new Set(ids)) {
    const source = await sql<{ approval_entry_id: string }>`
      SELECT prior.approval_entry_id FROM vou_prior_facts prior
      JOIN approval_entries entry ON entry.id = prior.approval_entry_id
      WHERE entry.subject_id = ${id} AND entry.domain = 'vou' AND entry.status = 'APPROVED'
    `.execute(tx)
    const sourceFact = source.rows[0]
      ? await readPriorFact(tx, source.rows[0].approval_entry_id)
      : undefined
    if (!sourceFact || !sameCapture(fact, sourceFact))
      throw new VouApplicationError('vou_prior_fact_invalid')
  }
}

export async function writePriorFact(
  tx: Transaction<DB>,
  approvalEntryId: string,
  fact: VouPriorFact,
) {
  await tx
    .insertInto('vou_prior_facts')
    .values({
      approval_entry_id: approvalEntryId,
      source_instance_id: fact.sourceInstanceId,
      source_schema: fact.sourceSchema,
      source_document_type: fact.sourceDocumentType,
      source_document_key: fact.sourceDocumentKey,
      source_document_no: fact.sourceDocumentNo,
      captured_at: new Date(fact.capturedAt),
      snapshot_digest: fact.snapshotDigest,
    })
    .execute()
}

export async function validatePurchaseReceipt(
  tx: Transaction<DB>,
  documentId: string,
  payload: import('@zerp/model').VouPayloadFor<'purchase-inbound'>,
) {
  if (payload.parentEntity !== 'purchase-order' || !payload.parentDocumentId)
    throw new VouApplicationError('vou_parent_invalid')
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:document:${payload.parentDocumentId}`}, 0))`.execute(
    tx,
  )
  const order = await sql<{
    id: string
    business_date: string
    currency: string
    object_id: string
    adopted_approval_entry_id: string
  }>`
    SELECT entry.id, detail.business_date::text AS business_date, detail.currency,
      supplier.object_id, supplier.approval_reference_id AS adopted_approval_entry_id
    FROM approval_entries entry JOIN vou_purchase_order_details detail ON detail.approval_entry_id = entry.id
    JOIN vou_reference_snapshots supplier ON supplier.approval_entry_id = entry.id AND supplier.field = 'supplier' AND supplier.line_no = 0
    WHERE entry.subject_id = ${payload.parentDocumentId} AND entry.domain = 'vou'
      AND entry.entity = 'purchase-order' AND entry.status = 'APPROVED'
  `.execute(tx)
  const root = order.rows[0]
  if (
    !root ||
    payload.businessDate < root.business_date ||
    payload.currency !== root.currency ||
    payload.supplier.objectId !== root.object_id ||
    payload.supplier.approvalEntryId !== root.adopted_approval_entry_id
  )
    throw new VouApplicationError('vou_parent_invalid')
  const capture = await readPriorFact(tx, root.id)
  if (
    !payload.priorFact &&
    capture &&
    payload.businessDate < capture.capturedAt.slice(0, 10)
  )
    throw new VouApplicationError('vou_prior_fact_invalid')
  const requested = new Map<string, bigint>()
  for (const line of payload.sourceLines) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(line.baseQuantity))
      throw new VouApplicationError('vou_invalid_payload')
    const [whole, fraction = ''] = line.baseQuantity.split('.')
    const qty = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0'))
    if (qty <= 0n) throw new VouApplicationError('vou_invalid_payload')
    requested.set(
      line.sourceLineId,
      (requested.get(line.sourceLineId) ?? 0n) + qty,
    )
  }
  for (const [lineId, quantity] of requested) {
    const result = await sql<{
      quantity: string
      used: string
      returned: string
    }>`
      SELECT product.base_quantity_micros::text AS quantity,
      (SELECT COALESCE(SUM(line.base_quantity_micros),0)::text
       FROM vou_purchase_inbound_details detail JOIN vou_source_line_snapshots line ON line.approval_entry_id = detail.approval_entry_id
       WHERE detail.parent_document_id = ${payload.parentDocumentId} AND detail.document_id <> ${documentId} AND line.source_line_id = ${lineId}) AS used,
      (SELECT COALESCE(SUM(line.base_quantity_micros),0)::text
       FROM vou_purchase_return_details detail JOIN approval_entries approved ON approved.id = detail.approval_entry_id AND approved.status = 'APPROVED'
       JOIN vou_return_line_snapshots line ON line.approval_entry_id = detail.approval_entry_id
       WHERE detail.parent_document_id = ${payload.parentDocumentId} AND line.source_line_id = ${lineId}) AS returned
      FROM vou_product_line_snapshots product WHERE product.approval_entry_id = ${root.id} AND product.line_id = ${lineId}
    `.execute(tx)
    const row = result.rows[0]
    if (!row) throw new VouApplicationError('vou_source_line_unavailable')
    if (
      !payload.priorFact &&
      quantity + BigInt(row.used) - BigInt(row.returned) > BigInt(row.quantity)
    )
      throw new VouApplicationError('vou_source_line_quantity_exceeded')
  }
}
