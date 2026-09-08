import { VouOpeningService } from '../../src/vou/opening-service.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { createDatabase } from '../../src/db/database.ts'
import { AccService } from '../../src/acc/service.ts'
import {
  AccMappingCatalogService,
  type AccMappingDefinition,
} from '../../src/acc/mapping-catalog.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('ACC saves one current identity, enforces book scope and CAS, and rolls back invalid mapping changes', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const actorId = ulid(),
    outsiderId = ulid(),
    bookId = ulid()
  const actor = {
    id: actorId,
    permissions: ['query', 'get', 'catalog', 'save'].map(
      (action) => `/acc/mapping/${action}`,
    ),
  }
  const trusted = { ...actor, trusted: true }
  context.after(async () => {
    try {
      await sql`DELETE FROM acc_mappings WHERE book_id=${bookId}`.execute(db)
      await db
        .deleteFrom('acc_subjects')
        .where('book_id', '=', bookId)
        .execute()
      await db
        .deleteFrom('vou_idempotency')
        .where('entity', '=', 'opening')
        .where('document_id', '=', bookId)
        .execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db
        .deleteFrom('app_audit_events')
        .where('actor_user_id', 'in', [actorId, outsiderId])
        .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [actorId, outsiderId])
        .execute()
    } finally {
      await db.destroy()
    }
  })
  for (const id of [actorId, outsiderId])
    await db
      .insertInto('app_users')
      .values({
        id,
        username: `mapping-${id}`,
        display_name: '映射测试',
        py: 'yingsheceshi',
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      })
      .execute()
  const acc = new AccService(db)
  await acc.createBook(
    {
      id: bookId,
      name: '当前映射测试',
      description: '',
      startMonth: '2098-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    trusted,
  )
  const definition: AccMappingDefinition = {
    defaultTemplateId: null,
    rules: [],
    templates: [],
    assetConfiguration: null,
  }
  const input = {
    bookId,
    vouEntity: 'sale-order',
    expectedRevision: null,
    defaultResult: 'UN_POST' as const,
    definition,
  }
  const mapping = new AccMappingCatalogService(db)
  await assert.rejects(
    mapping.save(input, {
      ...actor,
      permissions: ['/dcl/acc-mapping/approve'],
    }),
    /forbidden/,
  )
  await assert.rejects(
    mapping.save(input, { ...actor, id: outsiderId }),
    /acc_book_access_denied/,
  )
  const saved = await mapping.save(input, actor)
  assert.equal(saved.revision, '1')
  assert.equal('approvalEntryId' in saved, false)
  assert.equal(
    (await mapping.query({ bookId, page: 1, pageSize: 20 }, actor)).total,
    1,
  )
  await assert.rejects(
    mapping.get(bookId, 'sale-order', { ...actor, id: outsiderId }),
    /acc_book_access_denied/,
  )
  assert.equal(
    (await mapping.catalog({ ...actor, id: outsiderId })).books.some(
      (book) => book.id === bookId,
    ),
    false,
  )
  await assert.rejects(
    mapping.save(
      { ...input, expectedRevision: '1', defaultResult: 'POST' },
      actor,
    ),
    /acc_mapping_invalid_data/,
  )
  assert.deepEqual(await mapping.get(bookId, 'sale-order', actor), saved)
  const results = await Promise.allSettled([
    mapping.save({ ...input, expectedRevision: '1' }, actor),
    mapping.save({ ...input, expectedRevision: '1' }, actor),
  ])
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  assert.match(
    String(
      (
        results.find(
          (result) => result.status === 'rejected',
        ) as PromiseRejectedResult
      ).reason,
    ),
    /acc_mapping_stale_revision/,
  )
  const current = await mapping.get(bookId, 'sale-order', actor)
  assert.equal(current.subjectId, saved.subjectId)
  assert.equal(current.revision, '2')
  const entries = await db
    .selectFrom('approval_entries')
    .select('id')
    .where('subject_id', '=', saved.subjectId)
    .execute()
  assert.deepEqual(entries, [])
  const audit = await db
    .selectFrom('app_audit_events')
    .select('id')
    .where('target_id', '=', saved.subjectId)
    .execute()
  assert.equal(audit.length, 2)
})

