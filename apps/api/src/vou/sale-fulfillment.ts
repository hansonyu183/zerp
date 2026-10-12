import { sql, type Kysely, type Transaction } from 'kysely'
import type {
  VouEntity,
  VouPayload,
  VouPriorSaleDisposition,
  VouPayloadBase,
  VouPriorFact,
} from '@zerp/model'
import type { DB } from '../db/generated.ts'
import { priorFact, readPriorFact } from './prior-fact.ts'
import { decimalToFixed, VouApplicationError } from './service.ts'

/** Only an approved, exact historical sales chain permits ordinary continuation without a fabricated WFL instance. */
export async function readApprovedSaleOrderSource(
  executor: Kysely<DB> | Transaction<DB>,
  entity: VouEntity,
  payload: Pick<VouPayloadBase, 'parentEntity' | 'parentDocumentId'> & {
    priorFact?: VouPriorFact
  },
) {
  if (!['sale-outbound', 'sale-delivery', 'sale-signoff'].includes(entity))
    return undefined
  let sourceEntity: string =
    entity === 'sale-outbound'
      ? 'sale-order'
      : entity === 'sale-delivery' || payload.priorFact
        ? 'sale-outbound'
        : 'sale-delivery'
  if (payload.parentEntity !== sourceEntity) return undefined
  let id = payload.parentDocumentId
  while (id) {
    const table: string =
      sourceEntity === 'sale-order'
        ? 'vou_sale_order_details'
        : sourceEntity === 'sale-outbound'
          ? 'vou_sale_outbound_details'
          : 'vou_sale_delivery_details'
    const row:
      | {
          id: string
          parent_document_id: string | null
          parent_entity: string | null
        }
      | undefined = (
      await sql<{
        id: string
        parent_document_id: string | null
        parent_entity: string | null
      }>`
      SELECT entry.id, detail.parent_document_id, detail.parent_entity
      FROM approval_entries entry JOIN ${sql.table(table)} detail ON detail.approval_entry_id = entry.id
      WHERE entry.domain = 'vou' AND entry.entity = ${sourceEntity} AND entry.subject_id = ${id} AND entry.status = 'APPROVED'
    `.execute(executor)
    ).rows[0]
    if (!row) return undefined
    if (sourceEntity === 'sale-order') {
      const fact = await readPriorFact(executor, row.id)
      return { fact, orderApprovalEntryId: row.id }
    }
    sourceEntity =
      sourceEntity === 'sale-delivery' ? 'sale-outbound' : 'sale-order'
    if (row.parent_entity !== sourceEntity) return undefined
    id = row.parent_document_id ?? undefined
  }
  return undefined
}

export async function priorSaleContinuation(
  executor: Kysely<DB> | Transaction<DB>,
  entity: VouEntity,
  payload: VouPayload,
) {
  if (priorFact(payload)) return undefined
  const source = await readApprovedSaleOrderSource(executor, entity, payload)
  return source?.fact ? { ...source, fact: source.fact } : undefined
}

