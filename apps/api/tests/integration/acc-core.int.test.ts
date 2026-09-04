import assert from 'node:assert/strict'
import test from 'node:test'
import type { VouPayloadFor } from '@zerp/model'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import { createDatabase } from '../../src/db/database.ts'
import { AccApplicationError, AccService } from '../../src/acc/service.ts'
import { VouService } from '../../src/vou/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('ACC Opening persists typed asset, bill, and current customer-subunit container facts then reverses them', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const service = new AccService(db)
  const actorId = ulid(), reviewerId = ulid(), bookId = ulid(), openingId = ulid(), mappingId = ulid(), mappingEntryId = ulid()
  const supplierId = ulid(), supplierEntryId = ulid(), customerId = ulid(), customerEntryId = ulid(), subunitId = ulid()
  const assetId = ulid(), billId = ulid()
  const actor = { id: actorId, permissions: [] as string[], trusted: true }
  context.after(async () => {
    try {
      await sql`DELETE FROM acc_opening_container_balances WHERE opening_approval_entry_id = ${openingId}`.execute(db)
      await sql`DELETE FROM acc_register_entries WHERE opening_approval_entry_id = ${openingId}`.execute(db)
      await sql`DELETE FROM acc_bill_book_values WHERE opening_approval_entry_id = ${openingId}`.execute(db)
      await sql`DELETE FROM acc_asset_book_values WHERE acquisition_opening_approval_entry_id = ${openingId}`.execute(db)
      await sql`DELETE FROM acc_asset_registers WHERE acquisition_opening_approval_entry_id = ${openingId}`.execute(db)
      await sql`DELETE FROM acc_bill_registers WHERE created_opening_approval_entry_id = ${openingId}`.execute(db)
      await db.deleteFrom('approval_events').where('entry_id', 'in', [openingId, mappingEntryId, supplierEntryId, customerEntryId]).execute()
      await db.deleteFrom('approval_entries').where('id', 'in', [openingId, mappingEntryId, supplierEntryId, customerEntryId]).execute()
      await db.deleteFrom('dcl_subjects').where('id', 'in', [mappingId, supplierId, customerId]).execute()
      await db.deleteFrom('acc_subjects').where('book_id', '=', bookId).execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db.deleteFrom('app_users').where('id', 'in', [actorId, reviewerId]).execute()
    } finally { await db.destroy() }
  })
  const now = new Date()
  await db.insertInto('app_users').values([actorId, reviewerId].map((id) => ({ id, username: `acc-opening-${id}`, display_name: 'Opening actor', password_hash: 'unused', status: 'ENABLED' as const, password_changed_at: now, password_change_required: false }))).execute()
  const book = await service.createBook({ id: bookId, name: 'Opening typed facts', description: '', startMonth: '2026-08', baseCurrency: 'CNY' }, actor)
  const assetSubject = await service.createSubject({ id: ulid(), bookId, code: '1601', name: '固定资产', parentId: null, balanceDirection: 'DEBIT', enabled: true, requiredDimensions: ['ASSET'], inventoryQuantity: false, settlementPurpose: 'NONE' }, actor)
  const billSubject = await service.createSubject({ id: ulid(), bookId, code: '1121', name: '应收票据', parentId: null, balanceDirection: 'DEBIT', enabled: true, requiredDimensions: ['BILL'], inventoryQuantity: false, settlementPurpose: 'NONE' }, actor)
  const equitySubject = await service.createSubject({ id: ulid(), bookId, code: '4001', name: '期初权益', parentId: null, balanceDirection: 'CREDIT', enabled: true, requiredDimensions: [], inventoryQuantity: false, settlementPurpose: 'NONE' }, actor)
  await db.insertInto('dcl_subjects').values([
    { id: mappingId, entity: 'acc-mapping', code: null, created_at: now, created_by: actorId },
    { id: supplierId, entity: 'supplier', code: 'SUP-0001', created_at: now, created_by: actorId },
    { id: customerId, entity: 'customer', code: 'CUS-0001', created_at: now, created_by: actorId },
  ]).execute()
  await db.insertInto('approval_entries').values([
    { id: mappingEntryId, domain: 'dcl', entity: 'acc-mapping', subject_id: mappingId, version_no: 1, status: 'APPROVED', revision: 1, submitted_by: actorId, submitted_at: now, approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now },
    { id: supplierEntryId, domain: 'dcl', entity: 'supplier', subject_id: supplierId, version_no: 1, status: 'APPROVED', revision: 1, submitted_by: actorId, submitted_at: now, approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now },
    { id: customerEntryId, domain: 'dcl', entity: 'customer', subject_id: customerId, version_no: 1, status: 'APPROVED', revision: 1, submitted_by: actorId, submitted_at: now, approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now },
  ]).execute()
  await db.insertInto('dcl_supplier_versions').values({ approval_entry_id: supplierEntryId, kind: 'ORGANIZATION', legal_name: '期初供应商', display_name: '期初供应商', legal_identifier: null, default_operating_entity_id: null, default_purchaser_employee_id: null, default_purchaser_approval_entry_id: null, default_purchaser_code: null, default_purchaser_name: null, contact_name: null, contact_phone: null, address: null, remark: null, default_operating_entity_reference: null, settlement_method_snapshot: null, default_purchaser_snapshot: null, enabled: true }).execute()
  await db.insertInto('dcl_customer_versions').values({ approval_entry_id: customerEntryId, kind: 'OTHER', legal_identifier: null, display_name: '期初客户', legal_name: '期初客户', default_operating_entity_id: null, default_operating_entity_approval_entry_id: null, default_operating_entity_code: null, default_operating_entity_name: null, phone: null, email: null, address: null, invoice_title: null, invoice_address: null, invoice_phone: null, invoice_bank: null, invoice_account: null, remittance_profiles: JSON.stringify([]), tax_attachments: JSON.stringify([]), enabled: true }).execute()
  await db.insertInto('dcl_customer_subunit_roots').values({ subunit_id: subunitId, customer_id: customerId, code: 'SUB-0001' }).execute()
  await db.insertInto('dcl_customer_version_subunits').values({ customer_approval_entry_id: customerEntryId, subunit_id: subunitId, name: '期初客户子单位', contact_name: null, contact_phone: null, business_address: null, customer_type_id: null, settlement_method_id: null, primary_sales_attribution_type: null, primary_sales_attribution_object_id: null, primary_sales_attribution_approval_entry_id: null, primary_sales_attribution_code: null, primary_sales_attribution_name: null, sales_attribution_snapshot: null, settlement_snapshot: null, payment_snapshot: null, transport_snapshot: null, pricing_snapshot: null, credit_limits: JSON.stringify([]), internal_reminder: null, default_order_remark: null, business_attachments: JSON.stringify([]), enabled: true }).execute()
  await db.insertInto('dcl_acc_mapping_versions').values({ approval_entry_id: mappingEntryId, book_id: book.id, vou_entity_id: 'asset-acquisition', book_snapshot: JSON.stringify({}), vou_entity_snapshot: JSON.stringify({}), default_result: 'UN_POST', mapping_definition: JSON.stringify({ assetConfiguration: { assetSubjectId: assetSubject.id, assetDimensions: {}, accumulatedDepreciationSubjectId: equitySubject.id, accumulatedDepreciationDimensions: {}, depreciationExpenseSubjectId: equitySubject.id, depreciationExpenseDimensions: {} } }) }).execute()
  const pending = await service.submitOpening({ bookId, submissionId: openingId, idempotencyKey: openingId, lines: [
    { subjectId: assetSubject.id, currency: 'CNY', direction: 'DEBIT', amount: '100.00', dimensions: { ASSET: assetId } },
    { subjectId: billSubject.id, currency: 'CNY', direction: 'DEBIT', amount: '50.00', dimensions: { BILL: billId } },
    { subjectId: equitySubject.id, currency: 'CNY', direction: 'CREDIT', amount: '150.00', dimensions: {} },
  ], assets: [{ assetId, assetNo: 'AST-OPEN', name: '期初资产', categoryId: ulid(), departmentId: ulid(), usefulLifeMonths: 12, residualRate: '1.0000', acquiredOn: '2026-08-01', currency: 'CNY', originalValue: '100.00', accumulatedDepreciation: '0.00' }], bills: [{ billId, billNo: 'BIL-OPEN', billType: 'CHECK', positionType: 'ASSET', medium: 'PAPER', currency: 'CNY', faceAmount: '50.00', issueDate: '2026-08-01', maturityDate: '2026-09-01', drawer: '出票人', acceptor: '承兑人', payee: '收款人', annualRateBps: 0, interestDays: 0, interestAmount: '0.00', customerCostAmount: '0.00', valueAmount: '50.00', originatingCounterparty: { entity: 'supplier', objectId: supplierId, approvalEntryId: supplierEntryId, code: 'SUP-0001', name: '期初供应商' } }], containers: [{ subunit: { entity: 'customer-subunit', objectId: subunitId, customerId, approvalEntryId: customerEntryId, code: 'SUB-0001', name: '期初客户子单位' }, containerType: 'SOLVENT', quantity: 3 }] }, actor, 'opening-typed-submit')
  const approved = await service.reviewOpening('approve', { bookId, submissionId: openingId, expectedRevision: pending.approval.revision }, { ...actor, id: reviewerId }, 'opening-typed-approve')
  assert.equal(approved.approval.status, 'APPROVED')
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_asset_book_values WHERE asset_id = ${assetId} AND book_id = ${bookId}`.execute(db)).rows[0]!.count, '1')
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_bill_book_values WHERE bill_id = ${billId} AND book_id = ${bookId}`.execute(db)).rows[0]!.count, '1')
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_opening_container_balances WHERE opening_approval_entry_id = ${openingId}`.execute(db)).rows[0]!.count, '1')
  await service.reviewOpening('unapprove', { bookId, submissionId: openingId, expectedRevision: approved.approval.revision, reason: '撤回' }, { ...actor, id: reviewerId }, 'opening-typed-unapprove')
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_register_entries WHERE opening_approval_entry_id = ${openingId}`.execute(db)).rows[0]!.count, '0')
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_asset_registers WHERE id = ${assetId}`.execute(db)).rows[0]!.count, '0')
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_bill_registers WHERE id = ${billId}`.execute(db)).rows[0]!.count, '0')
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_opening_container_balances WHERE opening_approval_entry_id = ${openingId}`.execute(db)).rows[0]!.count, '0')
})

test('ACC book, subjects, Opening and periods keep one transactional fact boundary', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const service = new AccService(db)
  const vou = new VouService(db, {
    acc: service,
    wfl: { async apply() {} },
  })
  const submitterId = ulid(), reviewerId = ulid()
  const productId = ulid(), productApprovalEntryId = ulid()
  const submitter = { id: submitterId, permissions: [] as string[], trusted: true }
  const reviewer = { id: reviewerId, permissions: [] as string[], trusted: true }
  context.after(async () => {
    try {
      await sql`DELETE FROM acc_register_entries WHERE opening_approval_entry_id IS NOT NULL`.execute(db)
      await sql`DELETE FROM acc_period_balances`.execute(db)
      await db.deleteFrom('acc_journal_entries').execute()
      await db.deleteFrom('approval_events').where('domain', '=', 'acc').execute()
      await db.deleteFrom('approval_entries').where('domain', '=', 'acc').execute()
      await db.deleteFrom('approval_events').where('domain', '=', 'vou').execute()
      await db.deleteFrom('vou_idempotency').execute()
      await db.deleteFrom('approval_entries').where('domain', '=', 'vou').execute()
      await db.deleteFrom('vou_documents').execute()
      await db.deleteFrom('approval_events').where('entity', '=', 'acc-mapping').execute()
      await db.deleteFrom('approval_entries').where('entity', '=', 'acc-mapping').execute()
      await db.deleteFrom('dcl_subjects').where('entity', '=', 'acc-mapping').execute()
      await db.deleteFrom('approval_entries').where('id', '=', productApprovalEntryId).execute()
      await db.deleteFrom('dcl_subjects').where('id', '=', productId).execute()
      await db.deleteFrom('acc_subjects').execute()
      await db.deleteFrom('acc_books').execute()
      await db.deleteFrom('app_users').where('id', 'in', [submitterId, reviewerId]).execute()
    } finally { await db.destroy() }
  })
  await db.insertInto('app_users').values([submitterId, reviewerId].map((id) => ({
    id, username: `acc-${id}`, display_name: 'ACC actor', password_hash: 'unused',
    status: 'ENABLED' as const, password_changed_at: new Date(), password_change_required: false,
  }))).execute()
  const now = new Date()
  await db.insertInto('dcl_subjects').values({ id: productId, entity: 'product', code: 'PRD-0001', created_at: now, created_by: submitterId }).execute()
  await db.insertInto('approval_entries').values({ id: productApprovalEntryId, domain: 'dcl', entity: 'product', subject_id: productId, version_no: 1, status: 'APPROVED', revision: 1, submitted_by: submitterId, submitted_at: now, approved_by: submitterId, approved_at: now, updated_by: submitterId, updated_at: now }).execute()
  await db.insertInto('dcl_product_versions').values({ approval_entry_id: productApprovalEntryId, name: '记账测试产品', source_snapshots: {}, unit_conversions: JSON.stringify([]), recyclable: false, enabled: true }).execute()
  const pricingPayload = (amount: string): VouPayloadFor<'sale-pricing'> => ({
    businessDate: '2026-09-04', currency: 'CNY',
    priceLines: [{
      product: { objectId: productId, approvalEntryId: productApprovalEntryId, selectionOrigin: 'CURRENT' },
      unitPrice: amount,
    }],
    attachments: [],
  })

  const book = await service.createBook({
    id: ulid(), name: '业务控制账簿', description: '', startMonth: '2026-08', baseCurrency: 'CNY',
  }, submitter)
  assert.equal(book.code, 'ACC-0001')
  assert.equal(book.controlBook, true)
  await service.grantBookAccess(book.id, reviewerId, submitter)
  assert.deepEqual(await db.selectFrom('acc_book_access').select(['can_query', 'can_operate'])
    .where('book_id', '=', book.id).where('user_id', '=', reviewerId).executeTakeFirst(), { can_query: true, can_operate: true })
  const debit = await service.createSubject({
    id: ulid(), bookId: book.id, code: '1001', name: '库存现金', parentId: null,
    balanceDirection: 'DEBIT', enabled: true, requiredDimensions: [], inventoryQuantity: false, settlementPurpose: 'NONE',
  }, submitter)
  const credit = await service.createSubject({
    id: ulid(), bookId: book.id, code: '4001', name: '期初权益', parentId: null,
    balanceDirection: 'CREDIT', enabled: true, requiredDimensions: [], inventoryQuantity: false, settlementPurpose: 'NONE',
  }, submitter)
  const submissionId = ulid()
  const pending = await service.submitOpening({
    bookId: book.id, submissionId, idempotencyKey: submissionId,
    lines: [
      { subjectId: debit.id, currency: 'CNY', direction: 'DEBIT', amount: '100.00', dimensions: {} },
      { subjectId: credit.id, currency: 'CNY', direction: 'CREDIT', amount: '100.00', dimensions: {} },
    ],
    assets: [],
    bills: [],
    containers: [],
  }, submitter, 'opening-submit')
  assert.equal(pending.approval.status, 'PENDING')
  const approved = await service.reviewOpening('approve', {
    bookId: book.id, submissionId, expectedRevision: pending.approval.revision,
  }, reviewer, 'opening-approve')
  assert.equal(approved.approval.status, 'APPROVED')
  const openingJournal = await sql<{ id: string; source_kind: string }>`
    SELECT id, source_kind
    FROM acc_journal_entries
    WHERE opening_approval_entry_id = ${submissionId}
  `.execute(db)
  assert.deepEqual(openingJournal.rows.map((row) => row.source_kind), ['OPENING'])
  const openingLines = await db.selectFrom('acc_journal_lines').select('id')
    .where('journal_entry_id', '=', openingJournal.rows[0]!.id).execute()
  assert.equal(openingLines.length, 2)
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_register_entries WHERE opening_approval_entry_id = ${submissionId}`.execute(db)).rows[0]!.count, '0')
  const unapprovedOpening = await service.reviewOpening('unapprove', {
    bookId: book.id, submissionId, expectedRevision: approved.approval.revision, reason: '修订期初',
  }, reviewer, 'opening-unapprove')
  assert.equal(unapprovedOpening.approval.status, 'PENDING')
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_journal_entries WHERE opening_approval_entry_id = ${submissionId}`.execute(db)).rows[0]!.count, '0')
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_register_entries WHERE opening_approval_entry_id = ${submissionId}`.execute(db)).rows[0]!.count, '0')
  const reapproved = await service.reviewOpening('approve', {
    bookId: book.id, submissionId, expectedRevision: unapprovedOpening.approval.revision,
  }, reviewer, 'opening-reapprove')
  assert.equal(reapproved.approval.status, 'APPROVED')
  const mappingSubjectId = ulid(), mappingEntryId = ulid(), mappingNow = new Date()
  await db.insertInto('dcl_subjects').values({ id: mappingSubjectId, entity: 'acc-mapping', code: null, created_at: mappingNow, created_by: reviewerId }).execute()
  await db.insertInto('approval_entries').values({
    id: mappingEntryId, domain: 'dcl', entity: 'acc-mapping', subject_id: mappingSubjectId,
    version_no: 1, status: 'APPROVED', revision: 2, submitted_by: submitterId,
    submitted_at: mappingNow, approved_by: reviewerId, approved_at: mappingNow, updated_by: reviewerId, updated_at: mappingNow,
  }).execute()
  await db.insertInto('dcl_acc_mapping_versions').values({
    approval_entry_id: mappingEntryId, book_id: book.id, vou_entity_id: 'sale-pricing',
    book_snapshot: JSON.stringify({ id: book.id, code: book.code, name: book.name }),
    vou_entity_snapshot: JSON.stringify({ id: 'sale-pricing', code: 'sale-pricing', name: '销售定价' }),
    default_result: 'POST', mapping_definition: JSON.stringify({
      defaultTemplateId: 'default', rules: [], templates: [{
        templateId: 'default', collection: 'priceLines', lines: [
          { subjectSource: 'FIXED', subjectValue: debit.id, direction: 'DEBIT', amountField: 'line.unitPrice', currencyField: 'currency', dimensions: {}, quantityField: null },
          { subjectSource: 'FIXED', subjectValue: credit.id, direction: 'CREDIT', amountField: 'line.unitPrice', currencyField: 'currency', dimensions: {}, quantityField: null },
        ],
      }],
    }),
  }).execute()
  const documentId = ulid(), vouSubmissionId = ulid()
  const vouPending = await vou.submit('sale-pricing', 'submit-new', {
    documentId, submissionId: vouSubmissionId, idempotencyKey: vouSubmissionId,
    expectedRevision: null, payload: pricingPayload('25.00'),
  }, submitter, 'posting-submit')
  const vouApproved = await vou.review('sale-pricing', 'approve', {
    documentId, submissionId: vouSubmissionId, expectedRevision: vouPending.revision,
  }, reviewer, 'posting-approve')
  assert.equal(vouApproved.status, 'APPROVED')
  assert.equal((await db.selectFrom('acc_journal_entries').select('id').where('vou_approval_entry_id', '=', vouSubmissionId).execute()).length, 1)
  await vou.review('sale-pricing', 'unapprove', {
    documentId, submissionId: vouSubmissionId, expectedRevision: vouApproved.revision, reason: '撤销记账',
  }, reviewer, 'posting-unapprove')
  assert.equal((await db.selectFrom('acc_journal_entries').select('id').where('vou_approval_entry_id', '=', vouSubmissionId).execute()).length, 0)
  const failedDocumentId = ulid(), failedSubmissionId = ulid()
  const failingVou = new VouService(db, {
    acc: service,
    wfl: { async apply() { throw new Error('forced WFL failure') } },
  })
  const failedPending = await failingVou.submit('sale-pricing', 'submit-new', {
    documentId: failedDocumentId, submissionId: failedSubmissionId, idempotencyKey: failedSubmissionId,
    expectedRevision: null, payload: pricingPayload('10.00'),
  }, submitter, 'forced-submit')
  await assert.rejects(failingVou.review('sale-pricing', 'approve', {
    documentId: failedDocumentId, submissionId: failedSubmissionId, expectedRevision: failedPending.revision,
  }, reviewer, 'forced-approve'), /forced WFL failure/)
  assert.equal((await vou.get('sale-pricing', failedDocumentId, reviewer)).status, 'PENDING')
  assert.equal((await db.selectFrom('acc_journal_entries').select('id').where('vou_approval_entry_id', '=', failedSubmissionId).execute()).length, 0)
  const concurrentDocumentId = ulid(), concurrentSubmissionId = ulid()
  const concurrentPending = await vou.submit('sale-pricing', 'submit-new', {
    documentId: concurrentDocumentId, submissionId: concurrentSubmissionId, idempotencyKey: concurrentSubmissionId,
    expectedRevision: null, payload: pricingPayload('12.00'),
  }, submitter, 'concurrent-submit')
  const attempts = await Promise.allSettled([
    vou.review('sale-pricing', 'approve', { documentId: concurrentDocumentId, submissionId: concurrentSubmissionId, expectedRevision: concurrentPending.revision }, reviewer, 'concurrent-1'),
    vou.review('sale-pricing', 'approve', { documentId: concurrentDocumentId, submissionId: concurrentSubmissionId, expectedRevision: concurrentPending.revision }, reviewer, 'concurrent-2'),
  ])
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal((await db.selectFrom('acc_journal_entries').select('id').where('vou_approval_entry_id', '=', concurrentSubmissionId).execute()).length, 1)
  await assert.rejects(
    service.reviewOpening('unapprove', {
      bookId: book.id, submissionId, expectedRevision: reapproved.approval.revision, reason: '已有后续记账',
    }, reviewer, 'opening-unapprove-blocked'),
    (error: unknown) => error instanceof AccApplicationError
      && error.errorKey === 'acc_opening_unapprove_blocked'
      && error.data?.blockers.some((blocker) => blocker != null && typeof blocker === 'object' && (blocker as { kind?: unknown }).kind === 'JOURNAL'),
  )
  const period = await service.setPeriod({ bookId: book.id, month: '2026-08', expectedRevision: null }, true, reviewer)
  assert.equal(period.locked, true)
  const periodBalances = await sql<{ subject_id: string; opening_balance: string; debit_amount: string; credit_amount: string; closing_balance: string }>`
    SELECT subject_id, opening_balance::text, debit_amount::text, credit_amount::text, closing_balance::text
    FROM acc_period_balances
    WHERE book_id = ${book.id} AND period_month = '2026-08'
    ORDER BY subject_id ASC
  `.execute(db)
  assert.deepEqual(periodBalances.rows, [
    { subject_id: debit.id, opening_balance: '0.00000000', debit_amount: '100.00000000', credit_amount: '0.00000000', closing_balance: '100.00000000' },
    { subject_id: credit.id, opening_balance: '0.00000000', debit_amount: '0.00000000', credit_amount: '100.00000000', closing_balance: '-100.00000000' },
  ])
  const unlocked = await service.setPeriod({ bookId: book.id, month: '2026-08', expectedRevision: period.revision }, false, reviewer)
  assert.equal(unlocked.locked, false)
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_period_balances WHERE book_id = ${book.id} AND period_month = '2026-08'`.execute(db)).rows[0]!.count, '0')
})

test('ACC automatic inventory posting rejects missing product or warehouse dimensions instead of persisting empty keys', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const service = new AccService(db)
  const actorId = ulid()
  const actor = { id: actorId, permissions: [] as string[], trusted: true }
  const bookId = ulid(), inventorySubjectId = ulid(), offsetSubjectId = ulid(), openingId = ulid(), mappingSubjectId = ulid(), mappingEntryId = ulid(), documentId = ulid(), vouEntryId = ulid()
  context.after(async () => {
    try {
      await db.deleteFrom('acc_inventory_entries').where('vou_approval_entry_id', '=', vouEntryId).execute()
      await db.deleteFrom('acc_journal_entries').where('vou_approval_entry_id', '=', vouEntryId).execute()
      await db.deleteFrom('approval_events').where('entry_id', 'in', [openingId, mappingEntryId, vouEntryId]).execute()
      await db.deleteFrom('approval_entries').where('id', 'in', [openingId, mappingEntryId, vouEntryId]).execute()
      await db.deleteFrom('vou_documents').where('id', '=', documentId).execute()
      await db.deleteFrom('dcl_subjects').where('id', '=', mappingSubjectId).execute()
      await db.deleteFrom('acc_subjects').where('book_id', '=', bookId).execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db.deleteFrom('app_users').where('id', '=', actorId).execute()
    } finally { await db.destroy() }
  })
  const now = new Date()
  await db.insertInto('app_users').values({ id: actorId, username: `acc-inventory-${actorId}`, display_name: 'ACC inventory actor', password_hash: 'unused', status: 'ENABLED', password_changed_at: now, password_change_required: false }).execute()
  const book = await service.createBook({ id: bookId, name: '库存账簿', description: '', startMonth: '2026-08', baseCurrency: 'CNY' }, actor)
  await service.createSubject({ id: inventorySubjectId, bookId, code: '1405', name: '库存商品', parentId: null, balanceDirection: 'DEBIT', enabled: true, requiredDimensions: [], inventoryQuantity: true, settlementPurpose: 'NONE' }, actor)
  await service.createSubject({ id: offsetSubjectId, bookId, code: '6001', name: '库存对方', parentId: null, balanceDirection: 'CREDIT', enabled: true, requiredDimensions: [], inventoryQuantity: false, settlementPurpose: 'NONE' }, actor)
  await db.insertInto('approval_entries').values({ id: openingId, domain: 'acc', entity: 'opening', subject_id: bookId, version_no: null, status: 'APPROVED', revision: 2, submitted_by: actorId, submitted_at: now, approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now }).execute()
  await db.insertInto('vou_documents').values({ id: documentId, entity: 'sale-pricing', document_no: 'SPR-TEST', created_at: now, created_by: actorId }).execute()
  await db.insertInto('approval_entries').values({ id: vouEntryId, domain: 'vou', entity: 'sale-pricing', subject_id: documentId, version_no: null, status: 'APPROVED', revision: 1, submitted_by: actorId, submitted_at: now, approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now }).execute()
  await db.insertInto('dcl_subjects').values({ id: mappingSubjectId, entity: 'acc-mapping', code: null, created_at: now, created_by: actorId }).execute()
  await db.insertInto('approval_entries').values({ id: mappingEntryId, domain: 'dcl', entity: 'acc-mapping', subject_id: mappingSubjectId, version_no: 1, status: 'APPROVED', revision: 2, submitted_by: actorId, submitted_at: now, approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now }).execute()
  await db.insertInto('dcl_acc_mapping_versions').values({
    approval_entry_id: mappingEntryId, book_id: book.id, vou_entity_id: 'sale-pricing',
    book_snapshot: JSON.stringify({ id: book.id, code: book.code, name: book.name }),
    vou_entity_snapshot: JSON.stringify({ id: 'sale-pricing', code: 'sale-pricing', name: '销售定价' }),
    default_result: 'POST', mapping_definition: JSON.stringify({ defaultTemplateId: 'default', rules: [], templates: [{ templateId: 'default', collection: null, lines: [
      { subjectSource: 'FIXED', subjectValue: inventorySubjectId, direction: 'DEBIT', amountField: 'amount', currencyField: 'currency', dimensions: {}, quantityField: 'quantity' },
      { subjectSource: 'FIXED', subjectValue: offsetSubjectId, direction: 'CREDIT', amountField: 'amount', currencyField: 'currency', dimensions: {}, quantityField: null },
    ] }] }),
  }).execute()
  await assert.rejects(
    db.transaction().execute((tx) => service.apply(tx, {
      kind: 'acc', action: 'approve', entity: 'sale-pricing', documentId, documentNo: 'SPR-TEST', approvalEntryId: vouEntryId,
      approvalRevision: '1', occurredAt: now.toISOString(), payload: { businessDate: '2026-09-04', currency: 'CNY', amount: '10.00', quantity: '1' } as unknown as import('@zerp/model').VouPayload,
    })),
    (error: unknown) => error instanceof Error && error.message === 'acc_inventory_dimension_required',
  )
  assert.equal((await db.selectFrom('acc_inventory_entries').select('id').where('vou_approval_entry_id', '=', vouEntryId).execute()).length, 0)
})

test('ACC records global asset effects for UN_POST and rejects control-book backdated negative inventory', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const service = new AccService(db)
  const actorId = ulid(), bookId = ulid(), inventorySubjectId = ulid(), offsetSubjectId = ulid()
  const openingId = ulid(), mappingSubjectId = ulid(), mappingEntryId = ulid()
  const assetDocumentId = ulid(), assetEntryId = ulid(), assetSaleDocumentId = ulid(), assetSaleEntryId = ulid(), inboundDocumentId = ulid(), inboundEntryId = ulid(), outboundDocumentId = ulid(), outboundEntryId = ulid()
  const ids = [assetEntryId, assetSaleEntryId, inboundEntryId, outboundEntryId]
  context.after(async () => {
    try {
      await db.deleteFrom('acc_inventory_entries').where('vou_approval_entry_id', 'in', ids).execute()
      await db.deleteFrom('acc_journal_entries').where('vou_approval_entry_id', 'in', ids).execute()
      await db.deleteFrom('acc_register_entries').where('vou_approval_entry_id', 'in', ids).execute()
      await sql`DELETE FROM acc_asset_book_values WHERE acquisition_vou_approval_entry_id = ${assetEntryId}`.execute(db)
      await sql`DELETE FROM acc_asset_registers WHERE acquisition_vou_approval_entry_id = ${assetEntryId}`.execute(db)
      await db.deleteFrom('approval_events').where('entry_id', 'in', [openingId, mappingEntryId, ...ids]).execute()
      await db.deleteFrom('approval_entries').where('id', 'in', [openingId, mappingEntryId, ...ids]).execute()
      await db.deleteFrom('vou_documents').where('id', 'in', [assetDocumentId, assetSaleDocumentId, inboundDocumentId, outboundDocumentId]).execute()
      await db.deleteFrom('dcl_subjects').where('id', '=', mappingSubjectId).execute()
      await db.deleteFrom('acc_subjects').where('book_id', '=', bookId).execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db.deleteFrom('app_users').where('id', '=', actorId).execute()
    } finally { await db.destroy() }
  })
  const actor = { id: actorId, permissions: [] as string[], trusted: true }
  const now = new Date()
  await db.insertInto('app_users').values({ id: actorId, username: `acc-effects-${actorId}`, display_name: 'ACC effects actor', password_hash: 'unused', status: 'ENABLED', password_changed_at: now, password_change_required: false }).execute()
  const book = await service.createBook({ id: bookId, name: '控制库存账簿', description: '', startMonth: '2026-08', baseCurrency: 'CNY' }, actor)
  await service.createSubject({ id: inventorySubjectId, bookId, code: '1405', name: '库存商品', parentId: null, balanceDirection: 'DEBIT', enabled: true, requiredDimensions: [], inventoryQuantity: true, settlementPurpose: 'NONE' }, actor)
  await service.createSubject({ id: offsetSubjectId, bookId, code: '6001', name: '库存对方', parentId: null, balanceDirection: 'CREDIT', enabled: true, requiredDimensions: [], inventoryQuantity: false, settlementPurpose: 'NONE' }, actor)
  await db.insertInto('approval_entries').values({ id: openingId, domain: 'acc', entity: 'opening', subject_id: bookId, version_no: null, status: 'APPROVED', revision: 1, submitted_by: actorId, submitted_at: now, approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now }).execute()
  await db.insertInto('dcl_subjects').values({ id: mappingSubjectId, entity: 'acc-mapping', code: null, created_at: now, created_by: actorId }).execute()
  await db.insertInto('approval_entries').values({ id: mappingEntryId, domain: 'dcl', entity: 'acc-mapping', subject_id: mappingSubjectId, version_no: 1, status: 'APPROVED', revision: 1, submitted_by: actorId, submitted_at: now, approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now }).execute()
  const mapping = (entity: string, definition: unknown, defaultResult: 'POST' | 'UN_POST') => db.insertInto('dcl_acc_mapping_versions').values({
    approval_entry_id: mappingEntryId, book_id: bookId, vou_entity_id: entity,
    book_snapshot: JSON.stringify({ id: bookId, code: book.code, name: book.name }),
    vou_entity_snapshot: JSON.stringify({ id: entity, code: entity, name: entity }),
    default_result: defaultResult, mapping_definition: JSON.stringify(definition),
  }).execute()
  await mapping('asset-acquisition', { defaultTemplateId: null, rules: [], templates: [] }, 'UN_POST')
  const createVou = async (documentId: string, entryId: string, entity: 'asset-acquisition' | 'asset-sale' | 'sale-pricing', documentNo: string) => {
    await db.insertInto('vou_documents').values({ id: documentId, entity, document_no: documentNo, created_at: now, created_by: actorId }).execute()
    await db.insertInto('approval_entries').values({ id: entryId, domain: 'vou', entity, subject_id: documentId, version_no: null, status: 'APPROVED', revision: 1, submitted_by: actorId, submitted_at: now, approved_by: actorId, approved_at: now, updated_by: actorId, updated_at: now }).execute()
  }
  await createVou(assetDocumentId, assetEntryId, 'asset-acquisition', 'ACQ-TEST')
  await db.transaction().execute((tx) => service.apply(tx, {
    kind: 'acc', action: 'approve', entity: 'asset-acquisition', documentId: assetDocumentId, documentNo: 'ACQ-TEST', approvalEntryId: assetEntryId, approvalRevision: '1', occurredAt: now.toISOString(),
    payload: { businessDate: '2026-09-04', currency: 'CNY', attachments: [], supplier: { objectId: ulid(), approvalEntryId: ulid(), selectionOrigin: 'CURRENT' }, assetAcquisitionLines: [{ assetName: 'UN_POST 资产', category: { objectId: ulid() }, originalValue: '100.00', usefulLifeMonths: 12, residualRate: '0.000000', department: { objectId: ulid() } }] },
  }))
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_asset_registers WHERE acquisition_vou_approval_entry_id = ${assetEntryId}`.execute(db)).rows[0]!.count, '1')
  assert.equal((await db.selectFrom('acc_journal_entries').select('id').where('vou_approval_entry_id', '=', assetEntryId).execute()).length, 0)
  const assetId = (await sql<{ id: string }>`SELECT id FROM acc_asset_registers WHERE acquisition_vou_approval_entry_id = ${assetEntryId}`.execute(db)).rows[0]!.id
  await db.updateTable('dcl_acc_mapping_versions').set({ vou_entity_id: 'asset-sale', vou_entity_snapshot: JSON.stringify({ id: 'asset-sale', code: 'asset-sale', name: 'asset-sale' }), default_result: 'UN_POST', mapping_definition: JSON.stringify({ defaultTemplateId: null, rules: [], templates: [] }) }).where('approval_entry_id', '=', mappingEntryId).execute()
  await createVou(assetSaleDocumentId, assetSaleEntryId, 'asset-sale', 'DSL-TEST')
  await db.transaction().execute((tx) => service.apply(tx, {
    kind: 'acc', action: 'approve', entity: 'asset-sale', documentId: assetSaleDocumentId, documentNo: 'DSL-TEST', approvalEntryId: assetSaleEntryId, approvalRevision: '1', occurredAt: now.toISOString(),
    payload: { businessDate: '2026-09-05', currency: 'CNY', attachments: [], customer: { objectId: ulid(), approvalEntryId: ulid(), selectionOrigin: 'CURRENT' }, assetSaleLines: [{ assetId, saleAmount: '120.00' }] },
  }))
  assert.equal((await sql<{ status: string }>`SELECT status FROM acc_asset_registers WHERE id = ${assetId}`.execute(db)).rows[0]!.status, 'SOLD')
  await assert.rejects(db.transaction().execute((tx) => service.apply(tx, {
    kind: 'acc', action: 'unapprove', entity: 'asset-acquisition', documentId: assetDocumentId, documentNo: 'ACQ-TEST', approvalEntryId: assetEntryId, approvalRevision: '1', occurredAt: now.toISOString(),
    payload: { businessDate: '2026-09-04', currency: 'CNY', attachments: [], supplier: { objectId: ulid(), approvalEntryId: ulid(), selectionOrigin: 'CURRENT' }, assetAcquisitionLines: [] },
  })), (error: unknown) => error instanceof AccApplicationError && error.errorKey === 'acc_register_unapprove_blocked')
  await db.transaction().execute((tx) => service.apply(tx, {
    kind: 'acc', action: 'unapprove', entity: 'asset-sale', documentId: assetSaleDocumentId, documentNo: 'DSL-TEST', approvalEntryId: assetSaleEntryId, approvalRevision: '1', occurredAt: now.toISOString(),
    payload: { businessDate: '2026-09-05', currency: 'CNY', attachments: [], customer: { objectId: ulid(), approvalEntryId: ulid(), selectionOrigin: 'CURRENT' }, assetSaleLines: [{ assetId, saleAmount: '120.00' }] },
  }))
  assert.equal((await sql<{ status: string }>`SELECT status FROM acc_asset_registers WHERE id = ${assetId}`.execute(db)).rows[0]!.status, 'ACTIVE')
  await db.transaction().execute((tx) => service.apply(tx, {
    kind: 'acc', action: 'unapprove', entity: 'asset-acquisition', documentId: assetDocumentId, documentNo: 'ACQ-TEST', approvalEntryId: assetEntryId, approvalRevision: '1', occurredAt: now.toISOString(),
    payload: { businessDate: '2026-09-04', currency: 'CNY', attachments: [], supplier: { objectId: ulid(), approvalEntryId: ulid(), selectionOrigin: 'CURRENT' }, assetAcquisitionLines: [] },
  }))
  assert.equal((await sql<{ count: string }>`SELECT count(*)::text AS count FROM acc_asset_registers WHERE id = ${assetId}`.execute(db)).rows[0]!.count, '0')
  await db.updateTable('dcl_acc_mapping_versions').set({ vou_entity_id: 'sale-pricing', vou_entity_snapshot: JSON.stringify({ id: 'sale-pricing', code: 'sale-pricing', name: 'sale-pricing' }), default_result: 'POST', mapping_definition: JSON.stringify({
    defaultTemplateId: 'inbound',
    rules: [{ conditions: [{ field: 'mode', operator: 'EQ', values: ['OUT'] }], result: 'POST', templateId: 'outbound' }],
    templates: [
      { templateId: 'inbound', collection: null, lines: [
        { subjectSource: 'FIXED', subjectValue: inventorySubjectId, direction: 'DEBIT', amountField: 'amount', currencyField: 'currency', dimensions: { WAREHOUSE: 'warehouse.objectId', PRODUCT: 'product.objectId' }, quantityField: 'quantity' },
        { subjectSource: 'FIXED', subjectValue: offsetSubjectId, direction: 'CREDIT', amountField: 'amount', currencyField: 'currency', dimensions: {}, quantityField: null },
      ] },
      { templateId: 'outbound', collection: null, lines: [
        { subjectSource: 'FIXED', subjectValue: inventorySubjectId, direction: 'CREDIT', amountField: 'amount', currencyField: 'currency', dimensions: { WAREHOUSE: 'warehouse.objectId', PRODUCT: 'product.objectId' }, quantityField: 'quantity' },
        { subjectSource: 'FIXED', subjectValue: offsetSubjectId, direction: 'DEBIT', amountField: 'amount', currencyField: 'currency', dimensions: {}, quantityField: null },
      ] },
    ],
  }) }).where('approval_entry_id', '=', mappingEntryId).execute()
  const warehouseId = ulid(), productId = ulid()
  await createVou(inboundDocumentId, inboundEntryId, 'sale-pricing', 'SPR-IN')
  await db.transaction().execute((tx) => service.apply(tx, {
    kind: 'acc', action: 'approve', entity: 'sale-pricing', documentId: inboundDocumentId, documentNo: 'SPR-IN', approvalEntryId: inboundEntryId, approvalRevision: '1', occurredAt: now.toISOString(),
    payload: { businessDate: '2026-09-05', currency: 'CNY', attachments: [], amount: '10.00', quantity: '10.000000', warehouse: { objectId: warehouseId }, product: { objectId: productId } } as unknown as import('@zerp/model').VouPayload,
  }))
  assert.equal((await db.selectFrom('acc_inventory_entries').select('id').where('vou_approval_entry_id', '=', inboundEntryId).execute()).length, 1)
  await createVou(outboundDocumentId, outboundEntryId, 'sale-pricing', 'SPR-OUT')
  await assert.rejects(db.transaction().execute((tx) => service.apply(tx, {
    kind: 'acc', action: 'approve', entity: 'sale-pricing', documentId: outboundDocumentId, documentNo: 'SPR-OUT', approvalEntryId: outboundEntryId, approvalRevision: '1', occurredAt: now.toISOString(),
    payload: { businessDate: '2026-09-04', currency: 'CNY', attachments: [], mode: 'OUT', amount: '10.00', quantity: '10.000000', warehouse: { objectId: warehouseId }, product: { objectId: productId } } as unknown as import('@zerp/model').VouPayload,
  })), (error: unknown) => error instanceof AccApplicationError && error.errorKey === 'acc_negative_inventory')
  assert.equal((await db.selectFrom('acc_inventory_entries').select('id').where('vou_approval_entry_id', '=', outboundEntryId).execute()).length, 0)
})

