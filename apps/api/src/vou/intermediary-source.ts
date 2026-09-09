import {
  intermediaryCanonical as canonical,
  intermediaryUnits as units,
  intermediaryDecimal as decimal,
} from '@zerp/model'
export {
  intermediaryCanonical as canonical,
  intermediaryUnits as units,
  intermediaryDecimal as decimal,
} from '@zerp/model'
import { createHash } from 'node:crypto'
import { sql, type Transaction } from 'kysely'
import type {
  VouIntermediaryCalculationInput,
  VouIntermediaryReference,
  VouPayloadFor,
  VouEntity,
  SettlementMethodSnapshot,
} from '@zerp/model'
import type { DB } from '../db/generated.ts'
import {
  readVouPersistence,
  VouApplicationError,
  type VouPersistenceReader,
} from './service.ts'
import {
  intermediaryCollectionDates,
  type IntermediaryCollectionEvent,
} from './intermediary-fifo.ts'

type Source = VouIntermediaryCalculationInput['source']
type SourceLine = Source['lines'][number]
type SourceBill = Source['bills'][number]
type Approved = {
  documentId: string
  documentNo: string
  approvalEntryId: string
  entity: VouEntity
  approvedDate: string
  revision: number
}
export const intermediarySourceHash = (source: Source) =>
  createHash('sha256').update(canonical(source)).digest('hex')
const prorate = (amount: bigint, quantity: bigint, total: bigint) =>
  total === 0n ? 0n : (amount * quantity + total / 2n) / total
const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
function dueDate(date: string, term: SettlementMethodSnapshot): string {
  const value = new Date(`${date}T00:00:00Z`)
  if (term.ruleType === 'RELATIVE_DAYS')
    value.setUTCDate(value.getUTCDate() + term.dayOffset)
  else {
    const month = value.getUTCMonth() + term.monthOffset
    const last = new Date(
      Date.UTC(value.getUTCFullYear(), month + 1, 0),
    ).getUTCDate()
    value.setUTCFullYear(
      value.getUTCFullYear(),
      month,
      term.dayOfMonth > 0 ? Math.min(term.dayOfMonth, last) : last,
    )
    value.setUTCDate(value.getUTCDate() + term.dayOffset)
  }
  return value.toISOString().slice(0, 10)
}
export function intermediaryPeriod(businessDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate))
    throw new VouApplicationError('vou_intermediary_month_end_required')
  const end = new Date(`${businessDate}T00:00:00Z`)
  const last = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  )
    .toISOString()
    .slice(0, 10)
  if (last !== businessDate)
    throw new VouApplicationError('vou_intermediary_month_end_required')
  return {
    periodStart: businessDate.slice(0, 7) + '-01',
    periodEnd: businessDate,
  }
}

export async function intermediaryControlBook(tx: Transaction<DB>) {
  const result = await sql<{ id: string; start_month: string }>`
    SELECT book.id, book.start_month FROM acc_books book
    JOIN approval_entries opening ON opening.subject_id = book.id AND opening.domain = 'vou' AND opening.entity = 'opening' AND opening.status = 'APPROVED'
    WHERE book.control_book FOR UPDATE OF book FOR SHARE OF opening
  `.execute(tx)
  if (!result.rows[0])
    throw new VouApplicationError('acc_control_book_unavailable')
  return result.rows[0]
}