/** WFL and ordinary approval share VOU's authoritative source quantities. */
export async function validateSaleFulfillment(
  tx: Transaction<DB>,
  entity: VouEntity,
  documentId: string,
  payload: VouPayload,
) {
  if (!['sale-outbound', 'sale-delivery', 'sale-signoff'].includes(entity))
    return
  const historicalSignoff =
    entity === 'sale-signoff' && priorFact(payload) !== undefined
  const sourceEntity = historicalSignoff
    ? 'sale-outbound'
    : entity === 'sale-outbound'
      ? 'sale-order'
      : entity === 'sale-delivery'
        ? 'sale-outbound'
        : 'sale-delivery'
  if (
    payload.parentEntity !== sourceEntity ||
    !payload.parentDocumentId ||
    !(entity === 'sale-signoff'
      ? 'signoffLines' in payload
      : 'sourceLines' in payload)
  )
    throw new VouApplicationError('vou_parent_invalid')
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`vou:document:${payload.parentDocumentId}`}, 0))`.execute(
    tx,
  )
  const sourceTable =
    sourceEntity === 'sale-order'
      ? 'vou_sale_order_details'
      : sourceEntity === 'sale-outbound'
        ? 'vou_sale_outbound_details'
        : 'vou_sale_delivery_details'
  const parent = (
    await sql<{ id: string; business_date: string; currency: string }>`
    SELECT entry.id, detail.business_date::text AS business_date, detail.currency
    FROM approval_entries entry
    JOIN ${sql.table(sourceTable)} detail ON detail.approval_entry_id = entry.id
    WHERE entry.domain = 'vou' AND entry.entity = ${sourceEntity}
      AND entry.subject_id = ${payload.parentDocumentId} AND entry.status = 'APPROVED'
  `.execute(tx)
  ).rows[0]
  if (
    !parent ||
    payload.businessDate < parent.business_date ||
    payload.currency !== parent.currency
  )
    throw new VouApplicationError('vou_source_line_unavailable')
  const continuation = await priorSaleContinuation(tx, entity, payload)
  if (
    continuation &&
    (payload.businessDate < continuation.fact.capturedAt.slice(0, 10) ||
      (entity === 'sale-outbound' && continuation.fact.sourceClosed))
  )
    throw new VouApplicationError('vou_source_line_unavailable')
  if (continuation) {
    const opening =
      await sql`SELECT entry.id FROM acc_books book JOIN approval_entries entry ON entry.subject_id = book.id
      AND entry.domain = 'vou' AND entry.entity = 'opening' AND entry.status = 'APPROVED'
      WHERE book.control_book`.execute(tx)
    if (!opening.rows.length)
      throw new VouApplicationError('acc_period_opening_not_approved')
  }
  if (entity === 'sale-signoff' && 'customer' in payload) {
    const order = await readApprovedSaleOrderSource(tx, entity, payload)
    const customer = order
      ? await tx
          .selectFrom('vou_reference_snapshots')
          .select('object_id')
          .where('approval_entry_id', '=', order.orderApprovalEntryId)
          .where('field', '=', 'customer')
          .where('line_no', '=', 0)
          .where('item_no', '=', 0)
          .executeTakeFirst()
      : undefined
    if (!customer || customer.object_id !== payload.customer.objectId)
      throw new VouApplicationError('vou_source_line_unavailable')
  }
  if (
    continuation &&
    entity === 'sale-signoff' &&
    'signoffLines' in payload &&
    payload.signoffLines.some((line) => {
      const quantity = decimalToFixed(line.rejectedBaseQuantity, 6)
      if (quantity === null)
        throw new VouApplicationError('vou_invalid_payload')
      return quantity > 0n
    })
  ) {
    const original = (
      await sql<{ id: string; document_id: string }>`
      SELECT outbound_entry.id, outbound.document_id
      FROM vou_sale_delivery_details delivery
      JOIN vou_sale_outbound_details outbound ON outbound.document_id = delivery.parent_document_id
      JOIN approval_entries outbound_entry ON outbound_entry.id = outbound.approval_entry_id AND outbound_entry.status = 'APPROVED'
      JOIN vou_prior_facts prior ON prior.approval_entry_id = outbound_entry.id
      WHERE delivery.approval_entry_id = ${parent.id}
    `.execute(tx)
    ).rows[0]
    if (original)
      throw new VouApplicationError('acc_period_cost_source_missing', [
        { kind: 'VOU', entity: 'sale-outbound', id: original.document_id },
      ])
  }
  if (entity !== 'sale-outbound') {
    const existing = await tx
      .selectFrom(
        entity === 'sale-delivery'
          ? 'vou_sale_delivery_details'
          : 'vou_sale_signoff_details',
      )
      .select('document_id')
      .where('parent_document_id', '=', payload.parentDocumentId)
      .where('document_id', '<>', documentId)
      .executeTakeFirst()
    if (existing)
      throw new VouApplicationError('vou_source_line_unavailable', [
        { kind: 'VOU', entity, id: existing.document_id },
      ])
  }
  const rows = await sql<{ line_id: string; base_quantity_micros: string }>`
    SELECT ${sql.ref(entity === 'sale-outbound' ? 'line.line_id' : 'line.source_line_id')} AS line_id,
      line.base_quantity_micros::text AS base_quantity_micros
    FROM ${sql.table(entity === 'sale-outbound' ? 'vou_product_line_snapshots' : 'vou_source_line_snapshots')} line
    WHERE line.approval_entry_id = ${parent.id}
  `.execute(tx)
  const quantities = new Map(
    rows.rows.map((row) => [row.line_id, BigInt(row.base_quantity_micros)]),
  )
  if (entity === 'sale-delivery')
    await subtractPriorSaleDisposition(
      tx,
      parent.id,
      payload.parentDocumentId!,
      quantities,
    )
  const dispatched =
    entity === 'sale-outbound'
      ? await saleOrderOccupancy(tx, payload.parentDocumentId!, documentId)
      : { rows: [] }
  const used = new Map(
    dispatched.rows.map((row) => [
      row.source_line_id,
      BigInt(row.occupied_quantity),
    ]),
  )
  const seen = new Set<string>()
  const lines =
    'sourceLines' in payload
      ? payload.sourceLines
      : 'signoffLines' in payload
        ? payload.signoffLines
        : []
  for (const line of lines) {
    const values =
      'baseQuantity' in line
        ? [line.baseQuantity]
        : [
            line.signedBaseQuantity,
            line.rejectedBaseQuantity,
            ...('lostBaseQuantity' in line &&
            line.lostBaseQuantity !== undefined
              ? [line.lostBaseQuantity]
              : []),
          ]
    if (values.some((value) => !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)))
      throw new VouApplicationError('vou_invalid_payload')
    const requested = values.reduce(
      (sum, value) => sum + decimalToFixed(value, 6)!,
      0n,
    )
    if (
      (entity !== 'sale-signoff' && requested <= 0n) ||
      seen.has(line.sourceLineId)
    )
      throw new VouApplicationError('vou_invalid_payload')
    seen.add(line.sourceLineId)
    const available = quantities.get(line.sourceLineId)
    if (available === undefined)
      throw new VouApplicationError('vou_source_line_unavailable')
    if (requested + (used.get(line.sourceLineId) ?? 0n) > available)
      throw new VouApplicationError('vou_source_line_quantity_exceeded')
    if (entity === 'sale-delivery' && requested !== available)
      throw new VouApplicationError('vou_source_line_quantity_exceeded')
  }
  if (entity !== 'sale-outbound' && seen.size !== quantities.size)
    throw new VouApplicationError('vou_source_line_unavailable')
}

async function subtractPriorSaleDisposition(
  executor: Kysely<DB> | Transaction<DB>,
  sourceApprovalEntryId: string,
  sourceDocumentId: string,
  quantities: Map<string, bigint>,
) {
  if (!(await readPriorFact(executor, sourceApprovalEntryId))) return
  const dispositions = await sql<{
    source_line_id: string
    signed: string
    rejected: string
    lost: string | null
  }>`
      SELECT line.source_line_id, line.signed_quantity_micros::text AS signed,
        line.rejected_quantity_micros::text AS rejected, line.prior_lost_quantity_micros::text AS lost
      FROM vou_sale_signoff_details detail JOIN approval_entries entry ON entry.id = detail.approval_entry_id AND entry.status = 'APPROVED'
      JOIN vou_prior_facts prior ON prior.approval_entry_id = entry.id
      JOIN vou_signoff_line_snapshots line ON line.approval_entry_id = entry.id
      WHERE detail.parent_document_id = ${sourceDocumentId}
    `.execute(executor)
  if (
    dispositions.rows.length !== quantities.size ||
    dispositions.rows.some((line) => line.lost === null)
  )
    throw new VouApplicationError('vou_source_line_unavailable')
  for (const line of dispositions.rows) {
    const dispatched = quantities.get(line.source_line_id)
    if (dispatched === undefined)
      throw new VouApplicationError('vou_source_line_unavailable')
    const remaining =
      dispatched -
      BigInt(line.signed) -
      BigInt(line.rejected) -
      BigInt(line.lost!)
    if (remaining < 0n)
      throw new VouApplicationError('vou_source_line_quantity_exceeded')
    if (remaining === 0n) quantities.delete(line.source_line_id)
    else quantities.set(line.source_line_id, remaining)
  }
}

/** Exact approved source quantities for a new ordinary continuation; does not persist a draft. */
export async function saleContinuationSourceLines(
  tx: Transaction<DB>,
  entity: 'sale-outbound' | 'sale-delivery' | 'sale-signoff',
  sourceApprovalEntryId: string,
  sourceDocumentId: string,
) {
  const rows = await sql<{ source_line_id: string; quantity: string }>`
    SELECT ${sql.ref(entity === 'sale-outbound' ? 'line_id' : 'source_line_id')} AS source_line_id,
      base_quantity_micros::text AS quantity FROM ${sql.table(entity === 'sale-outbound' ? 'vou_product_line_snapshots' : 'vou_source_line_snapshots')}
    WHERE approval_entry_id = ${sourceApprovalEntryId} ORDER BY line_no
  `.execute(tx)
  const quantities = new Map(
    rows.rows.map((row) => [row.source_line_id, BigInt(row.quantity)]),
  )
  if (entity === 'sale-delivery')
    await subtractPriorSaleDisposition(
      tx,
      sourceApprovalEntryId,
      sourceDocumentId,
      quantities,
    )
  if (entity === 'sale-outbound') {
    const occupied = await saleOrderOccupancy(tx, sourceDocumentId)
    for (const row of occupied.rows) {
      const ordered = quantities.get(row.source_line_id)
      if (ordered === undefined)
        throw new VouApplicationError('vou_source_line_unavailable')
      quantities.set(
        row.source_line_id,
        ordered - BigInt(row.occupied_quantity),
      )
    }
  }
  return [...quantities]
    .filter(([, quantity]) => quantity > 0n)
    .map(([sourceLineId, quantity]) => {
      const digits = quantity.toString().padStart(7, '0')
      return {
        sourceLineId,
        baseQuantity: `${digits.slice(0, -6)}.${digits.slice(-6)}`,
      }
    })
}

/** Historical signed demand and the still-outstanding part together consume the original order. */
async function saleOrderOccupancy(
  tx: Transaction<DB>,
  orderId: string,
  excludedOutboundId: string | null = null,
  reversedSignoffId: string | null = null,
) {
  return sql<{
    source_line_id: string
    ordered_quantity: string
    occupied_quantity: string
    dependent_ids: string[]
  }>`
    SELECT line.source_line_id, original.base_quantity_micros::text AS ordered_quantity,
      SUM(CASE WHEN signed_entry.id IS NOT NULL AND signed_line.source_line_id IS NOT NULL
        THEN signed_line.signed_quantity_micros + COALESCE(prior_line.signed_quantity_micros, 0)
        ELSE line.base_quantity_micros - COALESCE(prior_line.rejected_quantity_micros, 0)
          - COALESCE(prior_line.prior_lost_quantity_micros, 0) END)::text AS occupied_quantity,
      ARRAY_AGG(DISTINCT detail.document_id) AS dependent_ids
    FROM approval_entries order_entry
    JOIN vou_product_line_snapshots original ON original.approval_entry_id = order_entry.id
    JOIN vou_sale_outbound_details detail ON detail.parent_document_id = order_entry.subject_id
    JOIN approval_entries entry ON entry.id = detail.approval_entry_id AND entry.status = 'APPROVED'
    JOIN vou_source_line_snapshots line ON line.approval_entry_id = entry.id AND line.source_line_id = original.line_id
    LEFT JOIN LATERAL (
      SELECT prior_line.source_line_id, SUM(prior_line.signed_quantity_micros) AS signed_quantity_micros,
        SUM(prior_line.rejected_quantity_micros) AS rejected_quantity_micros,
        SUM(prior_line.prior_lost_quantity_micros) AS prior_lost_quantity_micros
      FROM vou_sale_signoff_details prior_signoff
      JOIN approval_entries prior_entry ON prior_entry.id = prior_signoff.approval_entry_id AND prior_entry.status = 'APPROVED'
      JOIN vou_prior_facts prior_fact ON prior_fact.approval_entry_id = prior_entry.id
      JOIN vou_signoff_line_snapshots prior_line ON prior_line.approval_entry_id = prior_entry.id
      WHERE prior_signoff.parent_document_id = detail.document_id
        AND prior_line.source_line_id = line.source_line_id
        AND (${reversedSignoffId}::varchar IS NULL OR prior_signoff.document_id <> ${reversedSignoffId})
      GROUP BY prior_line.source_line_id
    ) prior_line ON TRUE
    LEFT JOIN vou_sale_delivery_details delivery ON delivery.parent_document_id = detail.document_id
    LEFT JOIN approval_entries delivery_entry ON delivery_entry.id = delivery.approval_entry_id AND delivery_entry.status = 'APPROVED'
    LEFT JOIN vou_sale_signoff_details signoff ON signoff.parent_document_id = delivery_entry.subject_id
    LEFT JOIN approval_entries signed_entry ON signed_entry.id = signoff.approval_entry_id AND signed_entry.status = 'APPROVED'
      AND (${reversedSignoffId}::varchar IS NULL OR signoff.document_id <> ${reversedSignoffId})
    LEFT JOIN vou_signoff_line_snapshots signed_line ON signed_line.approval_entry_id = signed_entry.id AND signed_line.source_line_id = line.source_line_id
    WHERE order_entry.domain = 'vou' AND order_entry.entity = 'sale-order' AND order_entry.status = 'APPROVED'
      AND order_entry.subject_id = ${orderId}
      AND (${excludedOutboundId}::varchar IS NULL OR detail.document_id <> ${excludedOutboundId})
    GROUP BY line.source_line_id, original.base_quantity_micros
  `.execute(tx)
}

/** Reversing a completed signoff restores demand while retaining any immutable prior fulfillment. */
export async function saleSignoffUnapproveBlockers(
  tx: Transaction<DB>,
  documentId: string,
): Promise<Array<{ kind: 'DOWNSTREAM_DOCUMENT'; id: string }>> {
  const removed = (
    await sql<{ outbound_id: string; order_id: string }>`
    SELECT outbound.document_id AS outbound_id, outbound.parent_document_id AS order_id
    FROM vou_sale_signoff_details signoff
    LEFT JOIN vou_sale_delivery_details delivery ON delivery.document_id = signoff.parent_document_id
    JOIN vou_sale_outbound_details outbound ON outbound.document_id = CASE WHEN signoff.parent_entity = 'sale-outbound'
      THEN signoff.parent_document_id ELSE delivery.parent_document_id END
    WHERE signoff.document_id = ${documentId}
  `.execute(tx)
  ).rows[0]
  if (!removed) return []
  const quantities = await saleOrderOccupancy(
    tx,
    removed.order_id,
    null,
    documentId,
  )
  const ids = new Set<string>()
  for (const line of quantities.rows)
    if (BigInt(line.occupied_quantity) > BigInt(line.ordered_quantity))
      for (const id of line.dependent_ids ?? [])
        if (id !== removed.outbound_id) ids.add(id)
  return [...ids].map((id) => ({ kind: 'DOWNSTREAM_DOCUMENT', id }))
}

/** Public readback never converts an unproved residual into loss or known transit. */
export async function readPriorSaleDisposition(
  executor: Kysely<DB> | Transaction<DB>,
  entity: VouEntity,
  payload: VouPayload,
): Promise<VouPriorSaleDisposition[] | undefined> {
  if (
    entity !== 'sale-signoff' ||
    !priorFact(payload) ||
    !('signoffLines' in payload)
  )
    return undefined
  const parent = await sql<{ source_line_id: string; quantity: string }>`
    SELECT line.source_line_id, line.base_quantity_micros::text AS quantity
    FROM approval_entries entry JOIN vou_source_line_snapshots line ON line.approval_entry_id = entry.id
    WHERE entry.domain = 'vou' AND entry.entity = 'sale-outbound'
      AND entry.subject_id = ${payload.parentDocumentId} AND entry.status = 'APPROVED'
    ORDER BY line.line_no
  `.execute(executor)
  const quantities = new Map(
    parent.rows.map((row) => [row.source_line_id, BigInt(row.quantity)]),
  )
  const quantity = (value: bigint) => {
    const digits = value.toString().padStart(7, '0')
    return `${digits.slice(0, -6)}.${digits.slice(-6)}`
  }
  return payload.signoffLines.map((line) => {
    const dispatched = quantities.get(line.sourceLineId)
    if (dispatched === undefined)
      throw new VouApplicationError('vou_source_line_unavailable')
    const signed = decimalToFixed(line.signedBaseQuantity, 6)!,
      rejected = decimalToFixed(line.rejectedBaseQuantity, 6)!,
      lost =
        line.lostBaseQuantity === undefined
          ? null
          : decimalToFixed(line.lostBaseQuantity, 6)!
    const unresolved = dispatched - signed - rejected - (lost ?? 0n)
    if (unresolved < 0n)
      throw new VouApplicationError('vou_source_line_quantity_exceeded')
    return {
      sourceLineId: line.sourceLineId,
      dispatchedBaseQuantity: quantity(dispatched),
      signedBaseQuantity: quantity(signed),
      rejectedBaseQuantity: quantity(rejected),
      lostBaseQuantity: lost === null ? null : quantity(lost),
      unresolvedBaseQuantity: quantity(unresolved),
      inTransitBaseQuantity: lost === null ? null : quantity(unresolved),
    }
  })
}