test('ACC records and exactly reverses sale-signoff empty-container deltas without JSON fallback', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const service = new AccService(db)
  const actorId = ulid(), bookId = ulid(), openingId = ulid()
  const mappingSubjectId = ulid(), mappingEntryId = ulid()
  const customerId = ulid(), customerApprovalEntryId = ulid(), customerSubunitId = ulid()
  const documentId = ulid(), approvalEntryId = ulid()
  const actor = { id: actorId, permissions: [] as string[], trusted: true }
  const now = new Date()
  context.after(async () => {
    try {
      await sql`DELETE FROM acc_container_entries WHERE vou_approval_entry_id = ${approvalEntryId}`.execute(db)
      await db.deleteFrom('approval_events').where('entry_id', 'in', [openingId, mappingEntryId, approvalEntryId, customerApprovalEntryId]).execute()
      await db.deleteFrom('approval_entries').where('id', 'in', [openingId, mappingEntryId, approvalEntryId, customerApprovalEntryId]).execute()
      await db.deleteFrom('vou_documents').where('id', '=', documentId).execute()
      await db.deleteFrom('dcl_subjects').where('id', 'in', [mappingSubjectId, customerId]).execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db.deleteFrom('app_users').where('id', '=', actorId).execute()
    } finally {
      await db.destroy()
    }
  })
  await db.insertInto('app_users').values({
    id: actorId,
    username: `acc-container-${actorId}`,
    display_name: 'ACC container actor',
    password_hash: 'unused',
    status: 'ENABLED',
    password_changed_at: now,
    password_change_required: false,
  }).execute()
  const book = await service.createBook({
    id: bookId,
    name: '空桶控制账簿',
    description: '',
    startMonth: '2026-08',
    baseCurrency: 'CNY',
  }, actor)
  await db.insertInto('approval_entries').values({
    id: openingId,
    domain: 'acc',
    entity: 'opening',
    subject_id: book.id,
    version_no: null,
    status: 'APPROVED',
    revision: 1,
    submitted_by: actorId,
    submitted_at: now,
    approved_by: actorId,
    approved_at: now,
    updated_by: actorId,
    updated_at: now,
  }).execute()
  await db.insertInto('dcl_subjects').values([
    { id: mappingSubjectId, entity: 'acc-mapping', code: null, created_at: now, created_by: actorId },
    { id: customerId, entity: 'customer', code: 'CUS-0001', created_at: now, created_by: actorId },
  ]).execute()
  await db.insertInto('approval_entries').values([
    {
      id: mappingEntryId,
      domain: 'dcl',
      entity: 'acc-mapping',
      subject_id: mappingSubjectId,
      version_no: 1,
      status: 'APPROVED',
      revision: 1,
      submitted_by: actorId,
      submitted_at: now,
      approved_by: actorId,
      approved_at: now,
      updated_by: actorId,
      updated_at: now,
    },
    {
      id: customerApprovalEntryId,
      domain: 'dcl',
      entity: 'customer',
      subject_id: customerId,
      version_no: 1,
      status: 'APPROVED',
      revision: 1,
      submitted_by: actorId,
      submitted_at: now,
      approved_by: actorId,
      approved_at: now,
      updated_by: actorId,
      updated_at: now,
    },
  ]).execute()
  await db.insertInto('dcl_customer_subunit_roots').values({
    subunit_id: customerSubunitId,
    customer_id: customerId,
    code: 'SUB-0001',
  }).execute()
  await db.insertInto('dcl_customer_version_subunits').values({
    customer_approval_entry_id: customerApprovalEntryId,
    subunit_id: customerSubunitId,
    name: '空桶客户子单位',
    enabled: true,
  }).execute()
  await db.insertInto('dcl_acc_mapping_versions').values({
    approval_entry_id: mappingEntryId,
    book_id: book.id,
    vou_entity_id: 'sale-signoff',
    book_snapshot: JSON.stringify({ id: book.id, code: book.code, name: book.name }),
    vou_entity_snapshot: JSON.stringify({ id: 'sale-signoff', code: 'sale-signoff', name: '销售签收' }),
    default_result: 'UN_POST',
    mapping_definition: JSON.stringify({ defaultTemplateId: null, rules: [], templates: [] }),
  }).execute()
  await db.insertInto('vou_documents').values({
    id: documentId,
    entity: 'sale-signoff',
    document_no: 'SSF-CONTAINER',
    created_at: now,
    created_by: actorId,
  }).execute()
  await db.insertInto('approval_entries').values({
    id: approvalEntryId,
    domain: 'vou',
    entity: 'sale-signoff',
    subject_id: documentId,
    version_no: null,
    status: 'APPROVED',
    revision: 7,
    submitted_by: actorId,
    submitted_at: now,
    approved_by: actorId,
    approved_at: now,
    updated_by: actorId,
    updated_at: now,
  }).execute()
  const plan = {
    kind: 'acc' as const,
    action: 'approve' as const,
    entity: 'sale-signoff' as const,
    documentId,
    documentNo: 'SSF-CONTAINER',
    approvalEntryId,
    approvalRevision: '7',
    occurredAt: now.toISOString(),
    payload: {
      businessDate: '2026-09-04',
      currency: 'CNY',
      attachments: [],
      customerSubunit: {
        objectId: customerSubunitId,
        approvalEntryId: customerApprovalEntryId,
        selectionOrigin: 'CURRENT' as const,
      },
      expectedSolventContainers: 5,
      expectedResinContainers: 3,
      returnedSolventContainers: 2,
      returnedResinContainers: 4,
      signoffLines: [{
        sourceLineId: 'sale-line-1',
        signedBaseQuantity: '1.000000',
        rejectedBaseQuantity: '0.000000',
      }],
    } satisfies VouPayloadFor<'sale-signoff'>,
  }
  await db.transaction().execute((tx) => service.apply(tx, plan))
  await db.transaction().execute((tx) => service.apply(tx, plan))
  const entries = await sql<{
    customer_subunit_id: string
    customer_id: string
    customer_approval_entry_id: string
    container_type: string
    quantity_delta: string
    source_document_id: string
    source_revision: string
  }>`
    SELECT customer_subunit_id, customer_id, customer_approval_entry_id,
      container_type, quantity_delta::text, source_document_id, source_revision::text
    FROM acc_container_entries
    WHERE vou_approval_entry_id = ${approvalEntryId}
    ORDER BY container_type
  `.execute(db)
  assert.deepEqual(entries.rows, [
    {
      customer_subunit_id: customerSubunitId,
      customer_id: customerId,
      customer_approval_entry_id: customerApprovalEntryId,
      container_type: 'RESIN',
      quantity_delta: '-1',
      source_document_id: documentId,
      source_revision: '7',
    },
    {
      customer_subunit_id: customerSubunitId,
      customer_id: customerId,
      customer_approval_entry_id: customerApprovalEntryId,
      container_type: 'SOLVENT',
      quantity_delta: '3',
      source_document_id: documentId,
      source_revision: '7',
    },
  ])
  await db.transaction().execute((tx) => service.apply(tx, { ...plan, action: 'unapprove' }))
  assert.equal(
    (
      await sql<{ count: string }>`
        SELECT count(*)::text AS count
        FROM acc_container_entries
        WHERE vou_approval_entry_id = ${approvalEntryId}
      `.execute(db)
    ).rows[0]!.count,
    '0',
  )
})
