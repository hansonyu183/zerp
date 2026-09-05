import assert from 'node:assert/strict'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import type { VouPayload } from '@zerp/model'

import { AccService } from '../../src/acc/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { VouApplicationError, VouService } from '../../src/vou/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const customerTypeId = '01J00000000000000000000104'

test('control-book funds, settlement, credit, and concurrent approval use one PostgreSQL service boundary', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const acc = new AccService(db)
  const vou = new VouService(db, { acc, wfl: { async apply() {} } })
  const actorId = ulid(),
    reviewerId = ulid(),
    customerId = ulid(),
    customerEntryId = ulid()
  const subunitId = ulid(),
    productId = ulid(),
    productEntryId = ulid(),
    warehouseId = ulid(),
    warehouseEntryId = ulid()
  const operatingEntityId = ulid(),
    operatingEntityEntryId = ulid()
  const mappingId = ulid(),
    mappingEntryId = ulid()
  const fundMappingId = ulid(),
    fundMappingEntryId = ulid()
  const bookId = ulid()
  const actor = { id: actorId, trusted: true, permissions: [] as string[] }
  const reviewer = {
    id: reviewerId,
    trusted: true,
    permissions: ['/vou/sale-order/approve-over-credit-limit'],
  }
  const ids: string[] = []
  context.after(async () => {
    try {
      await db
        .deleteFrom('approval_events')
        .where('actor_id', 'in', [actorId, reviewerId])
        .execute()
      await db
        .deleteFrom('vou_idempotency')
        .where('document_id', 'in', ids)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('domain', '=', 'vou')
        .where('submitted_by', '=', actorId)
        .execute()
      await db
        .deleteFrom('vou_documents')
        .where('created_by', '=', actorId)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [
          mappingEntryId,
          fundMappingEntryId,
          customerEntryId,
          productEntryId,
          warehouseEntryId,
          operatingEntityEntryId,
        ])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', [
          mappingId,
          fundMappingId,
          customerId,
          productId,
          warehouseId,
          operatingEntityId,
        ])
        .execute()
      await db
        .deleteFrom('approval_events')
        .where('domain', '=', 'acc')
        .where('subject_id', '=', bookId)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('domain', '=', 'acc')
        .where('subject_id', '=', bookId)
        .execute()
      await db
        .deleteFrom('acc_subjects')
        .where('book_id', '=', bookId)
        .execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [actorId, reviewerId])
        .execute()
    } finally {
      await db.destroy()
    }
  })
  const now = new Date()
  const code = String(
    Number.parseInt(customerId.slice(-4), 36) % 10_000,
  ).padStart(4, '0')
  await db
    .insertInto('app_users')
    .values(
      [actorId, reviewerId].map((id) => ({
        id,
        username: `vou-control-${id}`,
        display_name: 'VOU control',
        password_hash: 'unused',
        status: 'ENABLED' as const,
        password_changed_at: now,
        password_change_required: false,
      })),
    )
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values([
      {
        id: customerId,
        entity: 'customer',
        code: `CUS-${code}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: productId,
        entity: 'product',
        code: `PRD-${code}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: warehouseId,
        entity: 'warehouse',
        code: `WHS-${code}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: operatingEntityId,
        entity: 'operating-entity',
        code: `OPE-${code}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: mappingId,
        entity: 'acc-mapping',
        code: null,
        created_at: now,
        created_by: actorId,
      },
      {
        id: fundMappingId,
        entity: 'acc-mapping',
        code: null,
        created_at: now,
        created_by: actorId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      {
        id: customerEntryId,
        domain: 'dcl',
        entity: 'customer',
        subject_id: customerId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        updated_by: reviewerId,
        updated_at: now,
      },
      {
        id: productEntryId,
        domain: 'dcl',
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
      },
      {
        id: warehouseEntryId,
        domain: 'dcl',
        entity: 'warehouse',
        subject_id: warehouseId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        updated_by: reviewerId,
        updated_at: now,
      },
      {
        id: operatingEntityEntryId,
        domain: 'dcl',
        entity: 'operating-entity',
        subject_id: operatingEntityId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        updated_by: reviewerId,
        updated_at: now,
      },
      {
        id: mappingEntryId,
        domain: 'dcl',
        entity: 'acc-mapping',
        subject_id: mappingId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        updated_by: reviewerId,
        updated_at: now,
      },
      {
        id: fundMappingEntryId,
        domain: 'dcl',
        entity: 'acc-mapping',
        subject_id: fundMappingId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        updated_by: reviewerId,
        updated_at: now,
      },
    ])
    .execute()
  await db
    .insertInto('dcl_customer_versions')
    .values({
      approval_entry_id: customerEntryId,
      kind: 'OTHER',
      display_name: '控制客户',
      remittance_profiles: JSON.stringify([]),
      tax_attachments: JSON.stringify([]),
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_customer_subunit_roots')
    .values({ subunit_id: subunitId, customer_id: customerId, code: 'CONTROL' })
    .execute()
  await db
    .insertInto('dcl_customer_version_subunits')
    .values({
      customer_approval_entry_id: customerEntryId,
      subunit_id: subunitId,
      name: '控制子单位',
      customer_type_id: customerTypeId,
      customer_type_snapshot: JSON.stringify({
        id: customerTypeId,
        code: 'CUSTOMER-TYPE-TEST',
        name: '测试客户类型',
      }),
      settlement_snapshot: JSON.stringify({
        termCode: 'PREPAID',
        ruleType: 'RELATIVE_DAYS',
        monthOffset: 0,
        dayOfMonth: 0,
        dayOffset: 0,
      }),
      credit_limits: JSON.stringify([{ currency: 'CNY', amount: '1.00' }]),
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_product_versions')
    .values({
      approval_entry_id: productEntryId,
      name: '控制产品',
      source_snapshots: JSON.stringify({}),
      unit_conversions: JSON.stringify([]),
      recyclable: false,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_warehouse_versions')
    .values({
      approval_entry_id: warehouseEntryId,
      name: '控制仓库',
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_operating_entity_versions')
    .values({
      approval_entry_id: operatingEntityEntryId,
      legal_name: '控制经营主体',
      short_name: '控制经营主体',
      legal_identifier: `OPE-${code}`,
      registered_address: '',
      contact_name: '',
      contact_phone: '',
      invoice_title: '',
      invoice_address: '',
      invoice_phone: '',
      invoice_bank: '',
      invoice_account: '',
      remark: null,
      enabled: true,
    })
    .execute()
  const book = await acc.createBook(
    {
      id: bookId,
      name: '控制账簿',
      description: '',
      startMonth: '2026-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    actor,
  )
  const fundDebit = await acc.createSubject(
    {
      id: ulid(),
      bookId: book.id,
      code: '1001',
      name: '资金',
      parentId: null,
      balanceDirection: 'DEBIT',
      enabled: true,
      requiredDimensions: ['FUND_ACCOUNT'],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    },
    actor,
  )
  const equity = await acc.createSubject(
    {
      id: ulid(),
      bookId: book.id,
      code: '4001',
      name: '权益',
      parentId: null,
      balanceDirection: 'CREDIT',
      enabled: true,
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    },
    actor,
  )
  const openingId = ulid()
  const opening = await acc.submitOpening(
    {
      bookId: book.id,
      submissionId: openingId,
      idempotencyKey: openingId,
      lines: [],
      assets: [],
      bills: [],
      containers: [],
    },
    actor,
    'control-opening',
  )
  await acc.reviewOpening(
    'approve',
    {
      bookId: book.id,
      submissionId: openingId,
      expectedRevision: opening.approval.revision,
    },
    reviewer,
    'control-opening-approve',
  )
  await db
    .insertInto('dcl_acc_mapping_versions')
    .values({
      approval_entry_id: mappingEntryId,
      book_id: book.id,
      vou_entity_id: 'sale-order',
      book_snapshot: JSON.stringify({}),
      vou_entity_snapshot: JSON.stringify({ code: 'sale-order' }),
      default_result: 'UN_POST',
      mapping_definition: JSON.stringify({
        defaultTemplateId: null,
        rules: [],
        templates: [],
      }),
    })
    .execute()
  await db
    .insertInto('dcl_acc_mapping_versions')
    .values({
      approval_entry_id: fundMappingEntryId,
      book_id: book.id,
      vou_entity_id: 'sale-pricing',
      book_snapshot: JSON.stringify({}),
      vou_entity_snapshot: JSON.stringify({ code: 'sale-pricing' }),
      default_result: 'POST',
      mapping_definition: JSON.stringify({
        defaultTemplateId: 'fund',
        rules: [],
        templates: [
          {
            templateId: 'fund',
            collection: null,
            lines: [
              {
                subjectSource: 'FIXED',
                subjectValue: equity.id,
                direction: 'DEBIT',
                amountField: 'amount',
                currencyField: 'currency',
                dimensions: {},
                quantityField: null,
              },
              {
                subjectSource: 'FIXED',
                subjectValue: fundDebit.id,
                direction: 'CREDIT',
                amountField: 'amount',
                currencyField: 'currency',
                dimensions: { FUND_ACCOUNT: 'fundAccount' },
                quantityField: null,
              },
            ],
          },
        ],
      }),
    })
    .execute()
  const fundDocumentId = ulid(),
    fundEntryId = ulid()
  ids.push(fundDocumentId)
  await db
    .insertInto('vou_documents')
    .values({
      id: fundDocumentId,
      entity: 'sale-pricing',
      document_no: 'SPR-20260904-9999',
      created_at: now,
      created_by: actorId,
    })
    .execute()
  await db
    .insertInto('approval_entries')
    .values({
      id: fundEntryId,
      domain: 'vou',
      entity: 'sale-pricing',
      subject_id: fundDocumentId,
      version_no: null,
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
  await assert.rejects(
    db.transaction().execute((tx) =>
      acc.apply(tx, {
        kind: 'acc',
        action: 'approve',
        entity: 'sale-pricing',
        documentId: fundDocumentId,
        documentNo: 'FUND-TEST',
        approvalEntryId: fundEntryId,
        approvalRevision: '2',
        occurredAt: now.toISOString(),
        payload: {
          businessDate: '2026-09-04',
          currency: 'CNY',
          amount: '10.00',
          fundAccount: ulid(),
        } as unknown as VouPayload,
      }),
    ),
    (error: unknown) =>
      error instanceof Error && error.message === 'funds_insufficient',
  )
  assert.equal(
    (
      await db
        .selectFrom('acc_journal_entries')
        .select('id')
        .where('vou_approval_entry_id', '=', fundEntryId)
        .execute()
    ).length,
    0,
  )
  const payload = (creditOverrideReason?: string) => ({
    businessDate: '2026-09-04',
    currency: 'CNY',
    attachments: [],
    customerSubunit: {
      objectId: subunitId,
      approvalEntryId: customerEntryId,
      selectionOrigin: 'CURRENT' as const,
    },
    operatingEntity: {
      objectId: operatingEntityId,
      approvalEntryId: operatingEntityEntryId,
      selectionOrigin: 'CURRENT' as const,
    },
    warehouse: {
      objectId: warehouseId,
      approvalEntryId: warehouseEntryId,
      selectionOrigin: 'CURRENT' as const,
    },
    productLines: [
      {
        lineId: ulid(),
        product: { objectId: productId },
        enteredQuantity: '1.000000',
        enteredUnit: { objectId: ulid() },
        baseQuantity: '1.000000',
        unitPrice: '10.00',
      },
    ],
    ...(creditOverrideReason ? { creditOverrideReason } : {}),
  })
  const submit = async (p = payload()) => {
    const documentId = ulid(),
      submissionId = ulid()
    ids.push(documentId)
    return {
      documentId,
      submissionId,
      pending: await vou.submit(
        'sale-order',
        'submit-new',
        {
          documentId,
          submissionId,
          idempotencyKey: submissionId,
          expectedRevision: null,
          payload: p,
        },
        actor,
        `control-${submissionId}`,
      ),
    }
  }
  const prepaid = await submit()
  await assert.rejects(
    vou.review(
      'sale-order',
      'approve',
      {
        documentId: prepaid.documentId,
        submissionId: prepaid.submissionId,
        expectedRevision: prepaid.pending.revision,
      },
      reviewer,
      'prepaid',
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_settlement_insufficient',
  )
  assert.equal(
    (
      await db
        .selectFrom('acc_journal_entries')
        .select('id')
        .where('vou_approval_entry_id', '=', prepaid.submissionId)
        .execute()
    ).length,
    0,
  )
  await db
    .updateTable('dcl_customer_version_subunits')
    .set({
      settlement_snapshot: JSON.stringify({
        termCode: 'CASH_ON_DELIVERY',
        ruleType: 'RELATIVE_DAYS',
        monthOffset: 0,
        dayOfMonth: 0,
        dayOffset: 0,
      }),
    })
    .where('customer_approval_entry_id', '=', customerEntryId)
    .where('subunit_id', '=', subunitId)
    .execute()
  const noReason = await submit()
  await assert.rejects(
    vou.review(
      'sale-order',
      'approve',
      {
        documentId: noReason.documentId,
        submissionId: noReason.submissionId,
        expectedRevision: noReason.pending.revision,
      },
      { ...reviewer, permissions: [] },
      'credit-no-permission',
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_credit_limit_exceeded',
  )
  const overridden = await submit(payload('客户书面授权'))
  const approved = await vou.review(
    'sale-order',
    'approve',
    {
      documentId: overridden.documentId,
      submissionId: overridden.submissionId,
      expectedRevision: overridden.pending.revision,
    },
    reviewer,
    'credit-override',
  )
  assert.equal(approved.status, 'APPROVED')
  assert.deepEqual(
    (approved.payload as { operatingEntity: unknown }).operatingEntity,
    {
      objectId: operatingEntityId,
      approvalEntryId: operatingEntityEntryId,
      selectionOrigin: 'CURRENT',
    },
  )
  assert.deepEqual(
    (await vou.get('sale-order', overridden.documentId, actor)).payload,
    approved.payload,
  )
  assert.ok(
    (
      await vou.query(
        'sale-order',
        {
          page: 1,
          pageSize: 20,
          filters: { counterpartyObjectId: subunitId, status: ['APPROVED'] },
        },
        actor,
      )
    ).items.some((item) => item.documentId === overridden.documentId),
  )
  assert.deepEqual(
    (
      await sql<{
        credit_override_reason: string | null
        credit_over_amount: string | null
      }>`SELECT credit_override_reason, credit_over_amount::text FROM vou_sale_order_details WHERE approval_entry_id = ${overridden.submissionId}`.execute(
        db,
      )
    ).rows[0],
    {
      credit_override_reason: '客户书面授权',
      credit_over_amount: '9.00000000',
    },
  )
  const concurrent = await submit(payload('并发授权'))
  const attempts = await Promise.allSettled([
    vou.review(
      'sale-order',
      'approve',
      {
        documentId: concurrent.documentId,
        submissionId: concurrent.submissionId,
        expectedRevision: concurrent.pending.revision,
      },
      reviewer,
      'concurrent-1',
    ),
    vou.review(
      'sale-order',
      'approve',
      {
        documentId: concurrent.documentId,
        submissionId: concurrent.submissionId,
        expectedRevision: concurrent.pending.revision,
      },
      reviewer,
      'concurrent-2',
    ),
  ])
  assert.equal(
    attempts.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  assert.equal(
    (
      await db
        .selectFrom('approval_events')
        .select('id')
        .where('entry_id', '=', concurrent.submissionId)
        .where('action', '=', 'APPROVED')
        .execute()
    ).length,
    1,
  )
  void fundDebit
  void equity
})

test('sale signoff and purchase inbound price the approved source line batch instead of the full order', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const actorId = ulid(),
    reviewerId = ulid()
  const customerId = ulid(),
    customerEntryId = ulid(),
    subunitId = ulid()
  const supplierId = ulid(),
    supplierEntryId = ulid()
  const productId = ulid(),
    productEntryId = ulid()
  const warehouseId = ulid(),
    warehouseEntryId = ulid()
  const operatingEntityId = ulid(),
    operatingEntityEntryId = ulid()
  const documentIds: string[] = []
  const balanceCalls: string[] = []
  const balances = [100n, 15n, 100n, 15n].map((amount) => amount * 100_000_000n)
  const vou = new VouService(db, {
    acc: {
      async apply() {},
      async partyBalance(_tx, input) {
        balanceCalls.push(
          `${input.counterpartyDimension}:${input.counterpartyObjectId}`,
        )
        return balances.shift() ?? 0n
      },
      async customerCreditOccupancy() {
        return 0n
      },
    },
    wfl: { async apply() {} },
  })
  const actor = { id: actorId, trusted: true, permissions: [] as string[] }
  const reviewer = {
    id: reviewerId,
    trusted: true,
    permissions: [] as string[],
  }
  context.after(async () => {
    try {
      await db
        .deleteFrom('approval_events')
        .where('actor_id', 'in', [actorId, reviewerId])
        .execute()
      await db
        .deleteFrom('vou_idempotency')
        .where('document_id', 'in', documentIds)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('domain', '=', 'vou')
        .where('subject_id', 'in', documentIds)
        .execute()
      await db
        .deleteFrom('vou_documents')
        .where('id', 'in', documentIds)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [
          customerEntryId,
          supplierEntryId,
          productEntryId,
          warehouseEntryId,
          operatingEntityEntryId,
        ])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', [
          customerId,
          supplierId,
          productId,
          warehouseId,
          operatingEntityId,
        ])
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
  const suffix = String(
    [...actorId].reduce((sum, value) => sum + value.charCodeAt(0), 0) % 10_000,
  ).padStart(4, '0')
  await db
    .insertInto('app_users')
    .values(
      [actorId, reviewerId].map((id) => ({
        id,
        username: `batch-${id}`,
        display_name: 'Batch control',
        password_hash: 'unused',
        status: 'ENABLED' as const,
        password_changed_at: now,
        password_change_required: false,
      })),
    )
    .execute()
  await db
    .insertInto('dcl_subjects')
    .values([
      {
        id: customerId,
        entity: 'customer',
        code: `CUS-${suffix}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: supplierId,
        entity: 'supplier',
        code: `SUP-${suffix}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: productId,
        entity: 'product',
        code: `PRD-${suffix}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: warehouseId,
        entity: 'warehouse',
        code: `WHS-${suffix}`,
        created_at: now,
        created_by: actorId,
      },
      {
        id: operatingEntityId,
        entity: 'operating-entity',
        code: `OPE-${suffix}`,
        created_at: now,
        created_by: actorId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values([
      {
        id: customerEntryId,
        domain: 'dcl',
        entity: 'customer',
        subject_id: customerId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        updated_by: reviewerId,
        updated_at: now,
      },
      {
        id: supplierEntryId,
        domain: 'dcl',
        entity: 'supplier',
        subject_id: supplierId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        updated_by: reviewerId,
        updated_at: now,
      },
      {
        id: productEntryId,
        domain: 'dcl',
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
      },
      {
        id: warehouseEntryId,
        domain: 'dcl',
        entity: 'warehouse',
        subject_id: warehouseId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        updated_by: reviewerId,
        updated_at: now,
      },
      {
        id: operatingEntityEntryId,
        domain: 'dcl',
        entity: 'operating-entity',
        subject_id: operatingEntityId,
        version_no: 1,
        status: 'APPROVED',
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: reviewerId,
        approved_at: now,
        updated_by: reviewerId,
        updated_at: now,
      },
    ])
    .execute()
  const prepaid = JSON.stringify({
    termCode: 'PREPAID',
    ruleType: 'RELATIVE_DAYS',
    monthOffset: 0,
    dayOfMonth: 0,
    dayOffset: 0,
  })
  await db
    .insertInto('dcl_customer_versions')
    .values({
      approval_entry_id: customerEntryId,
      kind: 'OTHER',
      display_name: '批次客户',
      remittance_profiles: JSON.stringify([]),
      tax_attachments: JSON.stringify([]),
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_customer_subunit_roots')
    .values({
      subunit_id: subunitId,
      customer_id: customerId,
      code: `SUB-${suffix}`,
    })
    .execute()
  await db
    .insertInto('dcl_customer_version_subunits')
    .values({
      customer_approval_entry_id: customerEntryId,
      subunit_id: subunitId,
      name: '批次客户子单位',
      customer_type_id: customerTypeId,
      customer_type_snapshot: JSON.stringify({
        id: customerTypeId,
        code: 'CUSTOMER-TYPE-TEST',
        name: '测试客户类型',
      }),
      settlement_snapshot: prepaid,
      credit_limits: JSON.stringify([]),
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_supplier_versions')
    .values({
      approval_entry_id: supplierEntryId,
      kind: 'ORGANIZATION',
      legal_name: '批次供应商',
      display_name: '批次供应商',
      legal_identifier: null,
      default_operating_entity_id: null,
      default_purchaser_employee_id: null,
      default_purchaser_approval_entry_id: null,
      default_purchaser_code: null,
      default_purchaser_name: null,
      contact_name: null,
      contact_phone: null,
      address: null,
      remark: null,
      default_operating_entity_reference: null,
      settlement_method_snapshot: prepaid,
      default_purchaser_snapshot: null,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_product_versions')
    .values({
      approval_entry_id: productEntryId,
      name: '批次产品',
      source_snapshots: JSON.stringify({}),
      unit_conversions: JSON.stringify([]),
      recyclable: false,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_warehouse_versions')
    .values({
      approval_entry_id: warehouseEntryId,
      name: '批次仓库',
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_operating_entity_versions')
    .values({
      approval_entry_id: operatingEntityEntryId,
      legal_name: '批次经营主体',
      short_name: '批次经营主体',
      legal_identifier: `OPE-${suffix}`,
      registered_address: '',
      contact_name: '',
      contact_phone: '',
      invoice_title: '',
      invoice_address: '',
      invoice_phone: '',
      invoice_bank: '',
      invoice_account: '',
      remark: null,
      enabled: true,
    })
    .execute()
  const customerSubunit = {
    objectId: subunitId,
    approvalEntryId: customerEntryId,
    selectionOrigin: 'CURRENT' as const,
  }
  const supplier = {
    objectId: supplierId,
    approvalEntryId: supplierEntryId,
    selectionOrigin: 'CURRENT' as const,
  }
  const warehouse = {
    objectId: warehouseId,
    approvalEntryId: warehouseEntryId,
    selectionOrigin: 'CURRENT' as const,
  }
  const productLine = (lineId: string) => ({
    lineId,
    product: { objectId: productId },
    enteredQuantity: '10',
    enteredUnit: { objectId: ulid() },
    baseQuantity: '10',
    unitPrice: '10.00',
  })
  const submitAndApproveOrder = async (
    entity: 'sale-order' | 'purchase-order',
  ) => {
    const documentId = ulid(),
      submissionId = ulid(),
      lineId = ulid()
    documentIds.push(documentId)
    const payload =
      entity === 'sale-order'
        ? {
            businessDate: '2026-09-04',
            currency: 'CNY',
            attachments: [],
            customerSubunit,
            operatingEntity: {
              objectId: operatingEntityId,
              approvalEntryId: operatingEntityEntryId,
              selectionOrigin: 'CURRENT' as const,
            },
            warehouse,
            productLines: [productLine(lineId)],
          }
        : {
            businessDate: '2026-09-04',
            currency: 'CNY',
            attachments: [],
            supplier,
            warehouse,
            productLines: [productLine(lineId)],
          }
    const pending = await vou.submit(
      entity,
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload,
      },
      actor,
      `batch-${entity}-submit`,
    )
    await vou.review(
      entity,
      'approve',
      { documentId, submissionId, expectedRevision: pending.revision },
      reviewer,
      `batch-${entity}-approve`,
    )
    return { documentId, lineId }
  }
  const saleOrder = await submitAndApproveOrder('sale-order')
  const signoffDocumentId = ulid(),
    signoffSubmissionId = ulid()
  documentIds.push(signoffDocumentId)
  const signoff = await vou.submit(
    'sale-signoff',
    'submit-new',
    {
      documentId: signoffDocumentId,
      submissionId: signoffSubmissionId,
      idempotencyKey: signoffSubmissionId,
      expectedRevision: null,
      payload: {
        businessDate: '2026-09-05',
        currency: 'CNY',
        attachments: [],
        parentEntity: 'sale-order',
        parentDocumentId: saleOrder.documentId,
        customerSubunit,
        expectedSolventContainers: 0,
        expectedResinContainers: 0,
        returnedSolventContainers: 0,
        returnedResinContainers: 0,
        signoffLines: [
          {
            sourceLineId: saleOrder.lineId,
            signedBaseQuantity: '1',
            rejectedBaseQuantity: '0',
          },
        ],
      },
    },
    actor,
    'batch-signoff-submit',
  )
  assert.equal(
    (
      await vou.review(
        'sale-signoff',
        'approve',
        {
          documentId: signoffDocumentId,
          submissionId: signoffSubmissionId,
          expectedRevision: signoff.revision,
        },
        reviewer,
        'batch-signoff-approve',
      )
    ).status,
    'APPROVED',
  )
  const purchaseOrder = await submitAndApproveOrder('purchase-order')
  const inboundDocumentId = ulid(),
    inboundSubmissionId = ulid()
  documentIds.push(inboundDocumentId)
  const inbound = await vou.submit(
    'purchase-inbound',
    'submit-new',
    {
      documentId: inboundDocumentId,
      submissionId: inboundSubmissionId,
      idempotencyKey: inboundSubmissionId,
      expectedRevision: null,
      payload: {
        businessDate: '2026-09-05',
        currency: 'CNY',
        attachments: [],
        parentEntity: 'purchase-order',
        parentDocumentId: purchaseOrder.documentId,
        supplier,
        warehouse,
        sourceLines: [
          { sourceLineId: purchaseOrder.lineId, baseQuantity: '1' },
        ],
      },
    },
    actor,
    'batch-inbound-submit',
  )
  assert.equal(
    (
      await vou.review(
        'purchase-inbound',
        'approve',
        {
          documentId: inboundDocumentId,
          submissionId: inboundSubmissionId,
          expectedRevision: inbound.revision,
        },
        reviewer,
        'batch-inbound-approve',
      )
    ).status,
    'APPROVED',
  )
  assert.deepEqual(balanceCalls, [
    `CUSTOMER_SUBUNIT:${subunitId}`,
    `CUSTOMER_SUBUNIT:${subunitId}`,
    `SUPPLIER:${supplierId}`,
    `SUPPLIER:${supplierId}`,
  ])
  assert.equal(balances.length, 0)
})