type LineFact = {
  line: SourceLine
  rootLineId: string
  quantity: bigint
  originalQuantity: bigint
  originalAmount: bigint
  pieceDivisor: bigint
  returns: { date: string; quantity: bigint; documentNo: string }[]
}
export async function intermediarySource(
  tx: Transaction<DB>,
  businessDate: string,
): Promise<{ source: Source; sourceHash: string; dependencies: string[] }> {
  const period = intermediaryPeriod(businessDate),
    book = await intermediaryControlBook(tx)
  if (period.periodStart.slice(0, 7) < book.start_month)
    throw new VouApplicationError('vou_intermediary_before_book_start')
  const approvedRows = await sql<{
    id: string
    document_no: string
    approval_entry_id: string
    entity: VouEntity
    approved_date: string
    revision: string
  }>`
    SELECT document.id, document.document_no, entry.id AS approval_entry_id, entry.entity,
      (entry.approved_at AT TIME ZONE 'Asia/Shanghai')::date::text AS approved_date, entry.revision::text
    FROM vou_documents document JOIN approval_entries entry ON entry.subject_id = document.id AND entry.domain = 'vou'
    WHERE entry.status = 'APPROVED' AND entry.entity IN ('sale-signoff', 'sale-return', 'bill-receipt', 'intermediary-calculation', 'service-contract')
    ORDER BY document.document_no, document.id
  `.execute(tx)
  const approved: Approved[] = approvedRows.rows.map((row) => ({
    documentId: row.id,
    documentNo: row.document_no,
    approvalEntryId: row.approval_entry_id,
    entity: row.entity,
    approvedDate: row.approved_date,
    revision: Number(row.revision),
  }))
  const postedRows = await sql<{
    document_id: string
  }>`SELECT DISTINCT vou_document_id AS document_id FROM acc_journal_entries WHERE book_id = ${book.id} AND vou_document_id IS NOT NULL AND reversed_at IS NULL`.execute(
    tx,
  )
  const posted = new Set(postedRows.rows.map((row) => row.document_id))
  const cache = new Map<string, VouPersistenceReader>()
  const read = async (documentId: string) => {
    let value = cache.get(documentId)
    if (!value) {
      value = await readVouPersistence(tx, { documentId })
      cache.set(documentId, value)
    }
    return value
  }
  const orderFor = async (documentId: string) => {
    const seen = new Set<string>()
    let document = await read(documentId)
    while (document.entity !== 'sale-order') {
      if (seen.has(document.documentId) || !document.payload.parentDocumentId)
        throw new VouApplicationError('vou_intermediary_source_invalid')
      seen.add(document.documentId)
      document = await read(document.payload.parentDocumentId)
    }
    return document as VouPersistenceReader & {
      payload: VouPayloadFor<'sale-order'>
    }
  }
  const customerReference = async (
    approvalEntryId: string,
    field: string,
  ): Promise<VouIntermediaryReference> => {
    const result = await sql<{
      object_id: string
      approval_reference_id: string
      reference_code: string
      reference_name: string
    }>`
      SELECT ref.object_id, ref.approval_reference_id, root.code AS reference_code, subunit.name AS reference_name
      FROM vou_reference_snapshots ref
      JOIN bob_customer_subunit_roots root ON root.subunit_id = ref.object_id
      JOIN bob_customer_version_subunits subunit ON subunit.subunit_id = ref.object_id AND subunit.customer_approval_entry_id = ref.approval_reference_id
      WHERE ref.approval_entry_id = ${approvalEntryId} AND ref.field = ${field} AND ref.line_no = 0 AND ref.item_no = 0
    `.execute(tx)
    const row = result.rows[0]
    if (
      !row?.approval_reference_id ||
      !row.reference_code ||
      !row.reference_name
    )
      throw new VouApplicationError('vou_intermediary_source_basis_missing')
    return {
      entity: 'customer-subunit',
      objectId: row.object_id,
      approvalEntryId: row.approval_reference_id,
      code: row.reference_code,
      name: row.reference_name,
    }
  }
  const facts: LineFact[] = []
  const signoffs: {
    id: string
    customerId: string
    date: string
    documentNo: string
    amount: bigint
  }[] = []
  const contracts: {
    meta: Approved
    payload: VouPayloadFor<'service-contract'>
  }[] = []
  for (const meta of approved.filter(
    (row) => row.entity === 'service-contract',
  ))
    contracts.push({
      meta,
      payload: (await read(meta.documentId))
        .payload as VouPayloadFor<'service-contract'>,
    })
  for (const meta of approved.filter((row) => row.entity === 'sale-signoff')) {
    const signoff = await read(meta.documentId),
      payload = signoff.payload as VouPayloadFor<'sale-signoff'>
    if (
      payload.businessDate < `${book.start_month}-01` ||
      payload.businessDate > period.periodEnd ||
      payload.currency !== 'CNY'
    )
      continue
    const order = await orderFor(meta.documentId),
      orderPayload = order.payload
    const signoffAmount = payload.signoffLines.reduce((sum, line) => {
      const product = orderPayload.productLines.find(
        (row) => row.lineId === line.sourceLineId,
      )
      if (!product)
        throw new VouApplicationError('vou_intermediary_source_invalid')
      return (
        sum +
        (units(line.signedBaseQuantity, 6) * units(product.unitPrice) +
          500000n) /
          1000000n
      )
    }, 0n)
    if (signoffAmount !== 0n && !posted.has(meta.documentId)) continue
    const customer = await sql<{
      primary_sales_attribution_type: SourceLine['salesAttributionType'] | null
      primary_sales_attribution_object_id: string | null
      primary_sales_attribution_approval_entry_id: string | null
      primary_sales_attribution_code: string | null
      primary_sales_attribution_name: string | null
      settlement_snapshot: SettlementMethodSnapshot | null
      customer_type_snapshot: { code: string }
      transport_snapshot: { surcharge: string }
      pricing_snapshot: import('@zerp/model').CustomerPricingPolicy
    }>`SELECT primary_sales_attribution_type, primary_sales_attribution_object_id, primary_sales_attribution_approval_entry_id,
      primary_sales_attribution_code, primary_sales_attribution_name, settlement_snapshot, customer_type_snapshot, transport_snapshot, pricing_snapshot
      FROM bob_customer_version_subunits WHERE customer_approval_entry_id = ${orderPayload.customerSubunit.approvalEntryId} AND subunit_id = ${orderPayload.customerSubunit.objectId}`.execute(
      tx,
    )
    const basis = customer.rows[0]
    if (
      !basis?.primary_sales_attribution_type ||
      !basis.primary_sales_attribution_object_id ||
      !basis.primary_sales_attribution_code ||
      !basis.primary_sales_attribution_name ||
      !basis.settlement_snapshot ||
      !basis.pricing_snapshot ||
      !basis.transport_snapshot ||
      !basis.customer_type_snapshot?.code
    )
      throw new VouApplicationError('vou_intermediary_source_basis_missing', [
        { documentId: order.documentId },
      ])
    const salesperson: VouIntermediaryReference =
      basis.primary_sales_attribution_type === 'INTERNAL_EMPLOYEE'
        ? {
            entity: 'employee',
            objectId: basis.primary_sales_attribution_object_id,
            code: basis.primary_sales_attribution_code,
            name: basis.primary_sales_attribution_name,
          }
        : {
            entity: 'sales-partner',
            objectId: basis.primary_sales_attribution_object_id,
            approvalEntryId: basis.primary_sales_attribution_approval_entry_id!,
            code: basis.primary_sales_attribution_code,
            name: basis.primary_sales_attribution_name,
          }
    if (salesperson.entity === 'sales-partner' && !salesperson.approvalEntryId)
      throw new VouApplicationError('vou_intermediary_source_basis_missing', [
        { documentId: order.documentId },
      ])
    const applicable = contracts
      .filter(
        ({ payload: contract }) =>
          contract.counterpartyType === 'sales-partner' &&
          contract.counterparty.objectId === salesperson.objectId &&
          Boolean(contract.serviceContract.terms) &&
          contract.serviceContract.capabilities?.includes(
            basis.primary_sales_attribution_type as
              'EXTERNAL_PART_TIME' | 'CHANNEL_PARTNER',
          ) &&
          contract.serviceContract.applicableFrom !== undefined &&
          contract.serviceContract.applicableFrom <= payload.businessDate &&
          (!contract.serviceContract.applicableTo ||
            contract.serviceContract.applicableTo >= payload.businessDate),
      )
      .sort(
        (a, b) =>
          b.payload.serviceContract.applicableFrom!.localeCompare(
            a.payload.serviceContract.applicableFrom!,
          ) || b.meta.documentNo.localeCompare(a.meta.documentNo),
      )[0]
    let amount = 0n
    for (const signed of payload.signoffLines) {
      const orderLine = orderPayload.productLines.find(
        (line) => line.lineId === signed.sourceLineId,
      )
      if (!orderLine)
        throw new VouApplicationError('vou_intermediary_source_invalid')
      const quantity = units(signed.signedBaseQuantity, 6)
      if (quantity === 0n) continue
      const product = await sql<{
        object_id: string
        approval_reference_id: string
        reference_code: string
        reference_name: string
        behavior_profile: SourceLine['behaviorProfile']
        standard_piece_base_quantity_micros: string | null
        sales_reference_unit_price_minor: string | null
      }>`
        SELECT ref.object_id, line.sales_product_approval_entry_id AS approval_reference_id, subject.code AS reference_code, product.name AS reference_name, product.behavior_profile,
          line.standard_piece_base_quantity_micros::text, line.sales_reference_unit_price_minor::text
        FROM vou_product_line_snapshots line JOIN vou_reference_snapshots ref ON ref.approval_entry_id = line.approval_entry_id AND ref.line_no = line.line_no AND ref.field = 'product'
        JOIN bob_product_versions product ON product.approval_entry_id = line.sales_product_approval_entry_id
        JOIN bob_subjects subject ON subject.id = ref.object_id
        WHERE line.approval_entry_id = ${order.approvalEntryId} AND line.line_id = ${signed.sourceLineId}
      `.execute(tx)
      const productBasis = product.rows[0]
      if (
        !productBasis?.standard_piece_base_quantity_micros ||
        BigInt(productBasis.standard_piece_base_quantity_micros) <= 0n ||
        productBasis.sales_reference_unit_price_minor === null
      )
        throw new VouApplicationError('vou_intermediary_source_basis_missing', [
          { documentId: order.documentId, field: 'productLines' },
        ])
      const piece =
        (quantity * 1000000n) /
        BigInt(productBasis.standard_piece_base_quantity_micros)
      const lineAmount =
        (quantity * units(orderLine.unitPrice) + 500000n) / 1000000n
      amount += lineAmount
      const due = dueDate(payload.businessDate, basis.settlement_snapshot)
      const customerRef = await customerReference(
        order.approvalEntryId,
        'customerSubunit',
      )
      facts.push({
        rootLineId: signed.sourceLineId,
        quantity,
        originalQuantity: quantity,
        originalAmount: lineAmount,
        pieceDivisor: BigInt(productBasis.standard_piece_base_quantity_micros),
        returns: [],
        line: {
          sourceSignoffLineId: `${meta.documentId}:${signed.sourceLineId}`,
          sourceKind: 'SALE',
          signoffDocumentId: meta.documentId,
          signoffDocumentNo: meta.documentNo,
          signoffDate: payload.businessDate,
          orderDocumentId: order.documentId,
          orderDocumentNo: (
            await sql<{
              document_no: string
            }>`SELECT document_no FROM vou_documents WHERE id = ${order.documentId}`.execute(
              tx,
            )
          ).rows[0]!.document_no,
          orderDate: orderPayload.businessDate,
          dueDate: due,
          collectionDate: payload.businessDate,
          collectionDelayDays: 0,
          customer: customerRef,
          salesperson,
          salesAttributionType: basis.primary_sales_attribution_type,
          salesContractStatus:
            salesperson.entity === 'employee'
              ? 'NOT_REQUIRED'
              : applicable
                ? 'APPLICABLE'
                : 'MISSING',
          ...(applicable && salesperson.entity === 'sales-partner'
            ? {
                salesContract: {
                  documentId: applicable.meta.documentId,
                  revision: applicable.meta.revision,
                  applicableFrom:
                    applicable.payload.serviceContract.applicableFrom!,
                  ...(applicable.payload.serviceContract.applicableTo
                    ? {
                        applicableTo:
                          applicable.payload.serviceContract.applicableTo,
                      }
                    : {}),
                  terms: applicable.payload.serviceContract.terms!,
                },
              }
            : {}),
          product: {
            entity: 'product',
            objectId: productBasis.object_id,
            approvalEntryId: productBasis.approval_reference_id,
            code: productBasis.reference_code,
            name: productBasis.reference_name,
          },
          behaviorProfile: productBasis.behavior_profile,
          signedBaseQuantity: decimal(quantity, 6),
          pricingQuantity: decimal(piece, 6),
          standardPieceQuantity: decimal(piece, 6),
          unitPrice: orderLine.unitPrice,
          referenceUnitPrice: decimal(
            BigInt(productBasis.sales_reference_unit_price_minor),
          ),
          settlementSurcharge: orderLine.settlementSurcharge ?? '0.00',
          customerTypeCode: basis.customer_type_snapshot.code,
          paymentSurcharge:
            orderPayload.paymentMethod?.defaultSalesSurcharge ?? '0.00',
          transportSurcharge: basis.transport_snapshot.surcharge,
          ...basis.pricing_snapshot,
          lineAmount: decimal(lineAmount),
          settlementTermCode: basis.settlement_snapshot.termCode,
          specialApproval: orderPayload.specialApproval ?? false,
          adjustmentEmployeeAmount: '0.00',
          adjustmentIntermediaryAmount: '0.00',
        },
      })
    }
    signoffs.push({
      id: meta.documentId,
      customerId: orderPayload.customerSubunit.objectId,
      date: payload.businessDate,
      documentNo: meta.documentNo,
      amount,
    })
  }
  const events: IntermediaryCollectionEvent[] = []
  for (const meta of approved
    .filter((row) => row.entity === 'sale-return')
    .sort(
      (a, b) =>
        a.approvedDate.localeCompare(b.approvedDate) ||
        a.documentNo.localeCompare(b.documentNo),
    )) {
    if (meta.approvedDate > period.periodEnd) continue
    const payload = (await read(meta.documentId))
      .payload as VouPayloadFor<'sale-return'>
    for (const returned of payload.returnLines) {
      const fact = facts.find(
        (item) =>
          item.line.signoffDocumentId === returned.sourceDocumentId &&
          item.rootLineId === returned.sourceLineId,
      )
      if (!fact) continue
      if (fact.originalAmount !== 0n && !posted.has(meta.documentId)) continue
      const quantity = units(returned.baseQuantity, 6),
        previous = fact.originalQuantity - fact.quantity
      if (quantity > fact.quantity)
        throw new VouApplicationError('vou_intermediary_source_invalid')
      const amount =
        prorate(
          fact.originalAmount,
          previous + quantity,
          fact.originalQuantity,
        ) - prorate(fact.originalAmount, previous, fact.originalQuantity)
      fact.quantity -= quantity
      fact.returns.push({
        date: meta.approvedDate,
        quantity,
        documentNo: meta.documentNo,
      })
      events.push({
        kind: 'RETURN',
        id: `${meta.documentNo}:${returned.sourceLineId}`,
        customerId: fact.line.customer.objectId,
        date: meta.approvedDate,
        amount,
        sourceId: fact.line.signoffDocumentId,
      })
    }
  }
  const ledger = await sql<{
    id: string
    date: string
    customer_id: string
    source_kind: string
    entity: string | null
    amount: string
  }>`
    SELECT journal.id, journal.business_date::text AS date, line.dimensions->>'CUSTOMER_SUBUNIT' AS customer_id,
      journal.source_kind, document.entity,
      SUM(CASE WHEN line.direction = 'CREDIT' THEN line.amount ELSE -line.amount END)::text AS amount
    FROM acc_journal_entries journal JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
    JOIN acc_subjects subject ON subject.id = line.subject_id
    LEFT JOIN vou_documents document ON document.id = journal.vou_document_id
    WHERE journal.book_id = ${book.id} AND journal.currency = 'CNY' AND journal.business_date <= ${period.periodEnd}::date
      AND subject.settlement_purpose = 'RECEIVABLE' AND line.dimensions ? 'CUSTOMER_SUBUNIT'
    GROUP BY journal.id, journal.business_date, line.dimensions->>'CUSTOMER_SUBUNIT', journal.source_kind, document.entity
    ORDER BY journal.business_date, journal.id
  `.execute(tx)
  const opening = new Map<string, bigint>()
  for (const row of ledger.rows) {
    const amount = units(row.amount, 8) / 1000000n
    if (row.source_kind === 'OPENING' || row.date < `${book.start_month}-01`)
      opening.set(
        row.customer_id,
        (opening.get(row.customer_id) ?? 0n) - amount,
      )
    else if (row.entity !== 'sale-signoff' && row.entity !== 'sale-return')
      events.push({
        kind: 'PAYMENT',
        id: row.id,
        date: row.date,
        customerId: row.customer_id,
        amount,
      })
  }
  const dates = intermediaryCollectionDates(signoffs, events, opening)
  const prior: {
    meta: Approved
    calculation: VouIntermediaryCalculationInput
  }[] = []
  for (const meta of approved.filter(
    (row) => row.entity === 'intermediary-calculation',
  )) {
    const payload = (await read(meta.documentId))
      .payload as VouPayloadFor<'intermediary-calculation'>
    if (payload.businessDate < period.periodStart)
      prior.push({ meta, calculation: payload.intermediaryCalculation })
  }
  const lines: SourceLine[] = [],
    dependencies = new Set<string>()
  for (const fact of facts) {
    const original = prior
      .flatMap((item) =>
        item.calculation.source.lines.map((line) => ({ ...item, line })),
      )
      .find(
        (item) =>
          item.line.sourceSignoffLineId === fact.line.sourceSignoffLineId &&
          item.line.sourceKind === 'SALE',
      )
    if (original) {
      const before = fact.returns
        .filter(
          (row) =>
            row.date > original.calculation.source.periodEnd &&
            row.date < period.periodStart,
        )
        .reduce((sum, row) => sum + row.quantity, 0n)
      const current = fact.returns.filter(
        (row) => row.date >= period.periodStart && row.date <= period.periodEnd,
      )
      const quantity = current.reduce((sum, row) => sum + row.quantity, 0n)
      if (!quantity) continue
      const total = units(original.line.signedBaseQuantity, 6),
        result = original.calculation.result.lines.find(
          (line) =>
            line.sourceSignoffLineId === original.line.sourceSignoffLineId,
        )!
      if (!result || before + quantity > total)
        throw new VouApplicationError('vou_intermediary_source_invalid')
      const reversal = (amount: string) =>
        decimal(
          prorate(units(amount), before + quantity, total) -
            prorate(units(amount), before, total),
        )
      dependencies.add(original.meta.documentId)
      lines.push({
        ...original.line,
        sourceKind: 'RETURN_ADJUSTMENT',
        signedBaseQuantity: decimal(quantity, 6),
        pricingQuantity: decimal(
          (units(original.line.pricingQuantity, 6) * quantity) / total,
          6,
        ),
        standardPieceQuantity: decimal(
          (units(original.line.standardPieceQuantity, 6) * quantity) / total,
          6,
        ),
        returnDocumentNos: current.map((row) => row.documentNo),
        adjustmentEmployeeAmount: reversal(result.employeeAmount),
        adjustmentIntermediaryAmount: reversal(result.intermediaryAmount),
      })
    } else {
      const date = dates.get(fact.line.signoffDocumentId)
      if (
        !date ||
        date < period.periodStart ||
        date > period.periodEnd ||
        !fact.quantity
      )
        continue
      const pieceQuantity = decimal(
        (fact.quantity * 1000000n) / fact.pieceDivisor,
        6,
      )
      lines.push({
        ...fact.line,
        signedBaseQuantity: decimal(fact.quantity, 6),
        pricingQuantity: pieceQuantity,
        standardPieceQuantity: pieceQuantity,
        lineAmount: decimal(
          fact.originalAmount -
            prorate(
              fact.originalAmount,
              fact.originalQuantity - fact.quantity,
              fact.originalQuantity,
            ),
        ),
        collectionDate: date,
        collectionDelayDays: Math.max(0, days(fact.line.dueDate, date)),
      })
    }
  }
  const allocated = new Set(
    prior.flatMap((item) =>
      item.calculation.result.lines.flatMap((line) => [...line.billLineIds]),
    ),
  )
  const bills: SourceBill[] = []
  for (const meta of approved.filter((row) => row.entity === 'bill-receipt')) {
    const payload = (await read(meta.documentId))
      .payload as VouPayloadFor<'bill-receipt'>
    if (
      payload.currency !== 'CNY' ||
      payload.businessDate < `${book.start_month}-01`
    )
      continue
    for (const [index, bill] of payload.billLines.entries()) {
      if (!('billType' in bill) || bill.positionType !== 'ASSET') continue
      const billLineId = `${meta.documentId}:${index + 1}`
      const date =
        bill.billType === 'CHECK' ? bill.maturityDate : payload.businessDate
      if (date > period.periodEnd || allocated.has(billLineId)) continue
      bills.push({
        billLineId,
        receiptDocumentId: meta.documentId,
        receiptDocumentNo: meta.documentNo,
        receiptDate: payload.businessDate,
        customer: await customerReference(
          meta.approvalEntryId,
          'customerSubunit',
        ),
        billType: bill.billType,
        faceAmount: bill.faceAmount,
        issueDate: bill.issueDate,
        maturityDate: bill.maturityDate,
        costDays: Math.max(0, days(payload.businessDate, bill.maturityDate)),
      })
    }
  }
  const source: Source = {
    ...period,
    currency: 'CNY',
    lines: lines.sort((a, b) =>
      a.sourceSignoffLineId.localeCompare(b.sourceSignoffLineId),
    ),
    bills: bills.sort((a, b) => a.billLineId.localeCompare(b.billLineId)),
  }
  return {
    source,
    sourceHash: intermediarySourceHash(source),
    dependencies: [...dependencies].sort(),
  }
}
