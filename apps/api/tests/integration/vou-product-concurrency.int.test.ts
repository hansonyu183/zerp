import assert from 'node:assert/strict'
import test from 'node:test'

import type { VouPayloadFor } from '@zerp/model'
import pg from 'pg'
import { ulid } from 'ulid'

import {
  AuxService,
  type AuxEntity,
  type AuxObjectView,
  type AuxWriteData,
} from '../../src/aux/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { BobArchiveService } from '../../src/bob/archives.ts'
import { searchPinyin } from '../../src/platform/pinyin.ts'
import { VouService } from '../../src/vou/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const customerTypeId = '01J00000000000000000000103'

function databaseUrlFor(name: string): string {
  const url = new URL(databaseUrl!)
  url.searchParams.set('application_name', name)
  return url.toString()
}

async function waitForLock(
  observer: pg.Client,
  applicationName: string,
): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    const waiting = await observer.query(
      `SELECT 1
       FROM pg_stat_activity
       WHERE application_name = $1
         AND state = 'active'
         AND wait_event_type = 'Lock'
       LIMIT 1`,
      [applicationName],
    )
    if (waiting.rowCount === 1) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`${applicationName} did not wait for a database lock`)
}

async function settleWithin<T>(promise: Promise<T>, milliseconds: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('concurrent VOU/BOB operations timed out')),
          milliseconds,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

