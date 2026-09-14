import { sql, type Kysely, type Transaction } from 'kysely'
import type {
  TaxInformationSnapshot,
  VouInvoiceFacts,
  VouVersionedReferenceInput,
} from '@zerp/model'
import type { DB } from '../db/generated.ts'
import { VouApplicationError } from './service.ts'

export type InvoiceEntity = 'sale-invoice' | 'purchase-invoice'
const archiveEntity = (entity: InvoiceEntity) =>
  entity === 'sale-invoice' ? 'customer' : 'supplier'
type Executor = Kysely<DB> | Transaction<DB>

async function associations(
  db: Executor,
  entity: InvoiceEntity,
  objectId: string,
) {
  const archive = archiveEntity(entity)
  const result = await sql<{
    approval_entry_id: string
    tax_information: TaxInformationSnapshot[]
  }>`
    SELECT version.approval_entry_id, version.tax_information
    FROM bob_archive_objects subject
    JOIN LATERAL (SELECT id FROM approval_entries WHERE domain = 'dcl' AND entity = ${archive}
      AND subject_id = subject.id AND status = 'APPROVED' ORDER BY version_no DESC LIMIT 1) current ON TRUE
    JOIN ${sql.table(`dcl_${archive}_versions`)} version ON version.approval_entry_id = current.id
    WHERE subject.id = ${objectId} AND subject.entity = ${archive} AND subject.enabled
  `.execute(db)
  if (!result.rows[0])
    throw new VouApplicationError('vou_reference_unavailable')
  return result.rows[0]
}
export async function invoiceTaxOptions(
  db: Executor,
  entity: InvoiceEntity,
  objectId: string,
) {
  const current = await associations(db, entity, objectId)
  const ids = current.tax_information.map((item) => item.id)
  const result = ids.length
    ? await db
        .selectFrom('aux_objects')
        .select(['id', 'code', 'revision', 'data'])
        .where('entity', '=', 'tax-information')
        .where('enabled', '=', true)
        .where('id', 'in', ids)
        .orderBy('code')
        .execute()
    : []
  return {
    approvalEntryId: current.approval_entry_id,
    items: result.map(
      (row) =>
        ({
          ...(row.data as object),
          id: row.id,
          code: row.code,
          revision: String(row.revision),
        }) as TaxInformationSnapshot,
    ),
  }
}
export async function freezeInvoiceTax(
  tx: Transaction<DB>,
  entity: InvoiceEntity,
  party: VouVersionedReferenceInput,
  payload: VouInvoiceFacts,
) {
  const archive = archiveEntity(entity)
  // The archive service holds this same lock while changing its approved baseline.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`dcl:archive:${archive}:${party.objectId}`}, 0))`.execute(
    tx,
  )
  const subject = await tx
    .selectFrom('bob_archive_objects')
    .select('enabled')
    .where('id', '=', party.objectId)
    .forShare()
    .executeTakeFirst()
  if (!subject?.enabled) throw new VouApplicationError('vou_invoice_tax_stale')
  const current = await associations(tx, entity, party.objectId)
  if (
    current.approval_entry_id !== party.approvalEntryId ||
    !current.tax_information.some(
      (item) => item.id === payload.taxInformation.id,
    )
  )
    throw new VouApplicationError('vou_invoice_tax_stale')
  const row = await tx
    .selectFrom('aux_objects')
    .select(['id', 'code', 'revision', 'data', 'enabled'])
    .where('id', '=', payload.taxInformation.id)
    .where('entity', '=', 'tax-information')
    .forShare()
    .executeTakeFirst()
  if (!row?.enabled || String(row.revision) !== payload.taxInformation.revision)
    throw new VouApplicationError('vou_invoice_tax_stale')
  payload.taxInformation = {
    ...(row.data as object),
    id: row.id,
    code: row.code,
    revision: String(row.revision),
  } as TaxInformationSnapshot
}

