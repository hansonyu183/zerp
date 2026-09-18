import { moneyCent as cent, roundMoneyUnits as roundMoney } from './money.ts'
import { intermediaryUnits, intermediaryDecimal } from '@zerp/model'
import { sql, type Transaction } from 'kysely'
import { ulid } from 'ulid'
import type { DB, JsonValue } from '../db/generated.ts'
import { AccApplicationError } from './service.ts'

const units = (value: string) => intermediaryUnits(value, 8)
const decimal = (value: bigint) => intermediaryDecimal(value, 8)
type InventoryRow = {
  id: string
  journal_id: string
  document_id: string | null
  source_kind: string
  source_line_id: string | null
  cost_source_document_id: string | null
  vou_entity: string | null
  production_line_no: number | null
  subject_id: string
  warehouse_id: string
  product_id: string
  business_date: string
  quantity: string
  amount: string
  direction: 'DEBIT' | 'CREDIT'
  currency: string
  dimensions: Record<string, string>
  cost_counterpart_subject_id: string | null
  cost_counterpart_dimensions: Record<string, string>
}

function monthEnd(month: string) {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, number!, 0)).toISOString().slice(0, 10)
}

export async function settleInventoryCost(
  tx: Transaction<DB>,
  bookId: string,
  month: string,
): Promise<void> {
  const facts = await sql<InventoryRow>`
    SELECT inventory.id, inventory.document_id, journal.source_kind, inventory.source_line_id, inventory.cost_source_document_id, journal.id AS journal_id, document.entity AS vou_entity, inventory.production_line_no, inventory.subject_id, inventory.warehouse_id,
      inventory.product_id, inventory.business_date::text,
      inventory.quantity::text, line.amount::text, line.direction,
      journal.currency, line.dimensions,
      inventory.cost_counterpart_subject_id, inventory.cost_counterpart_dimensions
    FROM acc_inventory_entries inventory
    JOIN acc_journal_entries journal ON journal.id = inventory.journal_entry_id
    JOIN acc_journal_lines line ON line.id = inventory.line_id
    LEFT JOIN vou_documents document ON document.id = journal.vou_document_id
    WHERE inventory.book_id = ${bookId} AND inventory.business_date <= ${monthEnd(month)}::date
    ORDER BY inventory.business_date, journal.created_at, journal.id,
      COALESCE(inventory.production_line_no, inventory.line_no),
      CASE WHEN inventory.production_line_no IS NOT NULL AND inventory.quantity < 0 THEN 0 ELSE 1 END,
      inventory.line_no
  `.execute(tx)
  const productionGroups = new Map<string, InventoryRow[]>()
  for (const fact of facts.rows) {
    if (
      fact.vou_entity !== 'self-production' &&
      fact.vou_entity !== 'order-production'
    )
      continue
    if (fact.production_line_no === null)
      throw new AccApplicationError('acc_period_cost_source_missing', [
        { kind: 'INVENTORY', id: fact.id },
      ])
    const key = `${fact.journal_id}:${fact.production_line_no}`
    const group = productionGroups.get(key) ?? []
    group.push(fact)
    productionGroups.set(key, group)
  }
  for (const group of productionGroups.values())
    if (
      group.filter((fact) => units(fact.quantity) > 0n).length !== 1 ||
      !group.some((fact) => units(fact.quantity) < 0n)
    )
      throw new AccApplicationError(
        'acc_period_cost_source_missing',
        group.map((fact) => ({ kind: 'INVENTORY', id: fact.id })),
      )
  const productionCosts = new Map<string, bigint>()
  const outboundCosts = new Map<
    string,
    Array<{
      quantity: bigint
      cost: bigint
      returnedQuantity: bigint
      returnedCost: bigint
    }>
  >()
  const pools = new Map<
    string,
    { quantity: bigint; value: bigint; rateValue: bigint; rateQuantity: bigint }
  >()
  const subjects = await tx
    .selectFrom('acc_subjects')
    .selectAll()
    .where('book_id', '=', bookId)
    .execute()
  for (const fact of facts.rows) {
    const blocker = {
      kind: 'INVENTORY',
      id: fact.id,
      bookId,
      subjectId: fact.subject_id,
      warehouseId: fact.warehouse_id,
      productId: fact.product_id,
    }
    if (fact.currency !== 'CNY')
      throw new AccApplicationError('acc_period_cost_currency_unsupported', [
        blocker,
      ])
    const key = `${fact.subject_id}:${fact.warehouse_id}:${fact.product_id}`
    const pool = pools.get(key) ?? {
      quantity: 0n,
      value: 0n,
      rateValue: 0n,
      rateQuantity: 0n,
    }
    const quantity = units(fact.quantity)
    const posted = units(fact.amount) * (fact.direction === 'DEBIT' ? 1n : -1n)
    if (posted % cent !== 0n || (quantity === 0n && posted !== 0n))
      throw new AccApplicationError('acc_period_cost_basis_missing', [blocker])
    if (quantity === 0n) continue
    if (pool.quantity + quantity < 0n)
      throw new AccApplicationError('acc_period_negative_inventory', [blocker])
    let cost = posted
    const productionKey =
      fact.production_line_no === null
        ? null
        : `${fact.journal_id}:${fact.production_line_no}`
    if (fact.vou_entity === 'sale-return') {
      const sourceKey = `${fact.cost_source_document_id}:${fact.source_line_id}:${fact.product_id}`
      const sources = outboundCosts.get(sourceKey)
      const original = sources?.length === 1 ? sources[0] : undefined
      if (
        !original ||
        quantity <= 0n ||
        original.returnedQuantity + quantity > original.quantity
      )
        throw new AccApplicationError('acc_period_cost_source_missing', [
          blocker,
        ])
      const remainder = original.cost - original.returnedCost
      const rounded = roundMoney(original.cost * quantity, original.quantity)
      cost =
        original.returnedQuantity + quantity === original.quantity ||
        rounded > remainder
          ? remainder
          : rounded
      original.returnedQuantity += quantity
      original.returnedCost += cost
    } else if (productionKey && quantity > 0n) {
      const materialCost = productionCosts.get(productionKey)
      if (materialCost === undefined)
        throw new AccApplicationError('acc_period_cost_source_missing', [
          blocker,
        ])
      cost = materialCost
    } else if (
      quantity < 0n ||
      (posted === 0n && fact.vou_entity === 'inventory-count')
    ) {
      if (pool.quantity <= 0n)
        throw new AccApplicationError('acc_period_cost_basis_missing', [
          blocker,
        ])
      const absoluteQuantity = quantity < 0n ? -quantity : quantity
      const rounded = roundMoney(
        pool.rateValue * absoluteQuantity,
        pool.rateQuantity,
      )
      const magnitude =
        quantity < 0n
          ? absoluteQuantity === pool.quantity || rounded > pool.value
            ? pool.value
            : rounded
          : rounded
      cost = quantity < 0n ? -magnitude : magnitude
    }
    if (
      (quantity > 0n && cost < 0n) ||
      (quantity > 0n &&
        cost === 0n &&
        posted === 0n &&
        fact.vou_entity !== 'purchase-inbound' &&
        fact.vou_entity !== 'inventory-count' &&
        fact.vou_entity !== 'sale-return' &&
        !productionKey &&
        fact.source_kind !== 'OPENING')
    )
      throw new AccApplicationError('acc_period_cost_basis_missing', [blocker])
    if (quantity < 0n && fact.document_id && fact.source_line_id) {
      const key = `${fact.document_id}:${fact.source_line_id}:${fact.product_id}`
      const origins = outboundCosts.get(key) ?? []
      origins.push({
        quantity: -quantity,
        cost: -cost,
        returnedQuantity: 0n,
        returnedCost: 0n,
      })
      outboundCosts.set(key, origins)
    }
    if (productionKey && quantity < 0n)
      productionCosts.set(
        productionKey,
        (productionCosts.get(productionKey) ?? 0n) - cost,
      )
    pool.quantity += quantity
    pool.value += cost
    if (quantity > 0n) {
      pool.rateValue = pool.value
      pool.rateQuantity = pool.quantity
    }
    pools.set(key, pool)
    if (fact.business_date.slice(0, 7) !== month) continue
    const adjustment = cost - posted
    let journalId: string | null = null
    if (adjustment !== 0n) {
      const counterpart = subjects.find(
        (subject) => subject.id === fact.cost_counterpart_subject_id,
      )
      const dimensions = fact.cost_counterpart_dimensions
      if (
        !counterpart?.enabled ||
        subjects.some((subject) => subject.parent_id === counterpart.id) ||
        (counterpart.required_dimensions as string[]).some(
          (dimension) => !dimensions[dimension],
        ) ||
        Object.values(dimensions).some((value) => !value)
      )
        throw new AccApplicationError('acc_period_cost_mapping_invalid', [
          blocker,
        ])
      journalId = ulid()
      await tx
        .insertInto('acc_journal_entries')
        .values({
          id: journalId,
          book_id: bookId,
          source_kind: 'COST_SETTLEMENT',
          business_date: new Date(`${monthEnd(month)}T00:00:00Z`),
          currency: 'CNY',
          created_at: new Date(),
        })
        .execute()
      const amount = decimal(adjustment < 0n ? -adjustment : adjustment)
      await tx
        .insertInto('acc_journal_lines')
        .values([
          {
            id: ulid(),
            journal_entry_id: journalId,
            subject_id: fact.subject_id,
            direction: adjustment > 0n ? 'DEBIT' : 'CREDIT',
            amount,
            dimensions: fact.dimensions as JsonValue,
          },
          {
            id: ulid(),
            journal_entry_id: journalId,
            subject_id: counterpart.id,
            direction: adjustment > 0n ? 'CREDIT' : 'DEBIT',
            amount,
            dimensions: dimensions as JsonValue,
          },
        ])
        .execute()
    }
    await tx
      .insertInto('acc_inventory_cost_allocations')
      .values({
        inventory_entry_id: fact.id,
        book_id: bookId,
        period_month: month,
        cost_amount: decimal(cost),
        adjustment_amount: decimal(adjustment),
        journal_entry_id: journalId,
      })
      .execute()
  }
}

export async function removeInventoryCost(
  tx: Transaction<DB>,
  bookId: string,
  month: string,
): Promise<void> {
  await tx
    .deleteFrom('acc_inventory_cost_allocations')
    .where('book_id', '=', bookId)
    .where('period_month', '=', month)
    .execute()
  await tx
    .deleteFrom('acc_journal_entries')
    .where('book_id', '=', bookId)
    .where('source_kind', '=', 'COST_SETTLEMENT')
    .where(sql<boolean>`to_char(business_date, 'YYYY-MM') = ${month}`)
    .execute()
}
