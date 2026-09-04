import {
  availableApprovalActions,
  decideApproval,
  vouEntities,
  vouEntityInputDescriptors,
  vouEntityPresentation,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
  type VouPayload,
  type VouPayloadFor,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { DB, JsonValue } from '../db/generated.ts'
import type { AccApplicationPlan, PlanExecutor } from '../platform/transaction-coordinator.ts'
import { readVouPersistence } from '../vou/service.ts'
import { lockAccountingPeriod } from './period-lock.ts'

type Executor = Kysely<DB> | Transaction<DB>

export interface AccBookInput {
  id: string
  name: string
  description: string
  startMonth: string
  baseCurrency: string
}

export interface AccSubjectInput {
  id: string
  bookId: string
  code: string
  name: string
  parentId: string | null
  balanceDirection: 'DEBIT' | 'CREDIT'
  enabled: boolean
  requiredDimensions: string[]
  inventoryQuantity: boolean
  settlementPurpose: string
}

export interface AccOpeningInput {
  bookId: string
  submissionId: string
  idempotencyKey: string
  lines: Array<{
    subjectId: string
    currency: string
    direction: 'DEBIT' | 'CREDIT'
    amount: string
    dimensions: Record<string, string>
    quantity?: string
  }>
  assets: AccOpeningAsset[]
  bills: AccOpeningBill[]
  containers: AccOpeningContainer[]
}

export interface AccOpeningAsset {
  assetId?: string
  assetNo?: string
  name?: string
  categoryId?: string
  departmentId?: string
  usefulLifeMonths?: number
  residualRate?: string
  acquiredOn?: string
  currency: string
  originalValue: string
  accumulatedDepreciation: string
}

export interface AccOpeningArchiveReference {
  entity: 'customer' | 'supplier' | 'other-unit' | 'employee' | 'sales-partner' | 'operating-entity'
  objectId: string
  customerId?: string
  approvalEntryId: string
  code: string
  name: string
}

export interface AccOpeningBill {
  billId?: string
  billNo?: string
  billType?: string
  positionType?: 'ASSET' | 'LIABILITY'
  medium?: 'PAPER' | 'ELECTRONIC'
  currency: string
  faceAmount?: string
  issueDate?: string
  maturityDate?: string
  drawer?: string
  acceptor?: string
  payee?: string
  annualRateBps?: number
  interestDays?: number
  interestAmount?: string
  customerCostAmount?: string
  valueAmount: string
  originatingCounterparty?: AccOpeningArchiveReference
}

export interface AccOpeningContainer {
  subunit: {
    entity: 'customer-subunit'
    objectId: string
    customerId: string
    approvalEntryId: string
    code: string
    name: string
  }
  containerType: 'SOLVENT' | 'RESIN'
  quantity: number
}

export interface AccOpeningReviewInput {
  bookId: string
  submissionId: string
  expectedRevision: string
  reason?: string
}

export class AccApplicationError extends Error {
  readonly errorKey: string
  readonly data: { blockers: unknown[] } | null

  constructor(errorKey: string, blockers: unknown[] = []) {
    super(errorKey)
    this.name = 'AccApplicationError'
    this.errorKey = errorKey
    this.data = blockers.length === 0 ? null : { blockers }
  }
}

function requirePermission(actor: ApprovalActor, permission: string): void {
  if (actor.trusted !== true && !actor.permissions.includes(permission))
    throw new AccApplicationError('approval_invalid_action')
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue
}

function decimalUnits(value: string): bigint {
  const match = /^([0-9]+)(?:\.([0-9]{1,8}))?$/.exec(value)
  if (!match) throw new AccApplicationError('acc_amount_invalid')
  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? '').padEnd(8, '0'))
}

/** Journal-line amounts are unsigned; read-model balances may be negative. */
function signedDecimalUnits(value: string): bigint {
  const match = /^(-?)([0-9]+)(?:\.([0-9]{1,8}))?$/.exec(value)
  if (!match) throw new AccApplicationError('acc_control_balance_invalid')
  const units = BigInt(match[2]!) * 100_000_000n
    + BigInt((match[3] ?? '').padEnd(8, '0'))
  return match[1] === '-' ? -units : units
}

function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year!, monthNumber! - 2, 1))
  return date.toISOString().slice(0, 7)
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year!, monthNumber!, 1))
  return date.toISOString().slice(0, 7)
}

type InventoryFact = {
  bookId: string
  subjectId: string
  warehouseId: string
  productId: string
}

type FundFact = {
  bookId: string
  fundAccountId: string
  currency: string
}

export type AccSettlementPurpose =
  | 'RECEIVABLE'
  | 'ADVANCE_RECEIPT'
  | 'PAYABLE'
  | 'PREPAID'

export interface AccControlBalancePort {
  partyBalance(
    tx: Transaction<DB>,
    input: {
      counterpartyDimension: 'CUSTOMER_SUBUNIT' | 'SUPPLIER'
      counterpartyObjectId: string
      currency: string
      settlementPurpose: AccSettlementPurpose
      asOfDate: string
    },
  ): Promise<bigint>
  customerCreditOccupancy(
    tx: Transaction<DB>,
    input: { customerSubunitId: string; currency: string; asOfDate: string },
  ): Promise<bigint>
}

type AssetStatus = 'ACTIVE' | 'SOLD' | 'RETIRED'
type BillStatus = 'AVAILABLE' | 'REPLACED' | 'PAID' | 'DISCOUNTED' | 'MATURED'

function billOutgoingStatus(entity: 'bill-receipt' | 'bill-payment' | 'bill-discount' | 'bill-maturity'): BillStatus {
  if (entity === 'bill-receipt') return 'REPLACED'
  if (entity === 'bill-payment') return 'PAID'
  if (entity === 'bill-discount') return 'DISCOUNTED'
  return 'MATURED'
}

function entryFromRow(row: {
  id: string
  subject_id: string
  status: string
  revision: string | number | bigint
  submitted_by: string
  submitted_at: Date
  approved_by: string | null
  approved_at: Date | null
  rejected_by: string | null
  rejected_at: Date | null
  rejection_reason: string | null
}): ApprovalEntry {
  const status = row.status as ApprovalStatus
  return {
    id: row.id,
    domain: 'acc',
    entity: 'opening',
    subjectId: row.subject_id,
    versionNo: null,
    status,
    revision: String(row.revision),
    metadata: {
      submitted: { actorId: row.submitted_by, occurredAt: row.submitted_at.toISOString() },
      ...(status === 'APPROVED' && row.approved_by && row.approved_at
        ? { approved: { actorId: row.approved_by, occurredAt: row.approved_at.toISOString() } }
        : {}),
      ...(status === 'REJECTED' && row.rejected_by && row.rejected_at && row.rejection_reason
        ? { rejected: { actorId: row.rejected_by, occurredAt: row.rejected_at.toISOString(), reason: row.rejection_reason } }
        : {}),
    },
  }
}