test('VOU product adoption serializes with BOB approval without cross-subject advisory cycles', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const suffix = ulid()
  const vouApplication = `vou-product-read-${suffix}`
  const dclApplication = `dcl-product-review-${suffix}`
  const db = createDatabase(databaseUrl)
  const vouDb = createDatabase(databaseUrlFor(vouApplication))
  const dclDb = createDatabase(databaseUrlFor(dclApplication))
  const validationPool = new pg.Pool({
    connectionString: databaseUrlFor(`dcl-rpt-validator-${suffix}`),
  })
  const blocker = new pg.Client({
    connectionString: databaseUrlFor(`vou-product-blocker-${suffix}`),
  })
  const observer = new pg.Client({
    connectionString: databaseUrlFor(`vou-product-observer-${suffix}`),
  })
  const archives = new BobArchiveService(dclDb)
  const vou = new VouService(vouDb, {
    acc: { async apply() {} },
    wfl: { async apply() {} },
  })
  const aux = new AuxService(db)
  const actorId = ulid()
  const reviewerId = ulid()
  const actor = { id: actorId, permissions: [] as string[], trusted: true }
  const reviewer = {
    id: reviewerId,
    permissions: [] as string[],
    trusted: true,
  }
  const auxActor = {
    id: actorId,
    permissions: [
      '/aux/measurement-unit/create',
      '/aux/measurement-unit/get',
      '/aux/product-type/create',
      '/aux/product-type/get',
      '/aux/product-category/create',
      '/aux/product-category/get',
      '/aux/operating-entity/create',
      '/aux/operating-entity/get',
    ],
  }
  const productIds = [ulid(), ulid(), ulid()].sort()
  const [materialId, finishedId, blockingProductId] = productIds as [
    string,
    string,
    string,
  ]
  const directSubjectIds = {
    customer: ulid(),
    warehouse: ulid(),
  }
  const directApprovalIds = {
    customer: ulid(),
    warehouse: ulid(),
  }
  const customerSubunitId = ulid()
  const vouDocumentId = ulid()
  const vouSubmissionId = ulid()
  const archiveEntryIds: string[] = []
  const auxObjectIds: string[] = []
  let blockerTransactionOpen = false

  context.after(async () => {
    try {
      if (blockerTransactionOpen) await blocker.query('ROLLBACK')
      await db
        .deleteFrom('vou_idempotency')
        .where('submission_id', '=', vouSubmissionId)
        .execute()
      await db
        .deleteFrom('archive_idempotency')
        .where('subject_id', 'in', productIds)
        .execute()
      await db
        .deleteFrom('approval_events')
        .where('actor_id', 'in', [actorId, reviewerId])
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('domain', '=', 'vou')
        .where('subject_id', '=', vouDocumentId)
        .execute()
      await db
        .deleteFrom('vou_documents')
        .where('id', '=', vouDocumentId)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('id', 'in', [
          ...archiveEntryIds,
          ...Object.values(directApprovalIds),
        ])
        .execute()
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', Object.values(directSubjectIds))
        .execute()
      await db
        .deleteFrom('bob_subjects')
        .where('id', 'in', [...productIds, ...Object.values(directSubjectIds)])
        .execute()
      await db
        .deleteFrom('aux_objects')
        .where('id', 'in', auxObjectIds)
        .execute()
      await db
        .deleteFrom('app_audit_events')
        .where('actor_user_id', 'in', [actorId, reviewerId])
        .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [actorId, reviewerId])
        .execute()
    } finally {
      await Promise.allSettled([
        blocker.end(),
        observer.end(),
        validationPool.end(),
        vouDb.destroy(),
        dclDb.destroy(),
        db.destroy(),
      ])
    }
  })

  await blocker.connect()
  await observer.connect()
  await db
    .insertInto('app_users')
    .values(
      [actorId, reviewerId].map((id) => ({
        id,
        username: `vou-product-lock-${id}`,
        display_name: 'VOU product lock test',
        py: searchPinyin('VOU product lock test'),
        password_hash: 'unused',
        status: 'ENABLED' as const,
        password_changed_at: new Date(),
        password_change_required: false,
      })),
    )
    .execute()

  const createAux = async <Entity extends AuxEntity>(
    entity: Entity,
    data: AuxWriteData<Entity>,
  ): Promise<AuxObjectView<Entity>> => {
    const created = await aux.create(entity, data, auxActor)
    auxObjectIds.push(created.id)
    return aux.get(entity, { id: created.id }, auxActor)
  }
  const [rawType, finishedType, category, materialUnit, oldFinishedUnit] =
    await Promise.all([
      createAux('product-type', {
        name: '并发原料类型',
        behaviorProfile: 'RAW_MATERIAL',
        description: '',
      }),
      createAux('product-type', {
        name: '并发成品类型',
        behaviorProfile: 'STANDARD_FINISHED',
        description: '',
      }),
      createAux('product-category', {
        name: '并发产品分类',
        parentId: '',
        description: '',
      }),
      createAux('measurement-unit', {
        name: '并发克',
        symbol: 'g',
        quantityScale: 2,
      }),
      createAux('measurement-unit', {
        name: '并发旧千克',
        symbol: 'kg',
        quantityScale: 2,
      }),
    ])
  const [newFinishedUnit, blockingUnit] = await Promise.all([
    createAux('measurement-unit', {
      name: '并发新吨',
      symbol: 't',
      quantityScale: 3,
    }),
    createAux('measurement-unit', {
      name: '并发件',
      symbol: '件',
      quantityScale: 0,
    }),
  ])
  const unitSnapshot = (unit: AuxObjectView<'measurement-unit'>) => ({
    id: unit.id,
    code: unit.code,
    name: unit.name,
    symbol: unit.symbol,
    quantityScale: unit.quantityScale,
  })
  const unitWireSnapshot = (unit: AuxObjectView<'measurement-unit'>) => ({
    objectId: unit.id,
    code: unit.code,
    name: unit.name,
    symbol: unit.symbol,
    quantityScale: unit.quantityScale,
  })
  const productSnapshot = (
    name: string,
    type: AuxObjectView<'product-type'>,
    unit: AuxObjectView<'measurement-unit'>,
    formula: Record<string, unknown> | null,
  ) => ({
    name,
    barcode: '',
    specification: '',
    model: '',
    productType: {
      id: type.id,
      code: type.code,
      name: type.name,
      behaviorProfile: type.behaviorProfile,
    },
    productCategory: {
      id: category.id,
      code: category.code,
      name: category.name,
    },
    pricingUnit: unitSnapshot(unit),
    defaultInputUnit: unitSnapshot(unit),
    unitConversions: [{ unit: unitSnapshot(unit), factor: '1.000000' }],
    defaultPackagingSpec: '1.000000',
    recyclable: false,
    fixedFormula: formula,
    remark: '',
    enabled: true,
  })
  const submitProduct = async (
    subjectId: string,
    snapshot: ReturnType<typeof productSnapshot>,
  ) => {
    const submissionId = ulid()
    archiveEntryIds.push(submissionId)
    const pending = await archives.submit(
      'product',
      'submit-new',
      {
        subjectId,
        submissionId,
        idempotencyKey: submissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot,
      },
      actor,
      `product-submit-${submissionId}`,
    )
    return archives.review(
      'product',
      'approve',
      {
        subjectId,
        submissionId,
        expectedRevision: pending.revision,
      },
      reviewer,
      `product-approve-${submissionId}`,
    )
  }
  const material = await submitProduct(
    materialId,
    productSnapshot('并发原料', rawType, materialUnit, null),
  )
  const formula = (unit: AuxObjectView<'measurement-unit'>) => ({
    output: {
      enteredQuantity: '1.000000',
      enteredUnit: unitSnapshot(unit),
      baseQuantity: '1.000000',
    },
    components: [
      {
        material: {
          objectId: material.subjectId,
          approvalEntryId: material.submissionId,
          code: material.code!,
          name: '并发原料',
        },
        quantity: {
          enteredQuantity: '1.000000',
          enteredUnit: unitSnapshot(materialUnit),
          baseQuantity: '1.000000',
        },
        resolutionStatus: 'CURRENT' as const,
        requiresConfirmation: false,
      },
    ],
  })
  const finishedV1 = await submitProduct(
    finishedId,
    productSnapshot(
      '并发成品 V1',
      finishedType,
      oldFinishedUnit,
      formula(oldFinishedUnit),
    ),
  )
  await submitProduct(
    blockingProductId,
    productSnapshot('并发阻塞产品', rawType, blockingUnit, null),
  )
  const finishedV2EntryId = ulid()
  archiveEntryIds.push(finishedV2EntryId)
  const finishedV2Pending = await archives.submit(
    'product',
    'submit-change',
    {
      subjectId: finishedId,
      submissionId: finishedV2EntryId,
      idempotencyKey: finishedV2EntryId,
      expectedLatestApprovedSubmissionId: finishedV1.submissionId,
      expectedLatestApprovedRevision: finishedV1.revision,
      snapshot: productSnapshot(
        '并发成品 V2',
        finishedType,
        newFinishedUnit,
        formula(newFinishedUnit),
      ),
    },
    actor,
    'product-v2-submit',
  )

  const operatingEntity = await createAux('operating-entity', {
    legalName: '并发经营主体',
    shortName: '并发主体',
    legalIdentifier: '91310000MA1K123456',
    registeredAddress: '',
    contactName: '',
    contactPhone: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remark: '',
  })
  const now = new Date()
  const codeSeed = Math.floor(Math.random() * 10_000)
  const code = (prefix: string, offset: number) =>
    `${prefix}-${String((codeSeed + offset) % 10_000).padStart(4, '0')}`
  await db
    .insertInto('bob_subjects')
    .values([
      {
        id: directSubjectIds.customer,
        entity: 'customer',
        code: code('CUS', 0),
        created_at: now,
        created_by: actorId,
      },
    ])
    .execute()
  await db
    .insertInto('approval_entries')
    .values(
      [[directApprovalIds.customer, 'customer', directSubjectIds.customer]].map(
        ([id, entity, subjectId]) => ({
          id: id!,
          domain: 'bob',
          entity: entity!,
          subject_id: subjectId!,
          version_no: 1,
          status: 'APPROVED' as const,
          revision: 1,
          submitted_by: actorId,
          submitted_at: now,
          approved_by: reviewerId,
          approved_at: now,
          updated_by: reviewerId,
          updated_at: now,
        }),
      ),
    )
    .execute()
  await db
    .insertInto('bob_customer_versions')
    .values({
      approval_entry_id: directApprovalIds.customer,
      kind: 'ENTERPRISE',
      display_name: '并发客户',
    })
    .execute()
  await db
    .insertInto('bob_customer_subunit_roots')
    .values({
      subunit_id: customerSubunitId,
      customer_id: directSubjectIds.customer,
      code: 'CONCURRENT',
    })
    .execute()
  await db
    .insertInto('bob_customer_version_subunits')
    .values({
      customer_approval_entry_id: directApprovalIds.customer,
      subunit_id: customerSubunitId,
      name: '并发客户总部',
      customer_type_id: customerTypeId,
      customer_type_snapshot: JSON.stringify({
        id: customerTypeId,
        code: 'CUSTOMER-TYPE-TEST',
        name: '测试客户类型',
      }),
      payment_snapshot: null,
      enabled: true,
    })
    .execute()
  const currentWarehouse = await new AuxService(db).create(
    'warehouse',
    {
      name: '测试仓库',
      address: '',
      contactName: '',
      contactPhone: '',
      managerEmployeeId: null,
      remark: '',
    },
    { id: actorId, permissions: ['/aux/warehouse/create'] },
  )

  auxObjectIds.push(currentWarehouse.id)
  const payload: VouPayloadFor<'sale-order'> = {
    businessDate: '2026-09-07',
    currency: 'CNY',
    attachments: [],
    customerSubunit: {
      objectId: customerSubunitId,
      approvalEntryId: directApprovalIds.customer,
      selectionOrigin: 'CURRENT',
    },
    paymentMethod: null,
    operatingEntity: { objectId: operatingEntity.id },
    warehouse: { objectId: currentWarehouse.id },
    productLines: [
      [materialId, materialUnit],
      [finishedId, oldFinishedUnit],
      [blockingProductId, blockingUnit],
    ].map(([productId, unit]) => ({
      lineId: ulid(),
      product: { objectId: productId as string },
      enteredQuantity: '1.000000',
      enteredUnit: unitWireSnapshot(unit as AuxObjectView<'measurement-unit'>),
      baseQuantity: '1.000000',
      unitPrice: '1.00',
    })),
  }

  await blocker.query('BEGIN')
  blockerTransactionOpen = true
  await blocker.query('SELECT id FROM bob_subjects WHERE id = $1 FOR UPDATE', [
    blockingProductId,
  ])
  const vouSubmission = vou.submit(
    'sale-order',
    'submit-new',
    {
      documentId: vouDocumentId,
      submissionId: vouSubmissionId,
      idempotencyKey: vouSubmissionId,
      expectedRevision: null,
      payload,
    },
    actor,
    'vou-product-concurrent-submit',
  )
  let review:
    Promise<Awaited<ReturnType<BobArchiveService['review']>>> | undefined
  try {
    await waitForLock(observer, vouApplication)
    review = archives.review(
      'product',
      'approve',
      {
        subjectId: finishedId,
        submissionId: finishedV2EntryId,
        expectedRevision: finishedV2Pending.revision,
      },
      reviewer,
      'product-v2-concurrent-approve',
    )
    await waitForLock(observer, dclApplication)
    await blocker.query('COMMIT')
    blockerTransactionOpen = false
    const [order, approvedV2] = await settleWithin(
      Promise.all([vouSubmission, review]),
      2_000,
    )
    assert.equal(approvedV2.status, 'APPROVED')
    assert.deepEqual(
      (order.payload as VouPayloadFor<'sale-order'>).productLines[1]
        ?.enteredUnit,
      unitWireSnapshot(oldFinishedUnit),
    )
  } finally {
    if (blockerTransactionOpen) {
      await blocker.query('ROLLBACK')
      blockerTransactionOpen = false
    }
    await Promise.allSettled([vouSubmission, ...(review ? [review] : [])])
  }
})
