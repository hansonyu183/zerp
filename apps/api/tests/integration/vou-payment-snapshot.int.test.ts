import assert from 'node:assert/strict'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import type { VouPayloadFor } from '@zerp/model'
import { createDatabase } from '../../src/db/database.ts'
import { AuxApplicationError, AuxService } from '../../src/aux/service.ts'
import { VouApplicationError, VouService } from '../../src/vou/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('sales orders adopt explicit customer or current payment snapshots without rewriting history', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const actorId = ulid()
  const reviewerId = ulid()
  const reviewer = { id: reviewerId, permissions: [], trusted: true }
  const actor = { id: actorId, permissions: [], trusted: true }
  const auxActor = {
    id: actorId,
    permissions: ['create', 'get', 'save', 'disable', 'delete'].map(
      (action) => `/aux/payment-method/${action}`,
    ),
  }
  const aux = new AuxService(db)
  const vou = new VouService(db, {
    acc: {
      async apply() {},
      async partyBalance() {
        return 0n
      },
      async customerCreditOccupancy() {
        return 0n
      },
    },
    wfl: { async apply() {} },
  })
  const subjects = {
    customer: ulid(),
    product: ulid(),
    warehouse: ulid(),
    'operating-entity': ulid(),
  }
  const entries = {
    customer: ulid(),
    product: ulid(),
    warehouse: ulid(),
    'operating-entity': ulid(),
  }
  const subunitId = ulid()
  const emptySubunitId = ulid()
  const documentIds: string[] = []
  context.after(async () => {
    try {
      if (documentIds.length)
        await sql`DELETE FROM vou_idempotency WHERE document_id IN (${sql.join(documentIds)})`.execute(
          db,
        )
      await sql`DELETE FROM approval_events WHERE actor_id IN (${actorId}, ${reviewerId})`.execute(
        db,
      )
      await sql`DELETE FROM approval_entries WHERE domain = 'vou' AND submitted_by = ${actorId}`.execute(
        db,
      )
      if (documentIds.length)
        await sql`DELETE FROM vou_documents WHERE id IN (${sql.join(documentIds)})`.execute(
          db,
        )
      await sql`DELETE FROM approval_entries WHERE id IN (${sql.join(Object.values(entries))})`.execute(
        db,
      )
      await sql`DELETE FROM dcl_subjects WHERE id IN (${sql.join(Object.values(subjects))})`.execute(
        db,
      )
      await sql`DELETE FROM aux_objects WHERE created_by = ${actorId}`.execute(
        db,
      )
      await sql`DELETE FROM app_audit_events WHERE actor_user_id = ${actorId}`.execute(
        db,
      )
      await sql`DELETE FROM app_users WHERE id IN (${actorId}, ${reviewerId})`.execute(
        db,
      )
    } finally {
      await db.destroy()
    }
  })
  await db
    .insertInto('app_users')
    .values({
      id: actorId,
      username: `payment-${actorId}`,
      display_name: 'Payment snapshot actor',
      py: 'payment',
      password_hash: 'unused',
      status: 'ENABLED',
      password_changed_at: new Date(),
      password_change_required: false,
    })
    .execute()
  await db
    .insertInto('app_users')
    .values({
      id: reviewerId,
      username: `payment-review-${reviewerId}`,
      display_name: 'Payment reviewer',
      py: 'reviewer',
      password_hash: 'unused',
      status: 'ENABLED',
      password_changed_at: new Date(),
      password_change_required: false,
    })
    .execute()
  const firstMethod = await aux.create(
    'payment-method',
    { name: '客户历史方式', defaultSalesSurcharge: '1.23' },
    auxActor,
  )
  const alternate = await aux.create(
    'payment-method',
    { name: '订单改选方式', defaultSalesSurcharge: '987654321.09' },
    auxActor,
  )
  const firstView = await aux.get(
    'payment-method',
    { id: firstMethod.id },
    auxActor,
  )
  const alternateView = await aux.get(
    'payment-method',
    { id: alternate.id },
    auxActor,
  )
  const customerSnapshot = {
    objectId: firstView.id,
    code: firstView.code,
    name: firstView.name,
    defaultSalesSurcharge: firstView.defaultSalesSurcharge,
  }
  const currentSnapshot = {
    objectId: alternateView.id,
    code: alternateView.code,
    name: alternateView.name,
    defaultSalesSurcharge: alternateView.defaultSalesSurcharge,
  }
  const unit = {
    objectId: ulid(),
    code: 'PAY-UNIT',
    name: '千克',
    symbol: 'kg',
    quantityScale: 2,
  }
  const now = new Date()
  const prefix = {
    customer: 'CUS',
    product: 'PRD',
    warehouse: 'WHS',
    'operating-entity': 'OPE',
  }
  const codeSuffix = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0')
  await db
    .insertInto('dcl_subjects')
    .values(
      Object.entries(subjects).map(([entity, id]) => ({
        id,
        entity,
        code: `${prefix[entity as keyof typeof prefix]}-${codeSuffix}`,
        created_at: now,
        created_by: actorId,
      })),
    )
    .execute()
  await db
    .insertInto('approval_entries')
    .values(
      Object.entries(entries).map(([entity, id]) => ({
        id,
        domain: 'dcl',
        entity,
        subject_id: subjects[entity as keyof typeof subjects],
        version_no: 1,
        status: 'APPROVED' as const,
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: actorId,
        approved_at: now,
        updated_by: actorId,
        updated_at: now,
      })),
    )
    .execute()
  await db
    .insertInto('dcl_customer_versions')
    .values({
      approval_entry_id: entries.customer,
      kind: 'ENTERPRISE',
      display_name: '收款客户',
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_customer_subunit_roots')
    .values(
      [subunitId, emptySubunitId].map((id) => ({
        subunit_id: id,
        customer_id: subjects.customer,
        code: `PAY-SUB-${id.slice(-8)}`,
      })),
    )
    .execute()
  await db
    .insertInto('dcl_customer_version_subunits')
    .values(
      [subunitId, emptySubunitId].map((id) => ({
        customer_approval_entry_id: entries.customer,
        subunit_id: id,
        name: id === subunitId ? '默认收款总部' : '未设收款分部',
        customer_type_id: '01J00000000000000000000103',
        customer_type_snapshot: JSON.stringify({
          id: '01J00000000000000000000103',
          code: 'CUSTOMER-TYPE-TEST',
          name: '测试类型',
        }),
        payment_snapshot:
          id === subunitId
            ? JSON.stringify({
                id: firstView.id,
                code: firstView.code,
                name: firstView.name,
                defaultSalesSurcharge: firstView.defaultSalesSurcharge,
              })
            : null,
        enabled: true,
      })),
    )
    .execute()
  await db
    .insertInto('dcl_product_versions')
    .values({
      approval_entry_id: entries.product,
      name: '收款测试商品',
      source_snapshots: {},
      unit_conversions: JSON.stringify([
        {
          unit: {
            id: unit.objectId,
            code: unit.code,
            name: unit.name,
            symbol: unit.symbol,
            quantityScale: unit.quantityScale,
          },
          factor: '1.000000',
        },
      ]),
      recyclable: false,
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_warehouse_versions')
    .values({
      approval_entry_id: entries.warehouse,
      name: '收款测试仓库',
      enabled: true,
    })
    .execute()
  await db
    .insertInto('dcl_operating_entity_versions')
    .values({
      approval_entry_id: entries['operating-entity'],
      legal_name: '收款测试主体',
      short_name: '收款主体',
      registered_address: '',
      contact_name: '',
      contact_phone: '',
      invoice_title: '',
      invoice_address: '',
      invoice_phone: '',
      invoice_bank: '',
      invoice_account: '',
      enabled: true,
    })
    .execute()
  const reference = (key: keyof typeof subjects) => ({
    objectId: subjects[key],
    approvalEntryId: entries[key],
    selectionOrigin: 'CURRENT' as const,
  })
  const payload = (
    paymentMethod: VouPayloadFor<'sale-order'>['paymentMethod'],
    selectedSubunit = subunitId,
  ): VouPayloadFor<'sale-order'> => ({
    businessDate: '2026-09-07',
    currency: 'CNY',
    attachments: [],
    customerSubunit: { ...reference('customer'), objectId: selectedSubunit },
    operatingEntity: reference('operating-entity'),
    warehouse: reference('warehouse'),
    paymentMethod,
    productLines: [
      {
        lineId: ulid(),
        product: { objectId: subjects.product },
        enteredQuantity: '1.00',
        enteredUnit: unit,
        baseQuantity: '1.000000',
        unitPrice: '0.00',
      },
    ],
  })
  const submit = async (data: VouPayloadFor<'sale-order'>) => {
    const documentId = ulid()
    const submissionId = ulid()
    documentIds.push(documentId)
    return vou.submit(
      'sale-order',
      'submit-new',
      {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: data,
      },
      actor,
      submissionId,
    )
  }
  const inherited = {
    ...customerSnapshot,
    selectionOrigin: 'CUSTOMER' as const,
  }
  const selected = { ...currentSnapshot, selectionOrigin: 'CURRENT' as const }
  const first = await submit(payload(inherited))
  assert.deepEqual(
    (await vou.get('sale-order', first.documentId, actor)).payload,
    first.payload,
  )
  assert.deepEqual(
    (first.payload as VouPayloadFor<'sale-order'>).paymentMethod,
    inherited,
  )
  const second = await submit(payload(selected))
  assert.deepEqual(
    (second.payload as VouPayloadFor<'sale-order'>).paymentMethod,
    selected,
  )
  const noMethod = await submit(payload(null, emptySubunitId))
  assert.equal(
    (noMethod.payload as VouPayloadFor<'sale-order'>).paymentMethod,
    null,
  )
  const reject = async (data: VouPayloadFor<'sale-order'>) => {
    await assert.rejects(
      submit(data),
      (error: unknown) =>
        error instanceof VouApplicationError &&
        error.errorKey === 'vou_reference_unavailable' &&
        error.data?.blockers.some(
          (blocker) =>
            !!blocker &&
            typeof blocker === 'object' &&
            'field' in blocker &&
            blocker.field === 'paymentMethod',
        ),
    )
    await assert.rejects(
      vou.get('sale-order', documentIds.at(-1)!, actor),
      (error: unknown) =>
        error instanceof VouApplicationError &&
        error.errorKey === 'vou_not_found',
    )
  }
  await reject(payload(null))
  await reject(payload(inherited, emptySubunitId))
  for (const patch of [
    { objectId: ulid() },
    { code: '伪造编码' },
    { name: '伪造名称' },
    { defaultSalesSurcharge: '9.99' },
  ]) {
    await reject(payload({ ...inherited, ...patch }))
    await reject(payload({ ...selected, ...patch }))
  }
  const customerCandidates = await vou.queryReferenceCandidates(
    { entity: 'customer-subunit' },
    actor,
  )
  assert.deepEqual(
    customerCandidates.items.find((item) => item.objectId === subunitId),
    {
      entity: 'customer-subunit',
      objectId: subunitId,
      customerId: subjects.customer,
      approvalEntryId: entries.customer,
      code: `PAY-SUB-${subunitId.slice(-8)}`,
      name: '默认收款总部',
      paymentMethod: customerSnapshot,
    },
  )
  const paymentCandidates = await vou.queryReferenceCandidates(
    { entity: 'payment-method' },
    actor,
  )
  assert.ok(
    paymentCandidates.items.some(
      (item) =>
        item.entity === 'payment-method' &&
        item.objectId === alternate.id &&
        item.defaultSalesSurcharge === '987654321.09',
    ),
  )
  const changedFirst = await aux.save(
    'payment-method',
    {
      id: firstMethod.id,
      revision: firstMethod.revision,
      name: '客户来源已改名',
      defaultSalesSurcharge: '2.34',
    },
    auxActor,
  )
  const disabledFirst = await aux.disable(
    'payment-method',
    { id: firstMethod.id, revision: changedFirst.revision },
    auxActor,
    'disable-customer-payment',
  )
  const changedAlternate = await aux.save(
    'payment-method',
    {
      id: alternate.id,
      revision: alternate.revision,
      name: '订单来源已改名',
      defaultSalesSurcharge: '3.45',
    },
    auxActor,
  )
  await reject(payload(selected))
  const disabledAlternate = await aux.disable(
    'payment-method',
    { id: alternate.id, revision: changedAlternate.revision },
    auxActor,
    'disable-current-payment',
  )
  await reject(payload({ ...customerSnapshot, selectionOrigin: 'CURRENT' }))
  await reject(
    payload({
      ...selected,
      name: '订单来源已改名',
      defaultSalesSurcharge: '3.45',
    }),
  )
  const later = await submit(payload(inherited))
  assert.deepEqual(
    (later.payload as VouPayloadFor<'sale-order'>).paymentMethod,
    inherited,
  )
  for (const [order, expected] of [
    [first, inherited],
    [second, selected],
  ] as const) {
    const approved = await vou.review(
      'sale-order',
      'approve',
      {
        documentId: order.documentId,
        submissionId: order.submissionId,
        expectedRevision: order.revision,
      },
      reviewer,
      'approve-frozen-payment',
    )
    assert.equal(approved.status, 'APPROVED')
    assert.deepEqual(
      (approved.payload as VouPayloadFor<'sale-order'>).paymentMethod,
      expected,
    )
    assert.deepEqual(
      (await vou.get('sale-order', order.documentId, actor)).payload,
      approved.payload,
    )
  }
  const afterCandidates = await vou.queryReferenceCandidates(
    { entity: 'payment-method' },
    actor,
  )
  assert.ok(
    !afterCandidates.items.some(
      (item) =>
        item.objectId === alternate.id || item.objectId === firstMethod.id,
    ),
  )
  for (const [method, source] of [
    [disabledFirst, 'dcl_customer_version_subunits'],
    [disabledAlternate, 'vou_sale_order_details'],
  ] as const) {
    await assert.rejects(
      aux.delete(
        'payment-method',
        { id: method.id, revision: method.revision },
        auxActor,
      ),
      (error: unknown) =>
        error instanceof AuxApplicationError &&
        error.errorKey === 'conflict' &&
        JSON.stringify(error.data).includes(source),
    )
  }
  const savedSecond = await vou.get('sale-order', second.documentId, actor)
  const unapproved = await vou.review(
    'sale-order',
    'unapprove',
    {
      documentId: second.documentId,
      submissionId: second.submissionId,
      expectedRevision: savedSecond.revision,
      reason: '撤销测试订单以解除收款方式引用',
    },
    reviewer,
    'release-payment-order',
  )
  await vou.delete(
    'sale-order',
    {
      documentId: second.documentId,
      submissionId: second.submissionId,
      expectedRevision: unapproved.revision,
    },
    actor,
    'delete-payment-order',
  )
  await aux.delete(
    'payment-method',
    { id: disabledAlternate.id, revision: disabledAlternate.revision },
    auxActor,
  )
  await assert.rejects(
    aux.get('payment-method', { id: disabledAlternate.id }, auxActor),
    (error: unknown) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'validation_failed',
  )
})