export class AccService
  implements PlanExecutor<AccApplicationPlan>, AccControlBalancePort {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async syncVouEntityCatalog(): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      for (const entity of vouEntities) {
        const headerFields: string[] = []
        const lineFields: string[] = []
        const flatten = (prefix: string, fields: readonly import('@zerp/model').VouInputFieldDescriptor[]) => {
          for (const field of fields) {
            const path = prefix ? `${prefix}.${field.key}` : field.key
            if (field.kind === 'array') {
              if (field.key !== 'attachments') flatten('line', field.item ?? [])
            } else if (field.kind === 'object') flatten(path, field.fields ?? [])
            else (prefix === 'line' || prefix.startsWith('line.') ? lineFields : headerFields).push(path)
          }
        }
        flatten('', vouEntityInputDescriptors[entity])
        await tx.insertInto('dcl_acc_vou_entity_facts').values({
          id: entity,
          code: entity,
          name: vouEntityPresentation[entity].label,
          field_catalog: asJson({ headerFields: [...new Set(headerFields)], lineFields: [...new Set(lineFields)] }),
          enabled: true,
        }).onConflict((conflict) => conflict.column('id').doUpdateSet({
          code: entity,
          name: vouEntityPresentation[entity].label,
          field_catalog: asJson({ headerFields: [...new Set(headerFields)], lineFields: [...new Set(lineFields)] }),
          enabled: true,
        })).execute()
      }
    })
  }

  async publishMappingCatalog(bookId: string, actor: ApprovalActor): Promise<void> {
    requirePermission(actor, '/acc/book/save')
    await this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, bookId, actor, true)
      const book = await tx.selectFrom('acc_books').select(['id', 'code', 'name'])
        .where('id', '=', bookId).executeTakeFirstOrThrow()
      const subjects = await tx.selectFrom('acc_subjects')
        .select(['id', 'code', 'name', 'parent_id', 'enabled', 'required_dimensions'])
        .where('book_id', '=', bookId).execute()
      if (subjects.length === 0) throw new AccApplicationError('acc_mapping_catalog_subject_invalid')
      await tx.insertInto('dcl_acc_book_facts').values({
        id: book.id, code: book.code, name: book.name, enabled: true,
      }).onConflict((conflict) => conflict.column('id').doUpdateSet({
        code: book.code, name: book.name, enabled: true,
      })).execute()
      for (const subject of subjects) {
        const fact = {
          book_id: book.id,
          code: subject.code,
          name: subject.name,
          leaf: !subjects.some((candidate) => candidate.parent_id === subject.id),
          enabled: subject.enabled,
          required_dimensions: JSON.stringify(subject.required_dimensions) as unknown as JsonValue,
        }
        await tx.insertInto('dcl_acc_subject_facts').values({ id: subject.id, ...fact })
          .onConflict((conflict) => conflict.column('id').doUpdateSet(fact)).execute()
      }
    })
  }

  async apply(tx: Transaction<DB>, plan: AccApplicationPlan): Promise<void> {
    if (plan.action === 'NONE') return
    if (plan.action === 'unapprove') {
      const inventoryFacts = await this.inventoryFactsForSource(tx, plan.approvalEntryId)
      const fundFacts = await this.fundFactsForSource(tx, plan.approvalEntryId)
      await this.lockControlInventory(tx, inventoryFacts)
      await this.lockControlFunds(tx, fundFacts)
      await tx.deleteFrom('acc_inventory_entries').where('vou_approval_entry_id', '=', plan.approvalEntryId).execute()
      await this.assertControlInventoryNonNegative(tx, inventoryFacts)
      await this.reverseGlobalRegistrations(tx, plan)
      await tx.deleteFrom('acc_register_entries').where('vou_approval_entry_id', '=', plan.approvalEntryId).execute()
      await tx.deleteFrom('acc_journal_entries').where('vou_approval_entry_id', '=', plan.approvalEntryId).execute()
      await this.assertControlFundBalances(tx, fundFacts)
      return
    }
    const prior = await sql<{ id: string }>`
      SELECT id FROM acc_journal_entries WHERE vou_approval_entry_id = ${plan.approvalEntryId}
      UNION ALL
      SELECT id FROM acc_register_entries WHERE vou_approval_entry_id = ${plan.approvalEntryId}
      UNION ALL
      SELECT id FROM acc_container_entries WHERE vou_approval_entry_id = ${plan.approvalEntryId}
      LIMIT 1
    `.execute(tx)
    if (prior.rows.length > 0) return
    const books = await tx.selectFrom('acc_books as b')
      .innerJoin('approval_entries as opening', (join) => join.onRef('opening.subject_id', '=', 'b.id')
        .on('opening.domain', '=', 'acc').on('opening.entity', '=', 'opening').on('opening.status', '=', 'APPROVED'))
      .select(['b.id', 'b.start_month', 'b.control_book']).where('b.start_month', '<=', plan.payload.businessDate.slice(0, 7))
      .orderBy('b.code', 'asc').execute()
    await this.applyGlobalRegistrations(tx, plan, books)
    for (const book of books) {
      const mappingResult = await sql<{ default_result: string; mapping_definition: JsonValue }>`
        SELECT mapping.default_result, mapping.mapping_definition
        FROM dcl_acc_mapping_versions mapping
        JOIN approval_entries entry ON entry.id = mapping.approval_entry_id
        WHERE entry.domain = 'dcl' AND entry.entity = 'acc-mapping'
          AND entry.status = 'APPROVED' AND mapping.book_id = ${book.id}
          AND mapping.vou_entity_snapshot->>'code' = ${plan.entity}
        ORDER BY entry.version_no DESC LIMIT 1
      `.execute(tx)
      const mapping = mappingResult.rows[0]
      if (!mapping) throw new AccApplicationError('acc_mapping_not_found')
      const definition = mapping.mapping_definition as unknown as {
        defaultTemplateId: string | null
        rules: Array<{ conditions: Array<{ field: string; operator: string; values: string[] }>; result: 'POST' | 'UN_POST'; templateId: string | null }>
        templates: Array<{ templateId: string; collection: string | null; lines: Array<{ subjectSource: 'FIXED' | 'FIELD'; subjectValue: string; direction: 'DEBIT' | 'CREDIT'; amountField: string; currencyField: string; dimensions: Record<string, string>; quantityField: string | null }> }>
      }
      const matching = definition.rules.filter((rule) => rule.conditions.every((condition) => this.mappingCondition(plan.payload!, condition)))
      if (matching.length > 1) throw new AccApplicationError('acc_mapping_rule_conflict')
      const result = matching[0]?.result ?? mapping.default_result
      const templateId = matching[0]?.templateId ?? definition.defaultTemplateId
      if (result === 'UN_POST') continue
      const template = definition.templates.find((candidate) => candidate.templateId === templateId)
      if (!template) throw new AccApplicationError('acc_mapping_template_not_found')
      const sources = template.collection ? this.field(plan.payload, template.collection) : [plan.payload]
      if (!Array.isArray(sources)) throw new AccApplicationError('acc_mapping_collection_invalid')
      const rendered: Array<{ subjectId: string; direction: 'DEBIT' | 'CREDIT'; amount: string; currency: string; dimensions: Record<string, string>; quantity: string | null }> = []
      for (const sourceValue of sources) {
        const source = typeof sourceValue === 'object' && sourceValue !== null ? sourceValue as Record<string, unknown> : {}
        for (const line of template.lines) {
          const subjectId = line.subjectSource === 'FIXED' ? line.subjectValue : String(this.field({ ...plan.payload, line: source }, line.subjectValue) ?? '')
          const amount = String(this.field({ ...plan.payload, line: source }, line.amountField) ?? '')
          const currency = String(this.field({ ...plan.payload, line: source }, line.currencyField) ?? '')
          decimalUnits(amount)
          if (!/^[A-Z]{3}$/.test(currency)) throw new AccApplicationError('acc_mapping_currency_invalid')
          const dimensions = Object.fromEntries(Object.entries(line.dimensions).map(([dimension, field]) => [dimension, String(this.field({ ...plan.payload, line: source }, field) ?? '')]))
          if (Object.values(dimensions).some((value) => !value)) throw new AccApplicationError('acc_mapping_dimension_required')
          rendered.push({ subjectId, direction: line.direction, amount, currency, dimensions, quantity: line.quantityField ? String(this.field({ ...plan.payload, line: source }, line.quantityField) ?? '') : null })
        }
      }
      const currencies = new Set(rendered.map((line) => line.currency))
      if (currencies.size !== 1) throw new AccApplicationError('acc_mapping_multi_currency_unsupported')
      let debit = 0n, credit = 0n
      for (const line of rendered) line.direction === 'DEBIT' ? debit += decimalUnits(line.amount) : credit += decimalUnits(line.amount)
      if (debit !== credit) throw new AccApplicationError('acc_posting_unbalanced')
      const subjects = await tx.selectFrom('acc_subjects').selectAll().where('book_id', '=', book.id).execute()
      const byId = new Map(subjects.map((subject) => [subject.id, subject]))
      for (const line of rendered) {
        const subject = byId.get(line.subjectId)
        if (!subject?.enabled || subjects.some((candidate) => candidate.parent_id === line.subjectId)) throw new AccApplicationError('acc_posting_subject_invalid')
        const required = subject.required_dimensions as unknown as string[]
        if (required.some((dimension) => !line.dimensions[dimension])) throw new AccApplicationError('acc_mapping_dimension_required')
        if (subject.inventory_quantity) {
          if (!line.quantity) throw new AccApplicationError('acc_inventory_quantity_required')
          if (!line.dimensions.WAREHOUSE || !line.dimensions.PRODUCT)
            throw new AccApplicationError('acc_inventory_dimension_required')
        }
      }
      const inventoryFacts = rendered.flatMap((line) => {
        const subject = byId.get(line.subjectId)!
        return subject.inventory_quantity
          ? [{ bookId: book.id, subjectId: subject.id, warehouseId: line.dimensions.WAREHOUSE!, productId: line.dimensions.PRODUCT! }]
          : []
      })
      const fundFacts = rendered.flatMap((line) =>
        line.dimensions.FUND_ACCOUNT
          ? [{ bookId: book.id, fundAccountId: line.dimensions.FUND_ACCOUNT, currency: line.currency }]
          : [],
      )
      if (book.control_book) await this.lockControlInventory(tx, inventoryFacts)
      if (book.control_book) await this.lockControlFunds(tx, fundFacts)
      const journalId = ulid()
      await tx.insertInto('acc_journal_entries').values({
        id: journalId, book_id: book.id, vou_document_id: plan.documentId,
        vou_approval_entry_id: plan.approvalEntryId, business_date: new Date(`${plan.payload.businessDate}T00:00:00.000Z`),
        currency: [...currencies][0] ?? plan.payload.currency, created_at: new Date(plan.occurredAt),
      }).execute()
      for (const line of rendered) {
        const subject = byId.get(line.subjectId)!
        await tx.insertInto('acc_journal_lines').values({
          id: ulid(), journal_entry_id: journalId, subject_id: line.subjectId,
          direction: line.direction, amount: line.amount, dimensions: asJson(line.dimensions),
        }).execute()
        if (subject.inventory_quantity && line.quantity) {
          decimalUnits(line.quantity)
          await sql`
            INSERT INTO acc_inventory_entries (
              id, vou_approval_entry_id, document_id, opening_approval_entry_id, book_id, subject_id, journal_entry_id,
              line_id, warehouse_id, product_id, business_date, quantity, created_at
            ) VALUES (
              ${ulid()}, ${plan.approvalEntryId}, ${plan.documentId}, ${null}, ${book.id}, ${subject.id}, ${journalId},
              ${ulid()}, ${line.dimensions.WAREHOUSE}, ${line.dimensions.PRODUCT}, ${plan.payload.businessDate}::date,
              ${line.direction === 'DEBIT' ? line.quantity : `-${line.quantity}`}, ${new Date(plan.occurredAt)}
            )
          `.execute(tx)
        }
      }
      if (book.control_book) await this.assertControlInventoryNonNegative(tx, inventoryFacts)
      if (book.control_book) await this.assertControlFundBalances(tx, fundFacts)
    }
  }

  async partyBalance(
    tx: Transaction<DB>,
    input: {
      counterpartyDimension: 'CUSTOMER_SUBUNIT' | 'SUPPLIER'
      counterpartyObjectId: string
      currency: string
      settlementPurpose: AccSettlementPurpose
      asOfDate: string
    },
  ): Promise<bigint> {
    const expectedDimension = input.settlementPurpose === 'RECEIVABLE' || input.settlementPurpose === 'ADVANCE_RECEIPT'
      ? 'CUSTOMER_SUBUNIT'
      : 'SUPPLIER'
    if (
      input.counterpartyDimension !== expectedDimension ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate) ||
      !input.counterpartyObjectId
    ) throw new AccApplicationError('acc_control_balance_invalid')
    const controlBook = await sql<{ id: string }>`
      SELECT book.id
      FROM acc_books book
      JOIN approval_entries opening
        ON opening.subject_id = book.id AND opening.domain = 'acc'
        AND opening.entity = 'opening' AND opening.status = 'APPROVED'
      WHERE book.control_book
      FOR UPDATE OF book
    `.execute(tx)
    const bookId = controlBook.rows[0]?.id
    if (!bookId) throw new AccApplicationError('acc_control_book_unavailable')
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`acc:party:${bookId}:${input.counterpartyDimension}:${input.counterpartyObjectId}:${input.currency}`}, 0))`.execute(tx)
    const result = await sql<{ balance: string }>`
      SELECT COALESCE(SUM(
        CASE WHEN line.direction = 'DEBIT' THEN line.amount ELSE -line.amount END
        * CASE WHEN ${input.settlementPurpose} IN ('PAYABLE', 'ADVANCE_RECEIPT') THEN -1 ELSE 1 END
      ), 0)::text AS balance
      FROM acc_journal_entries journal
      JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
      JOIN acc_subjects subject ON subject.id = line.subject_id
      WHERE journal.book_id = ${bookId}
        AND journal.business_date <= ${input.asOfDate}::date
        AND journal.currency = ${input.currency}
        AND subject.settlement_purpose = ${input.settlementPurpose}
        AND line.dimensions->>${input.counterpartyDimension} = ${input.counterpartyObjectId}
    `.execute(tx)
    return signedDecimalUnits(result.rows[0]?.balance ?? '0')
  }

  async customerCreditOccupancy(
    tx: Transaction<DB>,
    input: { customerSubunitId: string; currency: string; asOfDate: string },
  ): Promise<bigint> {
    const balance = await this.partyBalance(tx, {
      counterpartyDimension: 'CUSTOMER_SUBUNIT',
      counterpartyObjectId: input.customerSubunitId,
      currency: input.currency,
      settlementPurpose: 'RECEIVABLE',
      asOfDate: input.asOfDate,
    })
    return balance > 0n ? balance : 0n
  }

  private async fundFactsForSource(
    tx: Transaction<DB>,
    approvalEntryId: string,
  ): Promise<FundFact[]> {
    const result = await sql<FundFact>`
      SELECT DISTINCT journal.book_id AS "bookId",
        line.dimensions->>'FUND_ACCOUNT' AS "fundAccountId", journal.currency
      FROM acc_journal_entries journal
      JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
      JOIN acc_books book ON book.id = journal.book_id
      WHERE journal.vou_approval_entry_id = ${approvalEntryId}
        AND book.control_book
        AND line.dimensions ? 'FUND_ACCOUNT'
    `.execute(tx)
    return result.rows.filter((fact) => Boolean(fact.fundAccountId))
  }

  private async lockControlFunds(
    tx: Transaction<DB>,
    facts: readonly FundFact[],
  ): Promise<void> {
    const distinct = [...new Map(facts.map((fact) => [
      `${fact.bookId}:${fact.fundAccountId}:${fact.currency}`,
      fact,
    ])).values()].sort((left, right) =>
      `${left.bookId}:${left.fundAccountId}:${left.currency}`.localeCompare(
        `${right.bookId}:${right.fundAccountId}:${right.currency}`,
      ))
    for (const fact of distinct)
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`acc:fund:${fact.bookId}:${fact.fundAccountId}:${fact.currency}`}, 0))`.execute(tx)
  }

  private async assertControlFundBalances(
    tx: Transaction<DB>,
    facts: readonly FundFact[],
  ): Promise<void> {
    const distinct = [...new Map(facts.map((fact) => [
      `${fact.bookId}:${fact.fundAccountId}:${fact.currency}`,
      fact,
    ])).values()]
    for (const fact of distinct) {
      const result = await sql<{ business_date: string; balance: string }>`
        WITH movements AS (
          SELECT journal.business_date,
            journal.created_at,
            journal.id AS journal_id,
            line.id AS line_id,
            CASE WHEN line.direction = 'DEBIT' THEN line.amount ELSE -line.amount END AS amount
          FROM acc_journal_entries journal
          JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
          WHERE journal.book_id = ${fact.bookId}
            AND journal.currency = ${fact.currency}
            AND line.dimensions->>'FUND_ACCOUNT' = ${fact.fundAccountId}
        ), balances AS (
          SELECT business_date,
            SUM(amount) OVER (ORDER BY business_date, created_at, journal_id, line_id
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
          FROM movements
        )
        SELECT business_date::text, balance::text
        FROM balances
        WHERE balance < 0
        ORDER BY business_date, balance
        LIMIT 1
      `.execute(tx)
      const minimum = result.rows[0]
      if (minimum)
        throw new AccApplicationError('funds_insufficient', [{
          kind: 'FUND',
          bookId: fact.bookId,
          fundAccountId: fact.fundAccountId,
          currency: fact.currency,
          businessDate: minimum.business_date,
          balance: minimum.balance,
        }])
    }
  }

  private async applyGlobalRegistrations(
    tx: Transaction<DB>,
    plan: Exclude<AccApplicationPlan, { action: 'NONE' }>,
    books: Array<{ id: string }>,
  ): Promise<void> {
    if (plan.entity === 'sale-signoff') {
      const payload = plan.payload as VouPayloadFor<'sale-signoff'>
      const customer = await sql<{ customer_id: string }>`
        SELECT root.customer_id
        FROM dcl_customer_subunit_roots root
        JOIN dcl_customer_version_subunits subunit
          ON subunit.subunit_id = root.subunit_id
          AND subunit.customer_approval_entry_id = ${payload.customerSubunit.approvalEntryId}
        WHERE root.subunit_id = ${payload.customerSubunit.objectId}
        FOR UPDATE OF root
      `.execute(tx)
      const customerId = customer.rows[0]?.customer_id
      if (!customerId)
        throw new AccApplicationError('acc_container_customer_subunit_invalid')
      const deltas = [
        ['SOLVENT', payload.expectedSolventContainers - payload.returnedSolventContainers],
        ['RESIN', payload.expectedResinContainers - payload.returnedResinContainers],
      ] as const
      for (const [containerType, quantityDelta] of deltas) {
        if (quantityDelta === 0) continue
        await sql`
          INSERT INTO acc_container_entries (
            id, customer_subunit_id, customer_id, customer_approval_entry_id,
            container_type, quantity_delta, business_date, vou_approval_entry_id,
            source_document_id, source_revision, created_at
          ) VALUES (
            ${ulid()}, ${payload.customerSubunit.objectId}, ${customerId},
            ${payload.customerSubunit.approvalEntryId}, ${containerType},
            ${quantityDelta}, ${plan.payload.businessDate}::date,
            ${plan.approvalEntryId}, ${plan.documentId}, ${plan.approvalRevision},
            ${new Date(plan.occurredAt)}
          )
        `.execute(tx)
      }
      return
    }
    if (plan.entity === 'asset-acquisition') {
      const payload = plan.payload as VouPayloadFor<'asset-acquisition'>
      for (const [index, line] of payload.assetAcquisitionLines.entries()) {
        const assetId = ulid()
        const assetNo = `${plan.documentNo}-${String(index + 1).padStart(3, '0')}`
        const registerPayload = { assetId, assetNo, name: line.assetName, status: 'ACTIVE' as const, acquisition: line }
        await sql`
          INSERT INTO acc_asset_registers (
            id, asset_no, name, status, acquisition_vou_approval_entry_id,
            state_vou_approval_entry_id, payload, created_at
          ) VALUES (
            ${assetId}, ${assetNo}, ${line.assetName}, 'ACTIVE', ${plan.approvalEntryId},
            ${plan.approvalEntryId}, ${JSON.stringify(registerPayload)}::jsonb, ${new Date(plan.occurredAt)}
          )
        `.execute(tx)
        for (const book of books) {
          await sql`
            INSERT INTO acc_asset_book_values (
              asset_id, book_id, acquisition_vou_approval_entry_id, original_value, created_at
            ) VALUES (
              ${assetId}, ${book.id}, ${plan.approvalEntryId}, ${line.originalValue}, ${new Date(plan.occurredAt)}
            )
          `.execute(tx)
        }
        await this.insertRegisterEntry(tx, 'ASSET', assetId, plan.approvalEntryId, registerPayload, null, plan.occurredAt)
      }
      return
    }
    if (plan.entity === 'asset-sale' || plan.entity === 'asset-liquidation') {
      if (plan.entity === 'asset-sale') {
        const payload = plan.payload as VouPayloadFor<'asset-sale'>
        for (const line of payload.assetSaleLines) await this.changeAssetStatus(tx, line.assetId, 'SOLD', plan)
      } else {
        const payload = plan.payload as VouPayloadFor<'asset-liquidation'>
        for (const line of payload.assetLiquidationLines) await this.changeAssetStatus(tx, line.assetId, 'RETIRED', plan)
      }
      return
    }
    if (plan.entity === 'bill-receipt' || plan.entity === 'bill-payment' || plan.entity === 'bill-issue' || plan.entity === 'bill-discount' || plan.entity === 'bill-maturity') {
      const payload = plan.payload as VouPayloadFor<'bill-receipt'> | VouPayloadFor<'bill-payment'> | VouPayloadFor<'bill-issue'> | VouPayloadFor<'bill-discount'> | VouPayloadFor<'bill-maturity'>
      for (const line of payload.billLines) {
        if ('billId' in line) {
          if (plan.entity === 'bill-issue') throw new AccApplicationError('acc_bill_line_invalid')
          await this.changeBillStatus(tx, line.billId, billOutgoingStatus(plan.entity), plan)
          continue
        }
        if (plan.entity === 'bill-payment' || plan.entity === 'bill-discount' || plan.entity === 'bill-maturity')
          throw new AccApplicationError('acc_bill_line_invalid')
        const billId = ulid()
        const registerPayload = { billId, billNo: line.billNo, positionType: line.positionType, status: 'AVAILABLE' as const, bill: line }
        await sql`
          INSERT INTO acc_bill_registers (
            id, bill_no, position_type, status, created_vou_approval_entry_id,
            state_vou_approval_entry_id, payload, created_at
          ) VALUES (
            ${billId}, ${line.billNo}, ${line.positionType}, 'AVAILABLE', ${plan.approvalEntryId},
            ${plan.approvalEntryId}, ${JSON.stringify(registerPayload)}::jsonb, ${new Date(plan.occurredAt)}
          )
        `.execute(tx)
        await this.insertRegisterEntry(tx, 'BILL', billId, plan.approvalEntryId, registerPayload, null, plan.occurredAt)
      }
    }
  }

  private async changeAssetStatus(
    tx: Transaction<DB>,
    assetId: string,
    status: AssetStatus,
    plan: Exclude<AccApplicationPlan, { action: 'NONE' }>,
  ): Promise<void> {
    const asset = await sql<{ id: string; acquisition_vou_approval_entry_id: string; status: AssetStatus }>`
      SELECT id, acquisition_vou_approval_entry_id, status
      FROM acc_asset_registers WHERE id = ${assetId} FOR UPDATE
    `.execute(tx)
    const current = asset.rows[0]
    if (!current || current.status !== 'ACTIVE') throw new AccApplicationError('acc_asset_not_active')
    await sql`
      UPDATE acc_asset_registers
      SET status = ${status}, state_vou_approval_entry_id = ${plan.approvalEntryId}
      WHERE id = ${assetId}
    `.execute(tx)
    await sql`
      UPDATE acc_register_entries SET reversed_at = ${new Date(plan.occurredAt)}
      WHERE register_kind = 'ASSET' AND object_id = ${assetId}
        AND vou_approval_entry_id = ${current.acquisition_vou_approval_entry_id}
    `.execute(tx)
    await this.insertRegisterEntry(tx, 'ASSET', assetId, plan.approvalEntryId, { assetId, status }, new Date(plan.occurredAt), plan.occurredAt)
  }

  private async changeBillStatus(
    tx: Transaction<DB>,
    billId: string,
    status: BillStatus,
    plan: Exclude<AccApplicationPlan, { action: 'NONE' }>,
  ): Promise<void> {
    const bill = await sql<{ id: string; created_vou_approval_entry_id: string; status: BillStatus }>`
      SELECT id, created_vou_approval_entry_id, status
      FROM acc_bill_registers WHERE id = ${billId} FOR UPDATE
    `.execute(tx)
    const current = bill.rows[0]
    if (!current || current.status !== 'AVAILABLE') throw new AccApplicationError('acc_bill_not_available')
    await sql`
      UPDATE acc_bill_registers
      SET status = ${status}, state_vou_approval_entry_id = ${plan.approvalEntryId}
      WHERE id = ${billId}
    `.execute(tx)
    await sql`
      UPDATE acc_register_entries SET reversed_at = ${new Date(plan.occurredAt)}
      WHERE register_kind = 'BILL' AND object_id = ${billId}
        AND vou_approval_entry_id = ${current.created_vou_approval_entry_id}
    `.execute(tx)
    await this.insertRegisterEntry(tx, 'BILL', billId, plan.approvalEntryId, { billId, status }, new Date(plan.occurredAt), plan.occurredAt)
  }

  private async insertRegisterEntry(
    tx: Transaction<DB>,
    kind: 'ASSET' | 'BILL',
    objectId: string,
    approvalEntryId: string,
    payload: object,
    reversedAt: Date | null,
    occurredAt: string,
  ): Promise<void> {
    await sql`
      INSERT INTO acc_register_entries (
        id, register_kind, object_id, source_kind, vou_approval_entry_id,
        opening_approval_entry_id, payload, reversed_at, created_at
      ) VALUES (
        ${ulid()}, ${kind}, ${objectId}, 'VOU', ${approvalEntryId},
        NULL, ${JSON.stringify(payload)}::jsonb, ${reversedAt}, ${new Date(occurredAt)}
      )
    `.execute(tx)
  }

  private async reverseGlobalRegistrations(
    tx: Transaction<DB>,
    plan: Exclude<AccApplicationPlan, { action: 'NONE' }>,
  ): Promise<void> {
    const assetBlocks = await sql<{ id: string }>`
      SELECT id FROM acc_asset_registers
      WHERE acquisition_vou_approval_entry_id = ${plan.approvalEntryId}
        AND state_vou_approval_entry_id <> ${plan.approvalEntryId}
    `.execute(tx)
    const billBlocks = await sql<{ id: string }>`
      SELECT id FROM acc_bill_registers
      WHERE created_vou_approval_entry_id = ${plan.approvalEntryId}
        AND state_vou_approval_entry_id <> ${plan.approvalEntryId}
    `.execute(tx)
    const blockers = [
      ...assetBlocks.rows.map((row) => ({ kind: 'ASSET', objectId: row.id })),
      ...billBlocks.rows.map((row) => ({ kind: 'BILL', objectId: row.id })),
    ]
    if (blockers.length > 0) throw new AccApplicationError('acc_register_unapprove_blocked', blockers)

    // Empty-container registrations have no downstream writer in the target
    // topology. Reversal therefore deletes only this exact source revision;
    // it does not infer dependencies from later independent signoff facts.
    await sql`
      DELETE FROM acc_container_entries
      WHERE vou_approval_entry_id = ${plan.approvalEntryId}
        AND source_document_id = ${plan.documentId}
        AND source_revision = ${plan.approvalRevision}
    `.execute(tx)

    await sql`
      UPDATE acc_register_entries SET reversed_at = NULL
      WHERE (register_kind = 'ASSET' AND vou_approval_entry_id IN (
        SELECT acquisition_vou_approval_entry_id FROM acc_asset_registers
        WHERE state_vou_approval_entry_id = ${plan.approvalEntryId}
          AND acquisition_vou_approval_entry_id <> ${plan.approvalEntryId}
      ) AND object_id IN (
        SELECT id FROM acc_asset_registers
        WHERE state_vou_approval_entry_id = ${plan.approvalEntryId}
          AND acquisition_vou_approval_entry_id <> ${plan.approvalEntryId}
      )) OR (register_kind = 'BILL' AND vou_approval_entry_id IN (
        SELECT created_vou_approval_entry_id FROM acc_bill_registers
        WHERE state_vou_approval_entry_id = ${plan.approvalEntryId}
          AND created_vou_approval_entry_id <> ${plan.approvalEntryId}
      ) AND object_id IN (
        SELECT id FROM acc_bill_registers
        WHERE state_vou_approval_entry_id = ${plan.approvalEntryId}
          AND created_vou_approval_entry_id <> ${plan.approvalEntryId}
      ))
    `.execute(tx)
    await sql`
      UPDATE acc_asset_registers
      SET status = 'ACTIVE', state_vou_approval_entry_id = acquisition_vou_approval_entry_id
      WHERE state_vou_approval_entry_id = ${plan.approvalEntryId}
        AND acquisition_vou_approval_entry_id <> ${plan.approvalEntryId}
    `.execute(tx)
    await sql`
      UPDATE acc_bill_registers
      SET status = 'AVAILABLE', state_vou_approval_entry_id = created_vou_approval_entry_id
      WHERE state_vou_approval_entry_id = ${plan.approvalEntryId}
        AND created_vou_approval_entry_id <> ${plan.approvalEntryId}
    `.execute(tx)
    await sql`DELETE FROM acc_asset_book_values WHERE acquisition_vou_approval_entry_id = ${plan.approvalEntryId}`.execute(tx)
    await sql`DELETE FROM acc_asset_registers WHERE acquisition_vou_approval_entry_id = ${plan.approvalEntryId}`.execute(tx)
    await sql`DELETE FROM acc_bill_registers WHERE created_vou_approval_entry_id = ${plan.approvalEntryId}`.execute(tx)
  }

  private async inventoryFactsForSource(tx: Transaction<DB>, approvalEntryId: string): Promise<InventoryFact[]> {
    const result = await sql<{
      book_id: string; subject_id: string; warehouse_id: string; product_id: string
    }>`
      SELECT inventory.book_id, inventory.subject_id, inventory.warehouse_id, inventory.product_id
      FROM acc_inventory_entries inventory
      JOIN acc_books book ON book.id = inventory.book_id AND book.control_book
      WHERE inventory.vou_approval_entry_id = ${approvalEntryId}
    `.execute(tx)
    return result.rows.map((row) => ({ bookId: row.book_id, subjectId: row.subject_id, warehouseId: row.warehouse_id, productId: row.product_id }))
  }

  private async lockControlInventory(tx: Transaction<DB>, facts: InventoryFact[]): Promise<void> {
    const unique = [...new Map(facts.map((fact) => [`${fact.bookId}:${fact.subjectId}:${fact.warehouseId}:${fact.productId}`, fact])).values()]
      .sort((left, right) => `${left.bookId}:${left.subjectId}:${left.warehouseId}:${left.productId}`.localeCompare(`${right.bookId}:${right.subjectId}:${right.warehouseId}:${right.productId}`))
    for (const fact of unique)
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`acc:inventory:${fact.bookId}:${fact.subjectId}:${fact.warehouseId}:${fact.productId}`}, 0))`.execute(tx)
  }

  private async assertControlInventoryNonNegative(tx: Transaction<DB>, facts: InventoryFact[]): Promise<void> {
    const unique = [...new Map(facts.map((fact) => [`${fact.bookId}:${fact.warehouseId}:${fact.productId}`, fact])).values()]
    for (const fact of unique) {
      const negative = await sql<{ business_date: string; quantity: string }>`
        SELECT business_date::text, quantity::text FROM (
          SELECT business_date, SUM(quantity) OVER (
            ORDER BY business_date ASC, created_at ASC, id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS quantity
          FROM acc_inventory_entries
          WHERE book_id = ${fact.bookId} AND warehouse_id = ${fact.warehouseId} AND product_id = ${fact.productId}
        ) balances
        WHERE quantity < 0
        ORDER BY business_date ASC
        LIMIT 1
      `.execute(tx)
      if (negative.rows[0]) {
        const row = negative.rows[0]
        throw new AccApplicationError('acc_negative_inventory', [{
          kind: 'INVENTORY', bookId: fact.bookId, warehouseId: fact.warehouseId,
          productId: fact.productId, businessDate: row.business_date, quantity: row.quantity,
        }])
      }
    }
  }

  private field(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, key) => typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[key] : undefined, value)
  }

  private mappingCondition(payload: VouPayload, condition: { field: string; operator: string; values: string[] }): boolean {
    const value = this.field(payload, condition.field)
    const text = value === null || value === undefined ? '' : String(value)
    if (condition.operator === 'IS_EMPTY') return text === ''
    if (condition.operator === 'IS_NOT_EMPTY') return text !== ''
    if (condition.operator === 'EQ') return text === condition.values[0]
    if (condition.operator === 'NE') return text !== condition.values[0]
    if (condition.operator === 'IN') return condition.values.includes(text)
    if (condition.operator === 'NOT_IN') return !condition.values.includes(text)
    return false
  }

  async createBook(input: AccBookInput, actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/create')
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('acc:book-code', 0))`.execute(tx)
      const latest = await tx.selectFrom('acc_books').select('code').orderBy('code', 'desc').executeTakeFirst()
      const sequence = latest ? Number(latest.code.slice(4)) + 1 : 1
      if (!Number.isSafeInteger(sequence) || sequence > 9999)
        throw new AccApplicationError('acc_book_code_exhausted')
      const code = `ACC-${String(sequence).padStart(4, '0')}`
      const controlBook = latest === undefined
      const now = new Date()
      await tx.insertInto('acc_books').values({
        id: input.id,
        code,
        name: input.name.trim(),
        description: input.description.trim(),
        start_month: input.startMonth,
        base_currency: input.baseCurrency,
        control_book: controlBook,
        created_at: now,
        created_by: actor.id,
        updated_at: now,
        updated_by: actor.id,
      }).execute()
      await tx.insertInto('acc_book_access').values({
        book_id: input.id,
        user_id: actor.id,
        can_query: true,
        can_operate: true,
      }).execute()
      return { ...input, code, controlBook, revision: '1' }
    })
  }

  async grantBookAccess(bookId: string, userId: string, actor: ApprovalActor): Promise<void> {
    requirePermission(actor, '/acc/book/save')
    await this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, bookId, actor, true)
      const user = await tx.selectFrom('app_users').select('id').where('id', '=', userId).executeTakeFirst()
      if (!user) throw new AccApplicationError('acc_book_access_user_not_found')
      await sql`
        INSERT INTO acc_book_access (book_id, user_id, can_query, can_operate)
        VALUES (${bookId}, ${userId}, true, true)
        ON CONFLICT (book_id, user_id)
        DO UPDATE SET can_query = true, can_operate = true
      `.execute(tx)
    })
  }

  async queryBooks(actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/query')
    let query = this.db.selectFrom('acc_books as b').selectAll('b').orderBy('b.code', 'asc')
    if (actor.trusted !== true)
      query = query.innerJoin('acc_book_access as a', 'a.book_id', 'b.id')
        .where('a.user_id', '=', actor.id).where('a.can_query', '=', true)
    return (await query.execute()).map((row) => this.bookView(row))
  }

  async getBook(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/get')
    await this.requireBookAccess(this.db, bookId, actor, false)
    const row = await this.db.selectFrom('acc_books').selectAll().where('id', '=', bookId).executeTakeFirst()
    if (!row) throw new AccApplicationError('acc_book_not_found')
    return this.bookView(row)
  }

  async saveBook(input: { id: string; expectedRevision: string; name: string; description: string; baseCurrency: string }, actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/save')
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, input.id, actor, true)
      const row = await tx.selectFrom('acc_books').selectAll().where('id', '=', input.id).forUpdate().executeTakeFirstOrThrow()
      if (String(row.revision) !== input.expectedRevision) throw new AccApplicationError('approval_stale_revision')
      const revision = BigInt(row.revision) + 1n
      await tx.updateTable('acc_books').set({
        name: input.name.trim(), description: input.description.trim(), base_currency: input.baseCurrency,
        revision, updated_at: new Date(), updated_by: actor.id,
      }).where('id', '=', input.id).where('revision', '=', row.revision).executeTakeFirstOrThrow()
      return this.bookView({ ...row, name: input.name.trim(), description: input.description.trim(), base_currency: input.baseCurrency, revision })
    })
  }

  async deleteBook(bookId: string, expectedRevision: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/book/delete')
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, bookId, actor, true)
      const row = await tx.selectFrom('acc_books').select(['control_book', 'revision']).where('id', '=', bookId).forUpdate().executeTakeFirstOrThrow()
      if (String(row.revision) !== expectedRevision) throw new AccApplicationError('approval_stale_revision')
      if (row.control_book) throw new AccApplicationError('acc_control_book_delete_forbidden')
      const subject = await tx.selectFrom('acc_subjects').select('id').where('book_id', '=', bookId).executeTakeFirst()
      const opening = await tx.selectFrom('acc_opening_snapshots').select('approval_entry_id').where('book_id', '=', bookId).executeTakeFirst()
      const journal = await tx.selectFrom('acc_journal_entries').select('id').where('book_id', '=', bookId).executeTakeFirst()
      const blockers = [subject && { kind: 'SUBJECT', id: subject.id }, opening && { kind: 'OPENING', id: opening.approval_entry_id }, journal && { kind: 'JOURNAL', id: journal.id }].filter(Boolean)
      if (blockers.length > 0) throw new AccApplicationError('acc_book_delete_blocked', blockers)
      await tx.deleteFrom('acc_books').where('id', '=', bookId).executeTakeFirstOrThrow()
      return { id: bookId, deleted: true as const }
    })
  }

  async createSubject(input: AccSubjectInput, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/create')
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, input.bookId, actor, true)
      if (input.parentId) {
        const parent = await tx.selectFrom('acc_subjects').select('book_id')
          .where('id', '=', input.parentId).executeTakeFirst()
        if (!parent || parent.book_id !== input.bookId)
          throw new AccApplicationError('acc_subject_parent_invalid')
      }
      const now = new Date()
      await tx.insertInto('acc_subjects').values({
        id: input.id,
        book_id: input.bookId,
        code: input.code,
        name: input.name.trim(),
        parent_id: input.parentId,
        balance_direction: input.balanceDirection,
        enabled: input.enabled,
        required_dimensions: JSON.stringify(input.requiredDimensions) as unknown as JsonValue,
        inventory_quantity: input.inventoryQuantity,
        settlement_purpose: input.settlementPurpose,
        created_at: now,
        created_by: actor.id,
        updated_at: now,
        updated_by: actor.id,
      }).execute()
      return { ...input, name: input.name.trim(), revision: '1' }
    })
  }

  async querySubjects(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/query')
    await this.requireBookAccess(this.db, bookId, actor, false)
    const rows = await this.db.selectFrom('acc_subjects').selectAll().where('book_id', '=', bookId).orderBy('code', 'asc').execute()
    return rows.map((row) => this.subjectView(row))
  }

  async getSubject(id: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/get')
    const row = await this.db.selectFrom('acc_subjects').selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) throw new AccApplicationError('acc_subject_not_found')
    await this.requireBookAccess(this.db, row.book_id, actor, false)
    return this.subjectView(row)
  }

  async saveSubject(input: AccSubjectInput & { expectedRevision: string }, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/save')
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, input.bookId, actor, true)
      const row = await tx.selectFrom('acc_subjects').selectAll().where('id', '=', input.id).forUpdate().executeTakeFirst()
      if (!row || row.book_id !== input.bookId) throw new AccApplicationError('acc_subject_not_found')
      if (String(row.revision) !== input.expectedRevision) throw new AccApplicationError('approval_stale_revision')
      const referenced = await tx.selectFrom('acc_journal_lines').select('id').where('subject_id', '=', input.id).executeTakeFirst()
      if (referenced && (row.code !== input.code || row.name !== input.name.trim() || row.parent_id !== input.parentId || row.balance_direction !== input.balanceDirection || JSON.stringify(row.required_dimensions) !== JSON.stringify(input.requiredDimensions) || row.inventory_quantity !== input.inventoryQuantity || row.settlement_purpose !== input.settlementPurpose))
        throw new AccApplicationError('acc_subject_frozen')
      const revision = BigInt(row.revision) + 1n
      await tx.updateTable('acc_subjects').set({
        code: input.code, name: input.name.trim(), parent_id: input.parentId,
        balance_direction: input.balanceDirection, enabled: input.enabled,
        required_dimensions: JSON.stringify(input.requiredDimensions) as unknown as JsonValue,
        inventory_quantity: input.inventoryQuantity, settlement_purpose: input.settlementPurpose,
        revision, updated_at: new Date(), updated_by: actor.id,
      }).where('id', '=', input.id).where('revision', '=', row.revision).executeTakeFirstOrThrow()
      return { ...input, name: input.name.trim(), revision: String(revision) }
    })
  }

  async deleteSubject(id: string, expectedRevision: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/subject/delete')
    return this.db.transaction().execute(async (tx) => {
      const row = await tx.selectFrom('acc_subjects').selectAll().where('id', '=', id).forUpdate().executeTakeFirst()
      if (!row) throw new AccApplicationError('acc_subject_not_found')
      await this.requireBookAccess(tx, row.book_id, actor, true)
      if (String(row.revision) !== expectedRevision) throw new AccApplicationError('approval_stale_revision')
      const child = await tx.selectFrom('acc_subjects').select('id').where('parent_id', '=', id).executeTakeFirst()
      const line = await tx.selectFrom('acc_journal_lines').select('id').where('subject_id', '=', id).executeTakeFirst()
      if (child || line) throw new AccApplicationError('acc_subject_delete_blocked', [child && { kind: 'CHILD_SUBJECT', id: child.id }, line && { kind: 'JOURNAL_LINE', id: line.id }].filter(Boolean))
      await tx.deleteFrom('acc_subjects').where('id', '=', id).executeTakeFirstOrThrow()
      return { id, deleted: true as const }
    })
  }

  async submitOpening(input: AccOpeningInput, actor: ApprovalActor, requestId: string) {
    requirePermission(actor, '/acc/opening/submit-new')
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`acc:opening:${input.bookId}`}, 0))`.execute(tx)
      await this.requireBookAccess(tx, input.bookId, actor, true)
      const prior = await tx.selectFrom('approval_entries').select('id')
        .where('domain', '=', 'acc').where('entity', '=', 'opening')
        .where('subject_id', '=', input.bookId).executeTakeFirst()
      if (prior) {
        if (prior.id === input.submissionId) return this.readOpening(tx, input.bookId, actor)
        throw new AccApplicationError('approval_open_version_exists')
      }
      const opening = this.normalizeOpening(input)
      await this.validateOpening(tx, opening)
      const now = new Date()
      await tx.insertInto('approval_entries').values({
        id: opening.submissionId,
        domain: 'acc',
        entity: 'opening',
        subject_id: opening.bookId,
        version_no: null,
        status: 'PENDING',
        revision: 1,
        submitted_by: actor.id,
        submitted_at: now,
        updated_by: actor.id,
        updated_at: now,
      }).execute()
      await tx.insertInto('acc_opening_snapshots').values({
        approval_entry_id: opening.submissionId,
        book_id: opening.bookId,
        payload: asJson(opening),
      }).execute()
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: opening.submissionId, domain: 'acc', entity: 'opening',
        subject_id: opening.bookId, version_no: null, action: 'SUBMITTED',
        from_status: null, to_status: 'PENDING', from_revision: null, to_revision: 1,
        actor_id: actor.id, reason: null, request_id: requestId, created_at: now,
      }).execute()
      return this.readOpening(tx, opening.bookId, actor)
    })
  }

  async reviewOpening(
    action: ApprovalAction,
    input: AccOpeningReviewInput,
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, `/acc/opening/${action}`)
    return this.db.transaction().execute(async (tx) => {
      const row = await tx.selectFrom('approval_entries').selectAll()
        .where('id', '=', input.submissionId).where('domain', '=', 'acc')
        .where('entity', '=', 'opening').where('subject_id', '=', input.bookId)
        .forUpdate().executeTakeFirst()
      if (!row) throw new AccApplicationError('approval_not_found')
      await this.requireBookAccess(tx, input.bookId, actor, true)
      const occurredAt = new Date()
      const decision = decideApproval({
        action,
        entry: entryFromRow(row),
        actor,
        expectedRevision: input.expectedRevision,
        occurredAt: occurredAt.toISOString(),
        requestId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })
      if (!decision.ok) throw new AccApplicationError(decision.error.errorKey)
      const plan = decision.plan
      if (action === 'approve') {
        const snapshot = await tx.selectFrom('acc_opening_snapshots').select('payload')
          .where('approval_entry_id', '=', row.id).executeTakeFirstOrThrow()
        await this.validateOpening(tx, snapshot.payload as unknown as AccOpeningInput)
        await this.persistOpeningFacts(tx, row.id, snapshot.payload as unknown as AccOpeningInput, occurredAt)
      }
      if (action === 'unapprove') {
        const laterJournal = await sql<{ id: string }>`
          SELECT id
          FROM acc_journal_entries
          WHERE book_id = ${input.bookId}
            AND NOT (source_kind = 'OPENING' AND opening_approval_entry_id = ${row.id})
          LIMIT 1
        `.execute(tx)
        const lockedPeriod = await tx.selectFrom('acc_periods').select('period_month')
          .where('book_id', '=', input.bookId).where('locked', '=', true).executeTakeFirst()
        if (laterJournal.rows[0] || lockedPeriod)
          throw new AccApplicationError('acc_opening_unapprove_blocked', [
            ...(laterJournal.rows[0] ? [{ kind: 'JOURNAL', id: laterJournal.rows[0].id }] : []),
            ...(lockedPeriod ? [{ kind: 'PERIOD', id: lockedPeriod.period_month }] : []),
          ])
        await this.deleteOpeningFacts(tx, row.id)
      }
      await tx.updateTable('approval_entries').set({
        status: plan.toStatus,
        revision: BigInt(plan.toRevision),
        updated_by: actor.id,
        updated_at: occurredAt,
        approved_by: plan.metadata.approved?.actorId ?? null,
        approved_at: plan.metadata.approved ? new Date(plan.metadata.approved.occurredAt) : null,
        rejected_by: plan.metadata.rejected?.actorId ?? null,
        rejected_at: plan.metadata.rejected ? new Date(plan.metadata.rejected.occurredAt) : null,
        rejection_reason: plan.metadata.rejected?.reason ?? null,
      }).where('id', '=', row.id).where('revision', '=', plan.fromRevision).executeTakeFirstOrThrow()
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: row.id, domain: 'acc', entity: 'opening',
        subject_id: input.bookId, version_no: null, action: plan.event.action,
        from_status: plan.fromStatus, to_status: plan.toStatus,
        from_revision: BigInt(plan.fromRevision), to_revision: BigInt(plan.toRevision),
        actor_id: actor.id, reason: plan.reason ?? null, request_id: requestId,
        created_at: occurredAt,
      }).execute()
      return this.readOpening(tx, input.bookId, actor)
    })
  }

  async setPeriod(
    input: { bookId: string; month: string; expectedRevision: string | null },
    locked: boolean,
    actor: ApprovalActor,
  ) {
    requirePermission(actor, `/acc/period/${locked ? 'lock' : 'unlock'}`)
    return this.db.transaction().execute(async (tx) => {
      await this.requireBookAccess(tx, input.bookId, actor, true)
      await lockAccountingPeriod(tx, input.month)
      const book = await tx.selectFrom('acc_books').select('start_month')
        .where('id', '=', input.bookId).executeTakeFirstOrThrow()
      if (input.month < book.start_month)
        throw new AccApplicationError('acc_period_before_book_start')
      const row = await tx.selectFrom('acc_periods').selectAll()
        .where('book_id', '=', input.bookId).where('period_month', '=', input.month)
        .forUpdate().executeTakeFirst()
      if (locked) await this.validatePeriodLock(tx, input.bookId, input.month, book.start_month)
      else await this.validatePeriodUnlock(tx, input.bookId, input.month, row?.locked ?? false)
      if (!row) {
        if (input.expectedRevision !== null) throw new AccApplicationError('approval_stale_revision')
        if (locked) {
          await this.persistPeriodBalances(tx, input.bookId, input.month)
          await this.validatePeriodTrialBalance(tx, input.bookId, input.month)
        }
        const now = new Date()
        await tx.insertInto('acc_periods').values({
          book_id: input.bookId,
          period_month: input.month,
          locked,
          updated_at: now,
          updated_by: actor.id,
        }).execute()
        return { bookId: input.bookId, month: input.month, locked, revision: '1' }
      }
      if (input.expectedRevision !== String(row.revision))
        throw new AccApplicationError('approval_stale_revision')
      if (locked) {
        await this.persistPeriodBalances(tx, input.bookId, input.month)
        await this.validatePeriodTrialBalance(tx, input.bookId, input.month)
      } else await this.deletePeriodBalances(tx, input.bookId, input.month)
      const revision = BigInt(row.revision) + 1n
      await tx.updateTable('acc_periods').set({
        locked,
        revision,
        updated_at: new Date(),
        updated_by: actor.id,
      }).where('book_id', '=', input.bookId).where('period_month', '=', input.month)
        .where('revision', '=', row.revision).executeTakeFirstOrThrow()
      return { bookId: input.bookId, month: input.month, locked, revision: String(revision) }
    })
  }

  async queryPeriods(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/period/query')
    await this.requireBookAccess(this.db, bookId, actor, false)
    const rows = await this.db.selectFrom('acc_periods').selectAll().where('book_id', '=', bookId).orderBy('period_month', 'asc').execute()
    return rows.map((row) => ({ bookId, month: row.period_month, locked: row.locked, revision: String(row.revision) }))
  }

  private async validatePeriodLock(
    tx: Transaction<DB>,
    bookId: string,
    month: string,
    startMonth: string,
  ): Promise<void> {
    if (month >= new Date().toISOString().slice(0, 7))
      throw new AccApplicationError('acc_period_not_ended')
    const latestLocked = await tx.selectFrom('acc_periods').select('period_month')
      .where('book_id', '=', bookId).where('locked', '=', true)
      .orderBy('period_month', 'desc').executeTakeFirst()
    if (latestLocked?.period_month === month)
      throw new AccApplicationError('acc_period_already_locked')
    if (month !== startMonth && latestLocked?.period_month !== previousMonth(month))
      throw new AccApplicationError('acc_period_not_continuous')
    if (month === startMonth && latestLocked)
      throw new AccApplicationError('acc_period_not_continuous')

    const opening = await tx.selectFrom('approval_entries').select('id')
      .where('domain', '=', 'acc').where('entity', '=', 'opening')
      .where('subject_id', '=', bookId).where('status', '=', 'APPROVED').executeTakeFirst()
    if (!opening) throw new AccApplicationError('acc_period_opening_not_approved')

    const vouEntries = await tx.selectFrom('approval_entries')
      .select(['id', 'entity', 'status']).where('domain', '=', 'vou').execute()
    const monthEntries: typeof vouEntries = []
    const approvedThroughMonthEntryIds: string[] = []
    for (const entry of vouEntries) {
      const persisted = await readVouPersistence(tx, { approvalEntryId: entry.id })
      const entryMonth = persisted.businessDate.slice(0, 7)
      if (entryMonth === month) monthEntries.push(entry)
      if (entry.status === 'APPROVED' && entryMonth <= month) approvedThroughMonthEntryIds.push(entry.id)
    }
    const openDocument = monthEntries.find((entry) => entry.status !== 'APPROVED')
    if (openDocument)
      throw new AccApplicationError('acc_period_open_vou', [{ kind: 'VOU', id: openDocument.id, entity: openDocument.entity }])

    const mappedEntities = await sql<{ entity: string }>`
      SELECT DISTINCT mapping.vou_entity_snapshot->>'code' AS entity
      FROM dcl_acc_mapping_versions mapping
      JOIN approval_entries mapping_entry ON mapping_entry.id = mapping.approval_entry_id
      WHERE mapping.book_id = ${bookId}
        AND mapping_entry.domain = 'dcl'
        AND mapping_entry.entity = 'acc-mapping'
        AND mapping_entry.status = 'APPROVED'
    `.execute(tx)
    const mapped = new Set(mappedEntities.rows.map((row) => row.entity))
    const missingMapping = monthEntries.find((entry) => entry.status === 'APPROVED' && !mapped.has(entry.entity))
    if (missingMapping)
      throw new AccApplicationError('acc_period_mapping_missing', [{ kind: 'MAPPING', entity: missingMapping.entity }])

    const negativeInventory = approvedThroughMonthEntryIds.length === 0 ? undefined : (await sql<{ warehouse_id: string; product_id: string }>`
      SELECT inventory.warehouse_id, inventory.product_id
      FROM acc_inventory_entries inventory
      WHERE inventory.vou_approval_entry_id IN (${sql.join(approvedThroughMonthEntryIds)})
      GROUP BY inventory.warehouse_id, inventory.product_id
      HAVING SUM(inventory.quantity) < 0
      LIMIT 1
    `.execute(tx)).rows[0]
    if (negativeInventory)
      throw new AccApplicationError('acc_period_negative_inventory', [{ kind: 'INVENTORY', ...negativeInventory }])

    const unbalanced = await sql<{ currency: string }>`
      SELECT journal.currency
      FROM acc_journal_entries journal
      JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
      WHERE journal.book_id = ${bookId}
        AND to_char(journal.business_date, 'YYYY-MM') = ${month}
      GROUP BY journal.currency
      HAVING SUM(CASE WHEN line.direction = 'DEBIT' THEN line.amount ELSE -line.amount END) <> 0
      LIMIT 1
    `.execute(tx)
    if (unbalanced.rows[0])
      throw new AccApplicationError('acc_period_unbalanced', [{ kind: 'TRIAL_BALANCE', currency: unbalanced.rows[0].currency }])
  }

  private async validatePeriodUnlock(
    tx: Transaction<DB>,
    bookId: string,
    month: string,
    currentlyLocked: boolean,
  ): Promise<void> {
    if (!currentlyLocked) throw new AccApplicationError('acc_period_not_locked')
    const latestLocked = await tx.selectFrom('acc_periods').select('period_month')
      .where('book_id', '=', bookId).where('locked', '=', true)
      .orderBy('period_month', 'desc').executeTakeFirstOrThrow()
    if (latestLocked.period_month !== month)
      throw new AccApplicationError('acc_period_unlock_not_latest')
  }

  private async validatePeriodTrialBalance(tx: Transaction<DB>, bookId: string, month: string): Promise<void> {
    const unbalanced = await sql<{ currency: string }>`
      SELECT journal.currency
      FROM acc_journal_entries journal
      JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
      WHERE journal.book_id = ${bookId}
        AND to_char(journal.business_date, 'YYYY-MM') = ${month}
      GROUP BY journal.currency
      HAVING SUM(CASE WHEN line.direction = 'DEBIT' THEN line.amount ELSE -line.amount END) <> 0
      LIMIT 1
    `.execute(tx)
    if (unbalanced.rows[0])
      throw new AccApplicationError('acc_period_unbalanced', [{ kind: 'TRIAL_BALANCE', currency: unbalanced.rows[0].currency }])
  }

  private async persistPeriodBalances(tx: Transaction<DB>, bookId: string, month: string): Promise<void> {
    const periodStart = `${month}-01`
    const periodEnd = `${nextMonth(month)}-01`
    await this.deletePeriodBalances(tx, bookId, month)
    await sql`
      INSERT INTO acc_period_balances (
        book_id, period_month, subject_id, currency, dimensions, dimension_key,
        opening_balance, debit_amount, credit_amount, closing_balance, created_at
      )
      SELECT
        ${bookId}, ${month}, line.subject_id, journal.currency, line.dimensions,
        line.dimensions::text,
        COALESCE(SUM(CASE
          WHEN journal.business_date < ${periodStart}::date
          THEN CASE WHEN line.direction = 'DEBIT' THEN line.amount ELSE -line.amount END
          ELSE 0
        END), 0),
        COALESCE(SUM(CASE
          WHEN journal.business_date >= ${periodStart}::date AND journal.business_date < ${periodEnd}::date AND line.direction = 'DEBIT'
          THEN line.amount ELSE 0
        END), 0),
        COALESCE(SUM(CASE
          WHEN journal.business_date >= ${periodStart}::date AND journal.business_date < ${periodEnd}::date AND line.direction = 'CREDIT'
          THEN line.amount ELSE 0
        END), 0),
        COALESCE(SUM(CASE WHEN line.direction = 'DEBIT' THEN line.amount ELSE -line.amount END), 0),
        ${new Date()}
      FROM acc_journal_entries journal
      JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
      WHERE journal.book_id = ${bookId}
        AND journal.business_date < ${periodEnd}::date
      GROUP BY line.subject_id, journal.currency, line.dimensions
      ORDER BY line.subject_id ASC, journal.currency ASC, line.dimensions::text ASC
    `.execute(tx)
  }

  private async deletePeriodBalances(tx: Transaction<DB>, bookId: string, month: string): Promise<void> {
    await sql`DELETE FROM acc_period_balances WHERE book_id = ${bookId} AND period_month = ${month}`.execute(tx)
  }

  private async persistOpeningFacts(
    tx: Transaction<DB>,
    openingApprovalEntryId: string,
    input: AccOpeningInput,
    occurredAt: Date,
  ): Promise<void> {
    const book = await tx.selectFrom('acc_books').select(['start_month', 'control_book'])
      .where('id', '=', input.bookId).executeTakeFirstOrThrow()
    const subjects = await tx.selectFrom('acc_subjects').select(['id', 'inventory_quantity'])
      .where('book_id', '=', input.bookId).execute()
    const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]))
    const inventoryFacts = input.lines.flatMap((line) => {
      const subject = subjectsById.get(line.subjectId)
      return subject?.inventory_quantity
        ? [{ bookId: input.bookId, subjectId: line.subjectId, warehouseId: line.dimensions.WAREHOUSE!, productId: line.dimensions.PRODUCT! }]
        : []
    })
    if (book.control_book) await this.lockControlInventory(tx, inventoryFacts)
    const byCurrency = new Map<string, AccOpeningInput['lines']>()
    for (const line of input.lines) {
      const lines = byCurrency.get(line.currency) ?? []
      lines.push(line)
      byCurrency.set(line.currency, lines)
    }
    for (const [currency, lines] of [...byCurrency.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const journalId = ulid()
      await sql`
        INSERT INTO acc_journal_entries (
          id, book_id, source_kind, vou_document_id, vou_approval_entry_id,
          opening_approval_entry_id, business_date, currency, created_at
        ) VALUES (
          ${journalId}, ${input.bookId}, 'OPENING', NULL, NULL,
          ${openingApprovalEntryId}, ${`${book.start_month}-01`}::date, ${currency}, ${occurredAt}
        )
      `.execute(tx)
      for (const line of lines) {
        await tx.insertInto('acc_journal_lines').values({
          id: ulid(), journal_entry_id: journalId, subject_id: line.subjectId,
          direction: line.direction, amount: line.amount, dimensions: asJson(line.dimensions),
        }).execute()
        const subject = subjectsById.get(line.subjectId)!
        if (subject.inventory_quantity) {
          await sql`
            INSERT INTO acc_inventory_entries (
              id, vou_approval_entry_id, document_id, opening_approval_entry_id, book_id, subject_id, journal_entry_id,
              line_id, warehouse_id, product_id, business_date, quantity, created_at
            ) VALUES (
              ${ulid()}, ${null}, ${null}, ${openingApprovalEntryId}, ${input.bookId}, ${line.subjectId}, ${journalId},
              ${ulid()}, ${line.dimensions.WAREHOUSE}, ${line.dimensions.PRODUCT}, ${`${book.start_month}-01`}::date,
              ${line.direction === 'DEBIT' ? line.quantity! : `-${line.quantity!}`}, ${occurredAt}
            )
          `.execute(tx)
        }
      }
    }
    if (book.control_book) await this.assertControlInventoryNonNegative(tx, inventoryFacts)
    const assetConfiguration = input.assets.length === 0 ? null : await this.openingAssetConfiguration(tx, input.bookId)
    for (const asset of input.assets) {
      const existing = await sql<{ id: string }>`SELECT id FROM acc_asset_registers WHERE id = ${asset.assetId!} FOR UPDATE`.execute(tx)
      const createObject = existing.rows.length === 0
      if (createObject) {
        if (!asset.assetNo || !asset.name || !asset.categoryId || !asset.departmentId || !asset.usefulLifeMonths || !asset.residualRate || !asset.acquiredOn)
          throw new AccApplicationError('acc_opening_asset_invalid')
        await sql`
          INSERT INTO acc_asset_registers (
            id, asset_no, name, status, acquisition_vou_approval_entry_id,
            acquisition_opening_approval_entry_id, state_vou_approval_entry_id,
            state_opening_approval_entry_id, payload, created_at
          ) VALUES (
            ${asset.assetId!}, ${asset.assetNo}, ${asset.name}, 'ACTIVE', NULL,
            ${openingApprovalEntryId}, NULL, ${openingApprovalEntryId}, ${JSON.stringify(asset)}::jsonb, ${occurredAt}
          )
        `.execute(tx)
      }
      await sql`
        INSERT INTO acc_asset_book_values (
          asset_id, book_id, acquisition_vou_approval_entry_id,
          acquisition_opening_approval_entry_id, original_value, created_at
        ) VALUES (
          ${asset.assetId!}, ${input.bookId}, NULL,
          ${openingApprovalEntryId}, ${asset.originalValue}, ${occurredAt}
        )
      `.execute(tx)
      await this.insertOpeningRegisterEntry(tx, 'ASSET', asset.assetId!, openingApprovalEntryId, asset, occurredAt)
      this.assertOpeningAssetLines(input.lines, assetConfiguration!, asset)
    }
    for (const bill of input.bills) {
      const existing = await sql<{ id: string }>`SELECT id FROM acc_bill_registers WHERE id = ${bill.billId!} FOR UPDATE`.execute(tx)
      const createObject = existing.rows.length === 0
      if (createObject) {
        if (!bill.billNo || !bill.billType || !bill.positionType || !bill.medium || !bill.faceAmount || !bill.issueDate || !bill.maturityDate || !bill.drawer || !bill.acceptor || !bill.payee || bill.annualRateBps === undefined || bill.interestDays === undefined || !bill.interestAmount || !bill.customerCostAmount || !bill.originatingCounterparty)
          throw new AccApplicationError('acc_opening_bill_invalid')
        await sql`
          INSERT INTO acc_bill_registers (
            id, bill_no, position_type, status, created_vou_approval_entry_id,
            created_opening_approval_entry_id, state_vou_approval_entry_id,
            state_opening_approval_entry_id, payload, created_at
          ) VALUES (
            ${bill.billId!}, ${bill.billNo}, ${bill.positionType}, 'AVAILABLE', NULL,
            ${openingApprovalEntryId}, NULL, ${openingApprovalEntryId}, ${JSON.stringify(bill)}::jsonb, ${occurredAt}
          )
        `.execute(tx)
      }
      await sql`
        INSERT INTO acc_bill_book_values (
          bill_id, book_id, opening_approval_entry_id, value_amount, created_at
        ) VALUES (
          ${bill.billId!}, ${input.bookId}, ${openingApprovalEntryId}, ${bill.valueAmount}, ${occurredAt}
        )
      `.execute(tx)
      await this.insertOpeningRegisterEntry(tx, 'BILL', bill.billId!, openingApprovalEntryId, bill, occurredAt)
      this.assertOpeningBillLines(input.lines, bill)
    }
    for (const container of input.containers) {
      await sql`
        INSERT INTO acc_opening_container_balances (
          opening_approval_entry_id, customer_subunit_id, customer_id,
          customer_approval_entry_id, customer_subunit_code, customer_subunit_name,
          container_type, quantity, created_at
        ) VALUES (
          ${openingApprovalEntryId}, ${container.subunit.objectId}, ${container.subunit.customerId},
          ${container.subunit.approvalEntryId}, ${container.subunit.code}, ${container.subunit.name},
          ${container.containerType}, ${container.quantity}, ${occurredAt}
        )
      `.execute(tx)
      await this.insertOpeningRegisterEntry(tx, 'CONTAINER', container.subunit.objectId, openingApprovalEntryId, container, occurredAt)
    }
  }

  private async deleteOpeningFacts(tx: Transaction<DB>, openingApprovalEntryId: string): Promise<void> {
    const otherBook = await sql<{ id: string }>`
      SELECT asset_id AS id FROM acc_asset_book_values
      JOIN acc_asset_registers asset ON asset.id = acc_asset_book_values.asset_id
      WHERE asset.acquisition_opening_approval_entry_id = ${openingApprovalEntryId}
        AND acc_asset_book_values.book_id <> (SELECT subject_id FROM approval_entries WHERE id = ${openingApprovalEntryId})
      UNION ALL
      SELECT id FROM acc_asset_registers
      WHERE acquisition_opening_approval_entry_id = ${openingApprovalEntryId}
        AND state_opening_approval_entry_id IS DISTINCT FROM ${openingApprovalEntryId}
      UNION ALL
      SELECT id FROM acc_bill_registers
      WHERE created_opening_approval_entry_id = ${openingApprovalEntryId}
        AND state_opening_approval_entry_id IS DISTINCT FROM ${openingApprovalEntryId}
      UNION ALL
      SELECT value.bill_id AS id FROM acc_bill_book_values value
      JOIN acc_bill_registers bill ON bill.id = value.bill_id
      WHERE bill.created_opening_approval_entry_id = ${openingApprovalEntryId}
        AND value.book_id <> (SELECT subject_id FROM approval_entries WHERE id = ${openingApprovalEntryId})
      LIMIT 1
    `.execute(tx)
    if (otherBook.rows[0])
      throw new AccApplicationError('acc_opening_unapprove_blocked', [{ kind: 'GLOBAL_OBJECT', id: otherBook.rows[0].id }])
    await sql`DELETE FROM acc_opening_container_balances WHERE opening_approval_entry_id = ${openingApprovalEntryId}`.execute(tx)
    await sql`DELETE FROM acc_asset_book_values WHERE acquisition_opening_approval_entry_id = ${openingApprovalEntryId}`.execute(tx)
    await sql`DELETE FROM acc_bill_book_values WHERE opening_approval_entry_id = ${openingApprovalEntryId}`.execute(tx)
    await sql`DELETE FROM acc_asset_registers WHERE acquisition_opening_approval_entry_id = ${openingApprovalEntryId}`.execute(tx)
    await sql`DELETE FROM acc_bill_registers WHERE created_opening_approval_entry_id = ${openingApprovalEntryId}`.execute(tx)
    await sql`DELETE FROM acc_register_entries WHERE opening_approval_entry_id = ${openingApprovalEntryId}`.execute(tx)
    await sql`DELETE FROM acc_journal_entries WHERE opening_approval_entry_id = ${openingApprovalEntryId}`.execute(tx)
  }

  private async requireBookAccess(executor: Executor, bookId: string, actor: ApprovalActor, operate: boolean) {
    const book = await executor.selectFrom('acc_books').select('id').where('id', '=', bookId).executeTakeFirst()
    if (!book) throw new AccApplicationError('acc_book_not_found')
    if (actor.trusted === true) return
    const access = await executor.selectFrom('acc_book_access').selectAll()
      .where('book_id', '=', bookId).where('user_id', '=', actor.id).executeTakeFirst()
    if (!access || (operate ? !access.can_operate : !access.can_query))
      throw new AccApplicationError('acc_book_access_denied')
  }

  private normalizeOpening(input: AccOpeningInput): AccOpeningInput {
    return {
      ...input,
      assets: input.assets.map((asset) => ({ ...asset, assetId: asset.assetId ?? ulid() })),
      bills: input.bills.map((bill) => ({ ...bill, billId: bill.billId ?? ulid() })),
      containers: input.containers.map((container) => ({
        ...container,
        subunit: { ...container.subunit },
      })),
    }
  }

  private async insertOpeningRegisterEntry(
    tx: Transaction<DB>,
    kind: 'ASSET' | 'BILL' | 'CONTAINER',
    objectId: string,
    openingApprovalEntryId: string,
    payload: object,
    occurredAt: Date,
  ): Promise<void> {
    await sql`
      INSERT INTO acc_register_entries (
        id, register_kind, object_id, source_kind, vou_approval_entry_id,
        opening_approval_entry_id, payload, created_at
      ) VALUES (
        ${ulid()}, ${kind}, ${objectId}, 'OPENING', NULL,
        ${openingApprovalEntryId}, ${JSON.stringify(payload)}::jsonb, ${occurredAt}
      )
    `.execute(tx)
  }

  private async openingAssetConfiguration(executor: Executor, bookId: string) {
    const rows = await sql<{ mapping_definition: JsonValue }>`
      SELECT DISTINCT ON (mapping.vou_entity_id) mapping.mapping_definition
      FROM dcl_acc_mapping_versions mapping
      JOIN approval_entries entry ON entry.id = mapping.approval_entry_id
      WHERE entry.domain = 'dcl' AND entry.entity = 'acc-mapping'
        AND entry.status = 'APPROVED' AND mapping.book_id = ${bookId}
      ORDER BY mapping.vou_entity_id, entry.version_no DESC
    `.execute(executor)
    const configurations: Array<{
      assetSubjectId: string
      assetDimensions: Record<string, string>
      accumulatedDepreciationSubjectId: string
      accumulatedDepreciationDimensions: Record<string, string>
    }> = []
    for (const row of rows.rows) {
      const definition = row.mapping_definition
      if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) continue
      const asset = (definition as Record<string, unknown>).assetConfiguration
      if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) continue
      const value = asset as Record<string, unknown>
      if (typeof value.assetSubjectId === 'string' && typeof value.accumulatedDepreciationSubjectId === 'string'
        && typeof value.assetDimensions === 'object' && value.assetDimensions !== null
        && typeof value.accumulatedDepreciationDimensions === 'object' && value.accumulatedDepreciationDimensions !== null)
        configurations.push({
          assetSubjectId: value.assetSubjectId,
          assetDimensions: value.assetDimensions as Record<string, string>,
          accumulatedDepreciationSubjectId: value.accumulatedDepreciationSubjectId,
          accumulatedDepreciationDimensions: value.accumulatedDepreciationDimensions as Record<string, string>,
        })
    }
    const distinct = configurations.filter((configuration, index) =>
      configurations.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(configuration)) === index)
    if (distinct.length !== 1) throw new AccApplicationError('acc_opening_asset_configuration_required')
    return distinct[0]!
  }

  private assertOpeningAssetLines(
    lines: AccOpeningInput['lines'],
    configuration: Awaited<ReturnType<AccService['openingAssetConfiguration']>>,
    asset: AccOpeningAsset,
  ): void {
    const matches = (subjectId: string, dimensions: Record<string, string>, direction: 'DEBIT' | 'CREDIT', amount: string) =>
      lines.some((line) => line.subjectId === subjectId && line.currency === asset.currency
        && line.direction === direction && decimalUnits(line.amount) === decimalUnits(amount)
        && line.dimensions.ASSET === asset.assetId
        && Object.entries(dimensions).every(([key, value]) => line.dimensions[key] === value))
    if (!matches(configuration.assetSubjectId, configuration.assetDimensions, 'DEBIT', asset.originalValue)
      || (decimalUnits(asset.accumulatedDepreciation) > 0n
        && !matches(configuration.accumulatedDepreciationSubjectId, configuration.accumulatedDepreciationDimensions, 'CREDIT', asset.accumulatedDepreciation)))
      throw new AccApplicationError('acc_opening_asset_reconciliation_invalid')
  }

  private assertOpeningBillLines(lines: AccOpeningInput['lines'], bill: AccOpeningBill): void {
    const direction = bill.positionType === 'LIABILITY' ? 'CREDIT' : 'DEBIT'
    if (!lines.some((line) => line.currency === bill.currency && line.direction === direction
      && line.dimensions.BILL === bill.billId && decimalUnits(line.amount) === decimalUnits(bill.valueAmount)))
      throw new AccApplicationError('acc_opening_bill_reconciliation_invalid')
  }

  private async validateOpening(executor: Executor, input: AccOpeningInput) {
    const subjects = await executor.selectFrom('acc_subjects').select(['id', 'enabled', 'required_dimensions', 'inventory_quantity'])
      .where('book_id', '=', input.bookId).execute()
    const byId = new Map(subjects.map((subject) => [subject.id, subject]))
    const totals = new Map<string, { debit: bigint; credit: bigint }>()
    for (const line of input.lines) {
      const subject = byId.get(line.subjectId)
      if (!subject?.enabled) throw new AccApplicationError('acc_opening_subject_invalid')
      const required = subject.required_dimensions as unknown as string[]
      if (required.some((dimension) => !line.dimensions[dimension]))
        throw new AccApplicationError('acc_opening_dimension_required')
      if (subject.inventory_quantity) {
        if (!line.quantity) throw new AccApplicationError('acc_inventory_quantity_required')
        if (decimalUnits(line.quantity) <= 0n) throw new AccApplicationError('acc_inventory_quantity_invalid')
        if (!line.dimensions.WAREHOUSE || !line.dimensions.PRODUCT)
          throw new AccApplicationError('acc_inventory_dimension_required')
      }
      const amount = decimalUnits(line.amount)
      const total = totals.get(line.currency) ?? { debit: 0n, credit: 0n }
      total[line.direction === 'DEBIT' ? 'debit' : 'credit'] += amount
      totals.set(line.currency, total)
    }
    if ([...totals.values()].some((total) => total.debit !== total.credit))
      throw new AccApplicationError('acc_opening_unbalanced')
    for (const asset of input.assets) {
      if (decimalUnits(asset.originalValue) <= 0n || decimalUnits(asset.accumulatedDepreciation) < 0n || decimalUnits(asset.accumulatedDepreciation) > decimalUnits(asset.originalValue))
        throw new AccApplicationError('acc_opening_asset_invalid')
      const createsObject = Boolean(asset.assetNo || asset.name || asset.categoryId || asset.departmentId || asset.usefulLifeMonths || asset.residualRate || asset.acquiredOn)
      if (createsObject && (!asset.assetNo || !asset.name || !asset.categoryId || !asset.departmentId || !asset.usefulLifeMonths || !asset.residualRate || !asset.acquiredOn || decimalUnits(asset.residualRate) > 100_000_000n))
        throw new AccApplicationError('acc_opening_asset_invalid')
      if (!createsObject && asset.assetId) {
        const existing = await sql<{ id: string }>`SELECT id FROM acc_asset_registers WHERE id = ${asset.assetId}`.execute(executor)
        if (!existing.rows[0]) throw new AccApplicationError('acc_opening_asset_invalid')
      }
    }
    for (const bill of input.bills) {
      if (decimalUnits(bill.valueAmount) <= 0n) throw new AccApplicationError('acc_opening_bill_invalid')
      const createsObject = Boolean(bill.billNo || bill.billType || bill.positionType || bill.medium || bill.faceAmount || bill.issueDate || bill.maturityDate || bill.drawer || bill.acceptor || bill.payee || bill.originatingCounterparty)
      if (createsObject && (!bill.billNo || !bill.billType || !bill.positionType || !bill.medium || !bill.faceAmount || !bill.issueDate || !bill.maturityDate || !bill.drawer || !bill.acceptor || !bill.payee || bill.annualRateBps === undefined || bill.interestDays === undefined || !bill.interestAmount || !bill.customerCostAmount || !bill.originatingCounterparty || decimalUnits(bill.faceAmount) <= 0n || decimalUnits(bill.interestAmount) < 0n || decimalUnits(bill.customerCostAmount) < 0n || bill.maturityDate < bill.issueDate))
        throw new AccApplicationError('acc_opening_bill_invalid')
      if (!createsObject && bill.billId) {
        const existing = await sql<{ id: string }>`SELECT id FROM acc_bill_registers WHERE id = ${bill.billId}`.execute(executor)
        if (!existing.rows[0]) throw new AccApplicationError('acc_opening_bill_invalid')
      }
      if (bill.originatingCounterparty) {
        const reference = await sql<{ id: string; name: string; customer_id: string | null }>`
          SELECT entry.id,
            CASE entry.entity
              WHEN 'customer' THEN customer.display_name
              WHEN 'supplier' THEN supplier.legal_name
              WHEN 'other-unit' THEN other_unit.legal_name
              WHEN 'employee' THEN employee.display_name
              WHEN 'sales-partner' THEN sales_partner.legal_name
              WHEN 'operating-entity' THEN operating_entity.legal_name
            END AS name,
            CASE WHEN entry.entity = 'customer' THEN entry.subject_id ELSE NULL END AS customer_id
          FROM approval_entries entry
          JOIN dcl_subjects subject ON subject.id = entry.subject_id
          LEFT JOIN dcl_customer_versions customer ON customer.approval_entry_id = entry.id
          LEFT JOIN dcl_supplier_versions supplier ON supplier.approval_entry_id = entry.id
          LEFT JOIN dcl_other_unit_versions other_unit ON other_unit.approval_entry_id = entry.id
          LEFT JOIN dcl_employee_versions employee ON employee.approval_entry_id = entry.id
          LEFT JOIN dcl_sales_partner_versions sales_partner ON sales_partner.approval_entry_id = entry.id
          LEFT JOIN dcl_operating_entity_versions operating_entity ON operating_entity.approval_entry_id = entry.id
          WHERE entry.id = ${bill.originatingCounterparty.approvalEntryId}
            AND entry.domain = 'dcl' AND entry.entity = ${bill.originatingCounterparty.entity}
            AND entry.subject_id = ${bill.originatingCounterparty.objectId}
            AND entry.status = 'APPROVED' AND subject.code = ${bill.originatingCounterparty.code}
        `.execute(executor)
        const row = reference.rows[0]
        if (!row || row.name !== bill.originatingCounterparty.name
          || (row.customer_id ?? undefined) !== bill.originatingCounterparty.customerId)
          throw new AccApplicationError('acc_opening_bill_counterparty_invalid')
      }
    }
    for (const container of input.containers) {
      const current = await sql<{ customer_id: string; code: string; name: string }>`
        SELECT root.customer_id, root.code, subunit.name
        FROM dcl_customer_subunit_roots root
        JOIN dcl_customer_version_subunits subunit
          ON subunit.subunit_id = root.subunit_id
          AND subunit.customer_approval_entry_id = ${container.subunit.approvalEntryId}
        JOIN approval_entries entry ON entry.id = subunit.customer_approval_entry_id
        JOIN dcl_customer_versions customer ON customer.approval_entry_id = entry.id
        WHERE root.subunit_id = ${container.subunit.objectId}
          AND entry.domain = 'dcl' AND entry.entity = 'customer' AND entry.status = 'APPROVED'
          AND subunit.enabled = true AND customer.enabled = true
          AND NOT EXISTS (
            SELECT 1 FROM approval_entries later
            WHERE later.domain = 'dcl' AND later.entity = 'customer'
              AND later.subject_id = root.customer_id AND later.status = 'APPROVED'
              AND later.version_no > entry.version_no
          )
      `.execute(executor)
      const row = current.rows[0]
      if (!row || row.customer_id !== container.subunit.customerId || row.code !== container.subunit.code || row.name !== container.subunit.name)
        throw new AccApplicationError('acc_opening_container_current_snapshot_invalid')
    }
  }

  private async readOpening(executor: Executor, bookId: string, actor: ApprovalActor) {
    const row = await executor.selectFrom('approval_entries as e')
      .innerJoin('acc_opening_snapshots as s', 's.approval_entry_id', 'e.id')
      .select(['e.id', 'e.subject_id', 'e.status', 'e.revision', 'e.submitted_by', 'e.submitted_at',
        'e.approved_by', 'e.approved_at', 'e.rejected_by', 'e.rejected_at', 'e.rejection_reason', 's.payload'])
      .where('e.domain', '=', 'acc').where('e.entity', '=', 'opening')
      .where('e.subject_id', '=', bookId).executeTakeFirst()
    if (!row) throw new AccApplicationError('approval_not_found')
    const entry = entryFromRow(row)
    return {
      bookId,
      submissionId: row.id,
      approval: entry,
      payload: row.payload as unknown as AccOpeningInput,
      availableApprovalActions: availableApprovalActions(entry, actor),
    }
  }

  async getOpening(bookId: string, actor: ApprovalActor) {
    requirePermission(actor, '/acc/opening/query')
    await this.requireBookAccess(this.db, bookId, actor, false)
    return this.readOpening(this.db, bookId, actor)
  }

  async deleteOpening(input: AccOpeningReviewInput, actor: ApprovalActor, requestId: string) {
    requirePermission(actor, '/acc/opening/delete')
    return this.db.transaction().execute(async (tx) => {
      const row = await tx.selectFrom('approval_entries').selectAll().where('id', '=', input.submissionId)
        .where('domain', '=', 'acc').where('entity', '=', 'opening').where('subject_id', '=', input.bookId).forUpdate().executeTakeFirst()
      if (!row) throw new AccApplicationError('approval_not_found')
      await this.requireBookAccess(tx, input.bookId, actor, true)
      if (String(row.revision) !== input.expectedRevision) throw new AccApplicationError('approval_stale_revision')
      if (row.status === 'APPROVED') throw new AccApplicationError('acc_opening_delete_blocked')
      if (actor.trusted !== true && row.submitted_by !== actor.id) throw new AccApplicationError('approval_invalid_action')
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: row.id, domain: 'acc', entity: 'opening', subject_id: input.bookId,
        version_no: null, action: 'DELETED', from_status: row.status, to_status: null,
        from_revision: row.revision, to_revision: null, actor_id: actor.id, reason: null,
        request_id: requestId, created_at: new Date(),
      }).execute()
      await tx.deleteFrom('approval_entries').where('id', '=', row.id).executeTakeFirstOrThrow()
      return { submissionId: row.id, deleted: true as const }
    })
  }

  private bookView(row: { id: string; code: string; name: string; description: string; start_month: string; base_currency: string; control_book: boolean; revision: string | number | bigint }) {
    return { id: row.id, code: row.code, name: row.name, description: row.description, startMonth: row.start_month, baseCurrency: row.base_currency, controlBook: row.control_book, revision: String(row.revision) }
  }

  private subjectView(row: { id: string; book_id: string; code: string; name: string; parent_id: string | null; balance_direction: string; enabled: boolean; required_dimensions: JsonValue; inventory_quantity: boolean; settlement_purpose: string; revision: string | number | bigint }) {
    return { id: row.id, bookId: row.book_id, code: row.code, name: row.name, parentId: row.parent_id, balanceDirection: row.balance_direction, enabled: row.enabled, requiredDimensions: row.required_dimensions as unknown as string[], inventoryQuantity: row.inventory_quantity, settlementPurpose: row.settlement_purpose, revision: String(row.revision) }
  }
}