export interface InvoiceSource {
  sourceDocumentId: string
  sourceApprovalEntryId: string
  sourceLineId: string
  documentNo: string
  businessDate: string
  partyId: string
  operatingEntityId: string | null
  currency: string
  amount: string
  availableAmount: string
  unitPrice: string
}
import { readVouPersistence, decimalToFixed } from './service.ts'
import type { VouPayloadFor } from '@zerp/model'
const units = (value: string, scale = 2) => {
  const result = decimalToFixed(value, scale)
  if (result === null) throw new VouApplicationError('vou_invalid_payload')
  return result
}
const money = (value: bigint) => {
  const sign = value < 0n ? '-' : ''
  const digits = (value < 0n ? -value : value).toString().padStart(3, '0')
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`
}
const lineAmount = (quantity: string, price: string) =>
  (units(quantity, 6) * units(price)) / 1000000n
const sourceKey = (documentId: string, lineId: string) =>
  `${documentId}:${lineId}`
export async function lockInvoiceAmounts(tx: Transaction<DB>) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended('vou:invoice:allocations', 0))`.execute(
    tx,
  )
}

export async function invoiceSources(
  db: Executor,
  entity: InvoiceEntity,
  asOfDate: string,
  reserved = false,
  excludeDocumentId = '',
): Promise<InvoiceSource[]> {
  const sourceEntity =
    entity === 'sale-invoice' ? 'sale-signoff' : 'purchase-inbound'
  const returnEntity =
    entity === 'sale-invoice' ? 'sale-return' : 'purchase-return'
  const approved = await db
    .selectFrom('approval_entries as entry')
    .innerJoin('vou_documents as document', 'document.id', 'entry.subject_id')
    .select([
      'entry.id',
      'entry.entity',
      'entry.subject_id',
      'document.document_no',
    ])
    .where('entry.domain', '=', 'vou')
    .where('entry.status', '=', 'APPROVED')
    .where('entry.entity', 'in', [sourceEntity, returnEntity])
    .execute()
  const cache = new Map<
    string,
    Awaited<ReturnType<typeof readVouPersistence>>
  >()
  const read = async (documentId: string) => {
    let value = cache.get(documentId)
    if (!value) {
      value = await readVouPersistence(db, { documentId })
      cache.set(documentId, value)
    }
    return value
  }
  const salesOrder = async (documentId: string) => {
    const seen = new Set<string>()
    let doc = await read(documentId)
    while (doc.entity !== 'sale-order') {
      if (seen.has(doc.documentId) || !doc.payload.parentDocumentId)
        throw new VouApplicationError('vou_invoice_source_unavailable')
      seen.add(doc.documentId)
      doc = await read(doc.payload.parentDocumentId)
    }
    return doc.payload as VouPayloadFor<'sale-order'>
  }
  const facts: InvoiceSource[] = [],
    prices = new Map<string, string>()
  for (const meta of approved.filter((item) => item.entity === sourceEntity)) {
    const doc = await read(meta.subject_id)
    if (doc.businessDate > asOfDate) continue
    if (entity === 'sale-invoice') {
      const payload = doc.payload as VouPayloadFor<'sale-signoff'>,
        order = await salesOrder(meta.subject_id)
      for (const line of payload.signoffLines) {
        const product = order.productLines.find(
          (item) => item.lineId === line.sourceLineId,
        )
        if (!product)
          throw new VouApplicationError('vou_invoice_source_unavailable')
        const amount = money(
          lineAmount(line.signedBaseQuantity, product.unitPrice),
        )
        facts.push({
          sourceDocumentId: meta.subject_id,
          sourceApprovalEntryId: meta.id,
          sourceLineId: line.sourceLineId,
          documentNo: meta.document_no,
          businessDate: doc.businessDate,
          partyId: order.customer.objectId,
          operatingEntityId: order.operatingEntity.objectId,
          currency: doc.payload.currency,
          unitPrice: product.unitPrice,
          amount,
          availableAmount: amount,
        })
        prices.set(
          sourceKey(meta.subject_id, line.sourceLineId),
          product.unitPrice,
        )
      }
    } else {
      const payload = doc.payload as VouPayloadFor<'purchase-inbound'>
      for (const line of payload.sourceLines) {
        if (!payload.parentDocumentId)
          throw new VouApplicationError('vou_invoice_source_unavailable')
        const source = await read(payload.parentDocumentId)
        if (source.entity !== 'purchase-order')
          throw new VouApplicationError('vou_invoice_source_unavailable')
        const order = source.payload as VouPayloadFor<'purchase-order'>
        const product = order.productLines.find(
          (item) => item.lineId === line.sourceLineId,
        )
        if (!product || order.supplier.objectId !== payload.supplier.objectId)
          throw new VouApplicationError('vou_invoice_source_unavailable')
        const amount = money(lineAmount(line.baseQuantity, product.unitPrice))
        facts.push({
          sourceDocumentId: meta.subject_id,
          sourceApprovalEntryId: meta.id,
          sourceLineId: line.sourceLineId,
          documentNo: meta.document_no,
          businessDate: doc.businessDate,
          partyId: payload.supplier.objectId,
          operatingEntityId: null,
          currency: doc.payload.currency,
          unitPrice: product.unitPrice,
          amount,
          availableAmount: amount,
        })
        prices.set(
          sourceKey(meta.subject_id, line.sourceLineId),
          product.unitPrice,
        )
      }
    }
  }
  for (const meta of approved.filter((item) => item.entity === returnEntity)) {
    const doc = await read(meta.subject_id)
    if (doc.businessDate > asOfDate) continue
    for (const line of (doc.payload as VouPayloadFor<'sale-return'>)
      .returnLines) {
      const fact = facts.find(
        (item) =>
          item.sourceDocumentId === line.sourceDocumentId &&
          item.sourceLineId === line.sourceLineId,
      )
      const price = prices.get(
        sourceKey(line.sourceDocumentId, line.sourceLineId),
      )
      if (!fact || price === undefined) continue
      fact.amount = money(
        units(fact.amount) - lineAmount(line.baseQuantity, price),
      )
      fact.availableAmount = fact.amount
    }
  }
  const invoices = await sql<{
    source_document_id: string
    source_line_id: string
    amount: string
  }>`
    SELECT line.source_document_id, line.source_line_id, SUM(line.amount_minor)::text AS amount
    FROM vou_invoice_line_snapshots line JOIN approval_entries entry ON entry.id = line.approval_entry_id
    JOIN ${sql.table(entity === 'sale-invoice' ? 'vou_sale_invoice_details' : 'vou_purchase_invoice_details')} detail ON detail.approval_entry_id = entry.id
    WHERE entry.entity = ${entity} AND entry.subject_id <> ${excludeDocumentId}
      AND (entry.status = 'APPROVED' OR (${reserved} AND entry.status = 'PENDING'))
      AND (${reserved} OR detail.business_date <= ${asOfDate}::date)
    GROUP BY line.source_document_id, line.source_line_id
  `.execute(db)
  for (const invoice of invoices.rows) {
    const fact = facts.find(
      (item) =>
        item.sourceDocumentId === invoice.source_document_id &&
        item.sourceLineId === invoice.source_line_id,
    )
    if (fact)
      fact.availableAmount = money(
        units(fact.availableAmount) - BigInt(invoice.amount),
      )
  }
  return facts
}
export async function validateInvoiceSources(
  tx: Transaction<DB>,
  entity: InvoiceEntity,
  documentId: string,
  partyId: string,
  payload: VouInvoiceFacts,
) {
  await lockInvoiceAmounts(tx)
  const sources = await invoiceSources(
    tx,
    entity,
    '9999-12-31',
    true,
    documentId,
  )
  const requested = new Map<string, bigint>()
  for (const line of payload.invoiceLines) {
    const amount = units(line.amount)
    if (amount <= 0n) throw new VouApplicationError('vou_invalid_payload')
    const fact = sources.find(
      (item) =>
        item.sourceDocumentId === line.sourceDocumentId &&
        item.sourceLineId === line.sourceLineId,
    )
    const key = sourceKey(line.sourceDocumentId, line.sourceLineId)
    const sum = (requested.get(key) ?? 0n) + amount
    requested.set(key, sum)
    if (
      !fact ||
      fact.sourceApprovalEntryId !== line.sourceApprovalEntryId ||
      fact.partyId !== partyId ||
      (fact.operatingEntityId &&
        fact.operatingEntityId !== payload.operatingEntity.objectId) ||
      fact.currency !== payload.currency ||
      fact.businessDate > payload.businessDate ||
      sum > units(fact.availableAmount)
    )
      throw new VouApplicationError('vou_invoice_source_unavailable', [
        { kind: 'DOWNSTREAM_DOCUMENT', id: line.sourceDocumentId },
      ])
  }
}
export async function validateReturnInvoiceCapacity(
  tx: Transaction<DB>,
  entity: 'sale-return' | 'purchase-return',
  payload: VouPayloadFor<'sale-return'>,
) {
  await lockInvoiceAmounts(tx)
  const sources = await invoiceSources(
    tx,
    entity === 'sale-return' ? 'sale-invoice' : 'purchase-invoice',
    '9999-12-31',
    true,
  )
  const requested = new Map<string, bigint>()
  for (const line of payload.returnLines) {
    const fact = sources.find(
      (item) =>
        item.sourceDocumentId === line.sourceDocumentId &&
        item.sourceLineId === line.sourceLineId,
    )
    if (!fact) throw new VouApplicationError('vou_invoice_source_unavailable')
    const key = sourceKey(line.sourceDocumentId, line.sourceLineId)
    const sum =
      (requested.get(key) ?? 0n) + lineAmount(line.baseQuantity, fact.unitPrice)
    requested.set(key, sum)
    if (sum > units(fact.availableAmount))
      throw new VouApplicationError('vou_invoice_source_unavailable', [
        { kind: 'DOWNSTREAM_DOCUMENT', id: line.sourceDocumentId },
      ])
  }
}
export async function unbilledSales(db: Executor, periodMonth: string) {
  const [year, month] = periodMonth.split('-').map(Number)
  const asOfDate = new Date(Date.UTC(year!, month!, 0))
    .toISOString()
    .slice(0, 10)
  const lines = await invoiceSources(db, 'sale-invoice', asOfDate)
  const groups = new Map<
    string,
    {
      sourceMonth: string
      customerId: string
      operatingEntityId: string
      currency: string
      amount: bigint
      sources: InvoiceSource[]
    }
  >()
  for (const line of lines) {
    const amount = units(line.availableAmount)
    if (!amount) continue
    const sourceMonth = line.businessDate.slice(0, 7)
    const key = `${sourceMonth}:${line.partyId}:${line.operatingEntityId}:${line.currency}`
    let group = groups.get(key)
    if (!group) {
      group = {
        sourceMonth,
        customerId: line.partyId,
        operatingEntityId: line.operatingEntityId!,
        currency: line.currency,
        amount: 0n,
        sources: [],
      }
      groups.set(key, group)
    }
    group.amount += amount
    group.sources.push(line)
  }
  const items = []
  for (const group of groups.values()) {
    const customer = (
      await sql<{
        code: string
        name: string
      }>`SELECT subject.code, version.display_name AS name FROM bob_archive_objects subject JOIN approval_entries entry ON entry.subject_id = subject.id AND entry.domain = 'dcl' AND entry.entity = 'customer' AND entry.status = 'APPROVED' JOIN dcl_customer_versions version ON version.approval_entry_id = entry.id WHERE subject.id = ${group.customerId} ORDER BY entry.version_no DESC LIMIT 1`.execute(
        db,
      )
    ).rows[0]
    const operatingEntity = await db
      .selectFrom('aux_objects')
      .select('data')
      .where('id', '=', group.operatingEntityId)
      .executeTakeFirst()
    if (!customer || !operatingEntity)
      throw new VouApplicationError('vou_invoice_source_unavailable')
    const data = operatingEntity.data as {
      shortName: string
      legalName: string
    }
    items.push({
      ...group,
      customerCode: customer.code,
      customerName: customer.name,
      operatingEntityName: data.shortName || data.legalName,
      amount: money(group.amount),
    })
  }
  return { periodMonth, items }
}