test('VOU approval uses saved mapping while historical postings keep their adopted revision and amounts', async (context) => {
  assert.ok(databaseUrl)
  const { VouService } = await import('../../src/vou/service.ts')
  const db = createDatabase(databaseUrl)
  const actorId = ulid(),
    reviewerId = ulid(),
    bookId = ulid(),
    productId = ulid(),
    productEntryId = ulid()
  const actor = {
    id: actorId,
    permissions: ['/acc/mapping/save', '/acc/mapping/get'],
    trusted: true,
  }
  const reviewer = { id: reviewerId, permissions: [], trusted: true }
  const documentIds: string[] = [],
    submissionIds: string[] = [productEntryId]
  context.after(async () => {
    try {
      await db
        .deleteFrom('acc_journal_entries')
        .where('book_id', '=', bookId)
        .execute()
      await db
        .deleteFrom('acc_mappings')
        .where('book_id', '=', bookId)
        .execute()
      await db
        .deleteFrom('approval_events')
        .where('entry_id', 'in', submissionIds)
        .execute()
      await db
        .deleteFrom('vou_reference_snapshots')
        .where('approval_entry_id', 'in', submissionIds)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', submissionIds)
        .execute()
      if (documentIds.length) {
        await db
          .deleteFrom('vou_idempotency')
          .where('document_id', 'in', documentIds)
          .execute()
        await db
          .deleteFrom('vou_documents')
          .where('id', 'in', documentIds)
          .execute()
      }
      await db.deleteFrom('bob_subjects').where('id', '=', productId).execute()
      await db
        .deleteFrom('acc_subjects')
        .where('book_id', '=', bookId)
        .execute()
      await db
        .deleteFrom('vou_idempotency')
        .where('entity', '=', 'opening')
        .where('document_id', '=', bookId)
        .execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db
        .deleteFrom('app_audit_events')
        .where('actor_user_id', 'in', [actorId, reviewerId])
        .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [actorId, reviewerId])
        .execute()
    } finally {
      await db.destroy()
    }
  })
  const now = new Date()
  for (const id of [actorId, reviewerId])
    await db
      .insertInto('app_users')
      .values({
        id,
        username: `mapping-post-${id}`,
        display_name: '记账测试',
        py: 'jizhangceshi',
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: now,
        password_change_required: false,
      })
      .execute()
  // Already-approved product is a fixture; all actions under test use public domain services.
  await db
    .insertInto('bob_subjects')
    .values({
      id: productId,
      entity: 'product',
      code: `M399-${productId}`,
      created_at: now,
      created_by: actorId,
    })
    .execute()
  await db
    .insertInto('approval_entries')
    .values({
      id: productEntryId,
      domain: 'bob',
      entity: 'product',
      subject_id: productId,
      version_no: 1,
      status: 'APPROVED',
      revision: 1,
      submitted_by: actorId,
      submitted_at: now,
      approved_by: reviewerId,
      approved_at: now,
      updated_by: reviewerId,
      updated_at: now,
    })
    .execute()
  await db
    .insertInto('bob_product_versions')
    .values({
      approval_entry_id: productEntryId,
      name: '映射测试产品',
      source_snapshots: {},
      unit_conversions: JSON.stringify([]),
      recyclable: false,
    })
    .execute()
  const acc = new AccService(db)
  const openingService = new VouOpeningService(db, acc)
  await acc.createBook(
    {
      id: bookId,
      name: '映射记账对照',
      description: '',
      startMonth: '2098-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    actor,
  )
  const debit = await acc.createSubject(
    {
      id: ulid(),
      bookId,
      code: '1001',
      name: '测试借方',
      parentId: null,
      balanceDirection: 'DEBIT',
      enabled: true,
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    },
    actor,
  )
  const credit = await acc.createSubject(
    {
      ...debit,
      id: ulid(),
      code: '2001',
      name: '测试贷方',
      balanceDirection: 'CREDIT',
    },
    actor,
  )
  const openingId = ulid()
  submissionIds.push(openingId)
  const opening = await openingService.submitOpening(
    {
      bookId,
      submissionId: openingId,
      idempotencyKey: openingId,
      lines: [],
      assets: [],
      bills: [],
      containers: [],
    },
    actor,
    'mapping-opening',
  )
  await openingService.reviewOpening(
    'approve',
    {
      bookId,
      submissionId: openingId,
      expectedRevision: opening.approval.revision,
    },
    reviewer,
    'mapping-opening-approve',
  )
  const mappings = new AccMappingCatalogService(db)
  const definition: AccMappingDefinition = {
    defaultTemplateId: '销售',
    rules: [],
    templates: [
      {
        templateId: '销售',
        collection: 'priceLines',
        lines: [
          {
            subjectSource: 'FIXED',
            subjectValue: debit.id,
            direction: 'DEBIT',
            amountField: 'line.unitPrice',
            currencyField: 'currency',
            dimensions: {},
            quantityField: null,
            costCounterpartSubjectId: null,
            costCounterpartDimensions: {},
          },
          {
            subjectSource: 'FIXED',
            subjectValue: credit.id,
            direction: 'CREDIT',
            amountField: 'line.unitPrice',
            currencyField: 'currency',
            dimensions: {},
            quantityField: null,
            costCounterpartSubjectId: null,
            costCounterpartDimensions: {},
          },
        ],
      },
    ],
    assetConfiguration: null,
  }
  const input = {
    bookId,
    vouEntity: 'sale-pricing',
    expectedRevision: null,
    defaultResult: 'POST' as const,
    definition,
  }
  const saved = await mappings.save(input, actor)
  // Referenced subjects cannot be renamed or deleted, including before any posting exists.
  await assert.rejects(
    acc.saveSubject(
      { ...debit, name: 'changed', expectedRevision: debit.revision },
      actor,
    ),
    /acc_subject_frozen/,
  )
  await assert.rejects(
    acc.deleteSubject(debit.id, debit.revision, actor),
    /acc_subject_delete_blocked/,
  )
  await assert.rejects(
    acc.createSubject(
      { ...debit, id: ulid(), code: '100101', parentId: debit.id },
      actor,
    ),
    /acc_subject_frozen/,
  )
  const vou = new VouService(db, { acc, wfl: { async apply() {} } })
  async function submit(amount: string, service = vou) {
    const documentId = ulid(),
      submissionId = ulid()
    documentIds.push(documentId)
    submissionIds.push(submissionId)
    const pending = await service.submit(
      'sale-pricing',
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          businessDate: '2098-01-02',
          currency: 'CNY',
          priceLines: [
            {
              product: {
                objectId: productId,
                approvalEntryId: productEntryId,
                selectionOrigin: 'CURRENT',
              },
              unitPrice: amount,
            },
          ],
          attachments: [],
        },
      },
      actor,
      'mapping-submit',
    )
    return { documentId, submissionId, expectedRevision: pending.revision }
  }
  const first = await submit('10.00')
  await vou.review(
    'sale-pricing',
    'approve',
    first,
    reviewer,
    'mapping-approve',
  )
  const firstFacts = await sql<{
    mapping_id: string
    mapping_revision: string
    amount: string
    direction: string
  }>`SELECT e.mapping_id,e.mapping_revision::text,l.amount::text,l.direction FROM acc_journal_entries e JOIN acc_journal_lines l ON l.journal_entry_id=e.id WHERE e.vou_approval_entry_id=${first.submissionId} ORDER BY l.direction`.execute(
    db,
  )
  assert.deepEqual(firstFacts.rows, [
    {
      mapping_id: saved.subjectId,
      mapping_revision: '1',
      amount: '10.00000000',
      direction: 'CREDIT',
    },
    {
      mapping_id: saved.subjectId,
      mapping_revision: '1',
      amount: '10.00000000',
      direction: 'DEBIT',
    },
  ])
  const changed = await mappings.save(
    {
      ...input,
      expectedRevision: '1',
      defaultResult: 'UN_POST',
      definition: { ...definition, defaultTemplateId: null },
    },
    actor,
  )
  assert.equal(changed.subjectId, saved.subjectId)
  const second = await submit('20.00')
  await vou.review(
    'sale-pricing',
    'approve',
    second,
    reviewer,
    'mapping-approve-current',
  )
  assert.equal(
    (
      await db
        .selectFrom('acc_journal_entries')
        .select('id')
        .where('vou_approval_entry_id', '=', second.submissionId)
        .execute()
    ).length,
    0,
  )
  const after = await sql<{
    mapping_id: string
    mapping_revision: string
    amount: string
    direction: string
  }>`SELECT e.mapping_id,e.mapping_revision::text,l.amount::text,l.direction FROM acc_journal_entries e JOIN acc_journal_lines l ON l.journal_entry_id=e.id WHERE e.vou_approval_entry_id=${first.submissionId} ORDER BY l.direction`.execute(
    db,
  )
  assert.deepEqual(after.rows, firstFacts.rows)
  await mappings.save({ ...input, expectedRevision: '2' }, actor)
  const failing = new VouService(db, {
    acc,
    wfl: {
      async apply() {
        throw new Error('forced downstream failure')
      },
    },
  })
  const third = await submit('30.00', failing)
  await assert.rejects(
    failing.review(
      'sale-pricing',
      'approve',
      third,
      reviewer,
      'mapping-rollback',
    ),
    /forced downstream failure/,
  )
  assert.equal(
    (await vou.get('sale-pricing', third.documentId, reviewer)).status,
    'PENDING',
  )
  assert.equal(
    (
      await db
        .selectFrom('acc_journal_entries')
        .select('id')
        .where('vou_approval_entry_id', '=', third.submissionId)
        .execute()
    ).length,
    0,
  )
})
