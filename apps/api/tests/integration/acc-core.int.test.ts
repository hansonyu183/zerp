import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'

import { createDatabase } from '../../src/db/database.ts'
import { AccService } from '../../src/acc/service.ts'
import { VouService } from '../../src/vou/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('ACC book, subjects, Opening and periods keep one transactional fact boundary', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const service = new AccService(db)
  const vou = new VouService(db, { acc: service })
  const submitterId = ulid(), reviewerId = ulid()
  const submitter = { id: submitterId, permissions: [] as string[], trusted: true }
  const reviewer = { id: reviewerId, permissions: [] as string[], trusted: true }
  context.after(async () => {
    try {
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
      await db.deleteFrom('acc_subjects').execute()
      await db.deleteFrom('acc_books').execute()
      await db.deleteFrom('app_users').where('id', 'in', [submitterId, reviewerId]).execute()
    } finally { await db.destroy() }
  })
  await db.insertInto('app_users').values([submitterId, reviewerId].map((id) => ({
    id, username: `acc-${id}`, display_name: 'ACC actor', password_hash: 'unused',
    status: 'ENABLED' as const, password_changed_at: new Date(), password_change_required: false,
  }))).execute()

  const book = await service.createBook({
    id: ulid(), name: '业务控制账簿', description: '', startMonth: '2026-01', baseCurrency: 'CNY',
  }, submitter)
  assert.equal(book.code, 'ACC-0001')
  assert.equal(book.controlBook, true)
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
    ], assets: [], bills: [], containers: [],
  }, submitter, 'opening-submit')
  assert.equal(pending.status, 'PENDING')
  const approved = await service.reviewOpening('approve', {
    bookId: book.id, submissionId, expectedRevision: pending.revision,
  }, reviewer, 'opening-approve')
  assert.equal(approved.status, 'APPROVED')
  const mappingSubjectId = ulid(), mappingEntryId = ulid(), now = new Date()
  await db.insertInto('dcl_subjects').values({ id: mappingSubjectId, entity: 'acc-mapping', code: null, created_at: now, created_by: reviewerId }).execute()
  await db.insertInto('approval_entries').values({
    id: mappingEntryId, domain: 'dcl', entity: 'acc-mapping', subject_id: mappingSubjectId,
    version_no: 1, status: 'APPROVED', revision: 2, submitted_by: submitterId,
    submitted_at: now, approved_by: reviewerId, approved_at: now, updated_by: reviewerId, updated_at: now,
  }).execute()
  await db.insertInto('dcl_acc_mapping_versions').values({
    approval_entry_id: mappingEntryId, book_id: book.id, vou_entity_id: 'sale-pricing',
    book_snapshot: JSON.stringify({ id: book.id, code: book.code, name: book.name }),
    vou_entity_snapshot: JSON.stringify({ id: 'sale-pricing', code: 'sale-pricing', name: '销售定价' }),
    default_result: 'POST', mapping_definition: JSON.stringify({
      defaultTemplateId: 'default', rules: [], templates: [{
        templateId: 'default', collection: null, lines: [
          { subjectSource: 'FIXED', subjectValue: debit.id, direction: 'DEBIT', amountField: 'amount', currencyField: 'currency', dimensions: {}, quantityField: null },
          { subjectSource: 'FIXED', subjectValue: credit.id, direction: 'CREDIT', amountField: 'amount', currencyField: 'currency', dimensions: {}, quantityField: null },
        ],
      }],
    }),
  }).execute()
  const documentId = ulid(), vouSubmissionId = ulid()
  const vouPending = await vou.submit('sale-pricing', 'submit-new', {
    documentId, submissionId: vouSubmissionId, idempotencyKey: vouSubmissionId,
    expectedRevision: null, payload: { businessDate: '2026-09-04', currency: 'CNY', amount: '25.00', lines: [], attachments: [] },
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
    expectedRevision: null, payload: { businessDate: '2026-09-04', currency: 'CNY', amount: '10.00', lines: [], attachments: [] },
  }, submitter, 'forced-submit')
  await assert.rejects(failingVou.review('sale-pricing', 'approve', {
    documentId: failedDocumentId, submissionId: failedSubmissionId, expectedRevision: failedPending.revision,
  }, reviewer, 'forced-approve'), /forced WFL failure/)
  assert.equal((await vou.get('sale-pricing', failedDocumentId, reviewer)).status, 'PENDING')
  assert.equal((await db.selectFrom('acc_journal_entries').select('id').where('vou_approval_entry_id', '=', failedSubmissionId).execute()).length, 0)
  const concurrentDocumentId = ulid(), concurrentSubmissionId = ulid()
  const concurrentPending = await vou.submit('sale-pricing', 'submit-new', {
    documentId: concurrentDocumentId, submissionId: concurrentSubmissionId, idempotencyKey: concurrentSubmissionId,
    expectedRevision: null, payload: { businessDate: '2026-09-04', currency: 'CNY', amount: '12.00', lines: [], attachments: [] },
  }, submitter, 'concurrent-submit')
  const attempts = await Promise.allSettled([
    vou.review('sale-pricing', 'approve', { documentId: concurrentDocumentId, submissionId: concurrentSubmissionId, expectedRevision: concurrentPending.revision }, reviewer, 'concurrent-1'),
    vou.review('sale-pricing', 'approve', { documentId: concurrentDocumentId, submissionId: concurrentSubmissionId, expectedRevision: concurrentPending.revision }, reviewer, 'concurrent-2'),
  ])
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal((await db.selectFrom('acc_journal_entries').select('id').where('vou_approval_entry_id', '=', concurrentSubmissionId).execute()).length, 1)
  const period = await service.setPeriod({ bookId: book.id, month: '2026-09', expectedRevision: null }, true, reviewer)
  assert.equal(period.locked, true)
  const unlocked = await service.setPeriod({ bookId: book.id, month: '2026-09', expectedRevision: period.revision }, false, reviewer)
  assert.equal(unlocked.locked, false)
})
