import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { sql } from 'kysely'
import { ulid } from 'ulid'

import {
  BobArchiveApplicationError,
  BobArchiveService,
} from '../../src/bob/archives.ts'
import { AuxApplicationError, AuxService } from '../../src/aux/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { searchPinyin } from '../../src/platform/pinyin.ts'
import { AttachmentStore } from '../../src/platform/attachment-store.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('all issue 364 aggregates own typed PostgreSQL snapshots and customer attachment finalization', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const attachmentRoot = await mkdtemp(
    join(tmpdir(), 'zerp-customer-attachments-'),
  )
  const attachmentStore = new AttachmentStore(attachmentRoot, {
    orphanGraceMs: 0,
  })
  const bobArchives = new BobArchiveService(db, { attachmentStore })
  const submitterId = ulid()
  const reviewerId = ulid()
  const submitter = {
    id: submitterId,
    permissions: [] as string[],
    trusted: true,
  }
  const reviewer = {
    id: reviewerId,
    permissions: [] as string[],
    trusted: true,
  }
  const subjectIds: string[] = []
  const currentPeopleIds: string[] = []
  const auxIds = Array.from({ length: 10 }, () => ulid())

  context.after(async () => {
    try {
      if (subjectIds.length) {
        await db
          .deleteFrom('archive_idempotency')
          .where('subject_id', 'in', subjectIds)
          .execute()
        await db
          .deleteFrom('approval_events')
          .where('subject_id', 'in', subjectIds)
          .execute()
        await db
          .deleteFrom('approval_entries')
          .where('subject_id', 'in', subjectIds)
          .execute()
      }
      await db
        .deleteFrom('dcl_subjects')
        .where('created_by', '=', submitterId)
        .execute()
      await db
        .deleteFrom('bob_subjects')
        .where('created_by', '=', submitterId)
        .execute()
      if (currentPeopleIds.length)
        await db
          .deleteFrom('aux_reference_facts')
          .where('aux_object_id', 'in', currentPeopleIds)
          .execute()
      await db
        .deleteFrom('aux_objects')
        .where('id', 'in', [...auxIds, ...currentPeopleIds])
        .execute()
      await db
        .deleteFrom('app_audit_events')
        .where('actor_user_id', '=', submitterId)
        .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [submitterId, reviewerId])
        .execute()
    } finally {
      await db.destroy()
      await rm(attachmentRoot, { recursive: true, force: true })
    }
  })

  await db
    .insertInto('app_users')
    .values([
      {
        id: submitterId,
        username: `archive-all-submitter-${submitterId}`,
        display_name: 'All Archive Submitter',
        py: searchPinyin('All Archive Submitter'),
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      },
      {
        id: reviewerId,
        username: `archive-all-reviewer-${reviewerId}`,
        display_name: 'All Archive Reviewer',
        py: searchPinyin('All Archive Reviewer'),
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      },
    ])
    .execute()
  const auxEntities = [
    'dictionary-item',
    'product-type',
    'product-category',
    'measurement-unit',
    'measurement-unit',
    'employee-category',
    'department',
    'position',
    'settlement-method',
    'payment-method',
  ] as const
  await db
    .insertInto('aux_objects')
    .values(
      auxIds.map((id, index) => ({
        id,
        entity: auxEntities[index]!,
        code: `TST-${String(index + 1).padStart(4, '0')}`,
        data: JSON.stringify({
          name: `测试引用 ${index + 1}`,
          ...(index === 1 ? { behaviorProfile: 'RAW_MATERIAL' } : {}),
          ...(index === 3 || index === 4
            ? { symbol: 'kg', quantityScale: 3 }
            : {}),
          ...(index === 8
            ? {
                termCode: 'MONTHLY_30',
                ruleType: 'MONTH_END',
                monthOffset: 1,
                dayOfMonth: 0,
                dayOffset: 0,
                defaultSalesSurcharge: '0.10',
                description: '',
              }
            : {}),
          ...(index === 9
            ? { defaultSalesSurcharge: '0.05', description: '' }
            : {}),
        }),
        enabled: true,
        created_by: submitterId,
        updated_by: submitterId,
      })),
    )
    .execute()
  async function submitAndApprove(
    entity: Parameters<BobArchiveService['submit']>[0],
    snapshot: Record<string, unknown>,
  ) {
    const subjectId = ulid()
    const submissionId = ulid()
    subjectIds.push(subjectId)
    const input = {
      subjectId,
      submissionId,
      idempotencyKey: submissionId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot,
    }
    const pending = await bobArchives.submit(
      entity,
      'submit-new',
      input,
      submitter,
      ulid(),
    )
    const review = {
      subjectId,
      submissionId,
      expectedRevision: pending.revision,
    }
    const approved = await bobArchives.review(
      entity,
      'approve',
      review,
      reviewer,
      ulid(),
    )
    assert.equal(approved.status, 'APPROVED')
    assert.deepEqual(approved.snapshot, pending.snapshot)
    const history = await bobArchives.auditHistory(entity, subjectId, reviewer)
    assert.equal(history.length, 2)
    return approved
  }

  const aux = new AuxService(db)
  const peopleActor = {
    id: submitterId,
    permissions: [
      '/aux/operating-entity/create',
      '/aux/operating-entity/get',
      '/aux/employee/create',
      '/aux/employee/get',
    ],
  }
  const createdOperatingEntity = await aux.create(
    'operating-entity',
    {
      legalName: '全聚合经营主体',
      shortName: '全聚合主体',
      legalIdentifier: '91350211M000100Y46',
      registeredAddress: '厦门市',
      contactName: '联系人',
      contactPhone: '13800000000',
      invoiceTitle: '全聚合经营主体',
      invoiceAddress: '厦门市',
      invoicePhone: '0592-1234567',
      invoiceBank: '目标银行',
      invoiceAccount: '622200001',
      remark: '',
    },
    peopleActor,
  )
  currentPeopleIds.push(createdOperatingEntity.id)
  const operatingEntity = await aux.get(
    'operating-entity',
    { id: createdOperatingEntity.id },
    peopleActor,
  )
  const operatingEntityReference = {
    objectId: operatingEntity.id,
    code: operatingEntity.code,
    name: operatingEntity.name,
  }
  assert.equal(operatingEntity.shortName, '全聚合主体')

  const product = await submitAndApprove('product', {
    name: '测试产品',
    barcode: 'barcode-001',
    specification: '10kg',
    model: 'A1',
    productType: {
      id: auxIds[1],
      code: 'FORGED-PRODUCT-TYPE',
      name: '伪造产品类型',
      behaviorProfile: 'FINISHED_GOOD',
    },
    productCategory: {
      id: auxIds[2],
      code: 'FORGED-CATEGORY',
      name: '伪造分类',
    },
    pricingUnit: {
      id: auxIds[3],
      code: 'FORGED-PRICING',
      name: '伪造计价单位',
      symbol: 'FORGED',
      quantityScale: 0,
    },
    defaultInputUnit: {
      id: auxIds[3],
      code: 'FORGED-INPUT',
      name: '伪造默认单位',
      symbol: 'FORGED',
      quantityScale: 0,
    },
    unitConversions: [
      {
        unit: {
          id: auxIds[3],
          code: 'FORGED-PRICING',
          name: '伪造计价单位',
          symbol: 'FORGED',
          quantityScale: 0,
        },
        factor: '1.000000',
      },
    ],
    defaultPackagingSpec: '1.000000',
    recyclable: false,
    fixedFormula: null,
    remark: '',
    enabled: true,
  })
  assert.deepEqual(product.snapshot.productType, {
    id: auxIds[1],
    code: 'TST-0002',
    name: '测试引用 2',
    behaviorProfile: 'RAW_MATERIAL',
  })
  assert.deepEqual(product.snapshot.pricingUnit, {
    id: auxIds[3],
    code: 'TST-0004',
    name: '测试引用 4',
    symbol: 'kg',
    quantityScale: 3,
  })
  assert.deepEqual(product.snapshot.unitConversions, [
    {
      unit: {
        id: auxIds[3],
        code: 'TST-0004',
        name: '测试引用 4',
        symbol: 'kg',
        quantityScale: 3,
      },
      factor: '1.000000',
    },
  ])
  await db
    .updateTable('aux_objects')
    .set({
      data: JSON.stringify({
        name: '测试引用 2',
        behaviorProfile: 'STANDARD_FINISHED',
        description: '',
      }),
    })
    .where('id', '=', auxIds[1]!)
    .execute()
  const formulaSnapshot = {
    name: '固定配方成品',
    barcode: 'barcode-002',
    specification: '1kg',
    model: 'F1',
    productType: {
      id: auxIds[1],
      code: 'FORGED-PRODUCT-TYPE',
      name: '伪造产品类型',
      behaviorProfile: 'RAW_MATERIAL',
    },
    productCategory: {
      id: auxIds[2],
      code: 'FORGED-CATEGORY',
      name: '伪造分类',
    },
    pricingUnit: {
      id: auxIds[3],
      code: 'FORGED-UNIT',
      name: '伪造单位',
      symbol: 'FORGED',
      quantityScale: 0,
    },
    defaultInputUnit: {
      id: auxIds[3],
      code: 'FORGED-UNIT',
      name: '伪造单位',
      symbol: 'FORGED',
      quantityScale: 0,
    },
    unitConversions: [
      {
        unit: {
          id: auxIds[3],
          code: 'FORGED-UNIT',
          name: '伪造单位',
          symbol: 'FORGED',
          quantityScale: 0,
        },
        factor: '1.000000',
      },
    ],
    defaultPackagingSpec: '1.000000',
    recyclable: false,
    fixedFormula: {
      output: {
        enteredQuantity: '1.000000',
        enteredUnit: {
          id: auxIds[3],
          code: 'FORGED-UNIT',
          name: '伪造单位',
          symbol: 'FORGED',
          quantityScale: 0,
        },
        baseQuantity: '1.000000',
      },
      components: [
        {
          material: {
            objectId: product.subjectId,
            approvalEntryId: product.submissionId,
            code: 'FORGED-MATERIAL',
            name: '伪造原料名',
          },
          quantity: {
            enteredQuantity: '0.500000',
            enteredUnit: {
              id: auxIds[3],
              code: 'FORGED-UNIT',
              name: '伪造单位',
              symbol: 'FORGED',
              quantityScale: 0,
            },
            baseQuantity: '0.500000',
          },
          resolutionStatus: 'CURRENT',
          requiresConfirmation: false,
        },
      ],
    },
    remark: '',
    enabled: true,
  }
  const formulaProduct = await submitAndApprove('product', formulaSnapshot)
  assert.equal(
    (formulaProduct.snapshot.fixedFormula as Record<string, unknown>) !== null,
    true,
  )
  assert.deepEqual(formulaProduct.snapshot.productType, {
    id: auxIds[1],
    code: 'TST-0002',
    name: '测试引用 2',
    behaviorProfile: 'STANDARD_FINISHED',
  })
  const persistedFormula = await db
    .selectFrom('bob_product_versions')
    .select(['unit_conversions', 'fixed_formula'])
    .where('approval_entry_id', '=', formulaProduct.submissionId)
    .executeTakeFirstOrThrow()
  assert.equal(Array.isArray(persistedFormula.unit_conversions), true)
  assert.equal(persistedFormula.fixed_formula !== null, true)
  const invalidProductSubjectId = ulid()
  subjectIds.push(invalidProductSubjectId)
  await assert.rejects(
    bobArchives.submit(
      'product',
      'submit-new',
      {
        subjectId: invalidProductSubjectId,
        submissionId: ulid(),
        idempotencyKey: ulid(),
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          ...formulaSnapshot,
          productCategory: {
            id: ulid(),
            code: 'MISSING',
            name: '不存在',
          },
        },
      },
      submitter,
      ulid(),
    ),
    (error: unknown) =>
      error instanceof BobArchiveApplicationError &&
      error.errorKey === 'product_reference_unavailable',
  )
  await db
    .updateTable('aux_objects')
    .set({ data: JSON.stringify({ name: '损坏单位', quantityScale: 3 }) })
    .where('id', '=', auxIds[3]!)
    .execute()
  const malformedUnitSubjectId = ulid()
  subjectIds.push(malformedUnitSubjectId)
  await assert.rejects(
    bobArchives.submit(
      'product',
      'submit-new',
      {
        subjectId: malformedUnitSubjectId,
        submissionId: ulid(),
        idempotencyKey: ulid(),
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: { ...formulaSnapshot, barcode: 'barcode-003' },
      },
      submitter,
      ulid(),
    ),
    (error: unknown) =>
      error instanceof BobArchiveApplicationError &&
      error.errorKey === 'product_reference_unavailable',
  )
  await db
    .updateTable('aux_objects')
    .set({
      data: JSON.stringify({
        name: '测试引用 4',
        symbol: 'kg',
        quantityScale: 3,
      }),
    })
    .where('id', '=', auxIds[3]!)
    .execute()
  const createdEmployee = await aux.create(
    'employee',
    {
      identityKind: 'PERSON',
      legalName: '采购员甲',
      displayName: '采购员甲',
      legalIdentifier: 'EMPLOYEE-001',
      contactName: '采购员甲',
      phone: '13900000000',
      address: '厦门市',
      employeeCategoryId: auxIds[5]!,
      departmentId: auxIds[6]!,
      positionId: auxIds[7]!,
      employmentDate: '2026-09-01',
      workPhone: '0592-1000000',
      workEmail: 'buyer@example.test',
      operatingEntityId: operatingEntity.id,
      remark: '',
    },
    peopleActor,
  )
  currentPeopleIds.push(createdEmployee.id)
  const employee = await aux.get(
    'employee',
    { id: createdEmployee.id },
    peopleActor,
  )
  const employeeReference = {
    objectId: employee.id,
    code: employee.code,
    name: employee.name,
  }
  const identityBase = {
    identityKind: 'ORGANIZATION',
    legalName: '档案合作方',
    displayName: '合作方',
    legalIdentifier: 'PARTNER-001',
    contactName: '联系人',
    phone: '13700000000',
    address: '厦门市',
    operatingEntities: [operatingEntityReference],
    defaultOperatingEntityId: operatingEntity.id,
    remark: '',
  }
  const supplier = await submitAndApprove('supplier', {
    ...identityBase,
    legalIdentifier: 'SUPPLIER-001',
    settlementMethod: null,
    defaultPurchaser: employeeReference,
  })
  const otherUnit = await submitAndApprove('other-unit', {
    ...identityBase,
    legalIdentifier: 'OTHER-UNIT-001',
    settlementMethod: null,
  })
  const salesPartner = await submitAndApprove('sales-partner', {
    ...identityBase,
    legalIdentifier: 'SALES-PARTNER-001',
    capabilities: ['CHANNEL_PARTNER'],
  })
  for (const archive of [supplier, otherUnit, salesPartner]) {
    assert.equal('enabled' in archive.snapshot, false)
    const persisted = await db
      .selectFrom('approval_entries')
      .select('domain')
      .where('id', '=', archive.submissionId)
      .executeTakeFirstOrThrow()
    assert.equal(persisted.domain, 'bob')
    const subject = await db
      .selectFrom('bob_subjects')
      .select(['enabled', 'revision'])
      .where('id', '=', archive.subjectId)
      .executeTakeFirstOrThrow()
    assert.equal(subject.enabled, true)
    assert.equal(String(subject.revision), '1')
    assert.equal(
      await db
        .selectFrom('dcl_subjects')
        .select('id')
        .where('id', '=', archive.subjectId)
        .executeTakeFirst(),
      undefined,
    )
  }
  assert.equal(
    (
      await bobArchives.query(
        'supplier',
        { page: 1, pageSize: 20, filters: { enabled: true } },
        reviewer,
      )
    ).items.some((item) => item.subjectId === supplier.subjectId),
    true,
  )
  assert.equal(
    (
      await bobArchives.query(
        'supplier',
        { page: 1, pageSize: 20, filters: { enabled: false } },
        reviewer,
      )
    ).items.some((item) => item.subjectId === supplier.subjectId),
    false,
  )

  const attachment = Buffer.from('%PDF-1.7 customer identity attachment')
  const attachmentId = ulid()
  const stagingId = ulid()
  const digest = createHash('sha256').update(attachment).digest('hex')
  await bobArchives.stageCustomerAttachment(
    {
      stagingId,
      fileId: attachmentId,
      fileName: 'identity.pdf',
      mimeType: 'application/pdf',
      size: attachment.length,
      digest,
      contentBase64: attachment.toString('base64'),
    },
    submitter,
  )
  const stagedAttachment = await sql<{ storage_key: string }>`
    SELECT storage_key FROM bob_customer_attachment_staging WHERE id = ${stagingId}
  `.execute(db)
  assert.deepEqual(
    await attachmentStore.read(stagedAttachment.rows[0]!.storage_key),
    attachment,
  )
  const failedStagingId = ulid()
  const failedAttachmentId = ulid()
  await bobArchives.stageCustomerAttachment(
    {
      stagingId: failedStagingId,
      fileId: failedAttachmentId,
      fileName: 'retry.pdf',
      mimeType: 'application/pdf',
      size: attachment.length,
      digest,
      contentBase64: attachment.toString('base64'),
    },
    submitter,
  )
  const failedStaging = await db
    .selectFrom('bob_customer_attachment_staging')
    .select('storage_key')
    .where('id', '=', failedStagingId)
    .executeTakeFirstOrThrow()
  const failedSubjectId = ulid(),
    failedSubmissionId = ulid()
  subjectIds.push(failedSubjectId)
  await assert.rejects(
    bobArchives.submit(
      'customer',
      'submit-new',
      {
        subjectId: failedSubjectId,
        submissionId: failedSubmissionId,
        idempotencyKey: failedSubmissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          identityKind: 'OTHER',
          legalName: '失败附件客户',
          displayName: '失败附件客户',
          legalIdentifier: 'FAILED-ATTACHMENT-CUSTOMER',
          phone: '',
          email: '',
          address: '',
          invoiceTitle: '',
          invoiceAddress: '',
          invoicePhone: '',
          invoiceBank: '',
          invoiceAccount: '',
          remittanceProfiles: [],
          defaultOperatingEntity: null,
          identityAttachments: [
            {
              id: failedAttachmentId,
              fileName: 'retry.pdf',
              contentType: 'application/pdf',
              sizeBytes: attachment.length,
              sha256: digest,
              stagingId: failedStagingId,
            },
          ],
          subunits: [],
          enabled: true,
        },
      },
      submitter,
      ulid(),
    ),
    (error: unknown) => error instanceof BobArchiveApplicationError,
  )
  assert.ok(
    await db
      .selectFrom('bob_customer_attachment_staging')
      .select('id')
      .where('id', '=', failedStagingId)
      .executeTakeFirst(),
    'failed submit keeps its staged attachment for retry',
  )
  await db
    .updateTable('bob_customer_attachment_staging')
    .set({ created_at: new Date(-1_000), expires_at: new Date(0) })
    .where('id', '=', failedStagingId)
    .execute()
  assert.deepEqual(await bobArchives.cleanupCustomerAttachments(submitter), {
    deleted: 1,
  })
  await assert.rejects(attachmentStore.read(failedStaging.storage_key))
  assert.equal(
    await db
      .selectFrom('bob_customer_attachment_staging')
      .select('id')
      .where('id', '=', failedStagingId)
      .executeTakeFirst(),
    undefined,
  )
  await db
    .insertInto('attachment_deletion_jobs')
    .values({ storage_key: failedStaging.storage_key, created_at: new Date() })
    .execute()
  const restaged = await bobArchives.stageCustomerAttachment(
    {
      stagingId: failedStagingId,
      fileId: failedAttachmentId,
      fileName: 'retry.pdf',
      mimeType: 'application/pdf',
      size: attachment.length,
      digest,
      contentBase64: attachment.toString('base64'),
    },
    submitter,
  )
  assert.ok(new Date(restaged.expiresAt) > new Date())
  assert.equal(
    await db
      .selectFrom('attachment_deletion_jobs')
      .select('storage_key')
      .where('storage_key', '=', failedStaging.storage_key)
      .executeTakeFirst(),
    undefined,
  )
  await db
    .insertInto('attachment_deletion_jobs')
    .values({ storage_key: failedStaging.storage_key, created_at: new Date() })
    .execute()
  assert.deepEqual(await bobArchives.cleanupCustomerAttachments(submitter), {
    deleted: 0,
  })
  assert.deepEqual(
    await attachmentStore.read(failedStaging.storage_key),
    attachment,
  )
  assert.equal(
    await db
      .selectFrom('attachment_deletion_jobs')
      .select('storage_key')
      .where('storage_key', '=', failedStaging.storage_key)
      .executeTakeFirst(),
    undefined,
  )
  await db
    .updateTable('bob_customer_attachment_staging')
    .set({ created_at: new Date(-1_000), expires_at: new Date(0) })
    .where('id', '=', failedStagingId)
    .execute()
  assert.deepEqual(await bobArchives.cleanupCustomerAttachments(submitter), {
    deleted: 1,
  })
  assert.deepEqual(await bobArchives.cleanupCustomerAttachments(submitter), {
    deleted: 0,
  })
  const customerSnapshot = {
    identityKind: 'OTHER',
    legalName: '全聚合客户',
    displayName: '全聚合客户',
    legalIdentifier: 'CUSTOMER-001',
    phone: '13600000000',
    email: 'customer@example.test',
    address: '厦门市',
    invoiceTitle: '全聚合客户',
    invoiceAddress: '厦门市',
    invoicePhone: '0592-7654321',
    invoiceBank: '目标银行',
    invoiceAccount: '622200002',
    remittanceProfiles: [],
    defaultOperatingEntity: operatingEntityReference,
    identityAttachments: [
      {
        id: attachmentId,
        fileName: 'identity.pdf',
        contentType: 'application/pdf',
        sizeBytes: attachment.length,
        sha256: digest,
        stagingId,
      },
    ],
    subunits: [
      {
        id: ulid(),
        intent: 'NEW',
        code: null,
        name: '总部',
        contactName: '客户联系人',
        address: '厦门市',
        customerType: {
          id: auxIds[0],
          code: 'FORGED-CUSTOMER-TYPE',
          name: '伪造客户类型',
        },
        settlementMethod: {
          id: auxIds[8],
          code: 'TST-0009',
          name: '测试引用 9',
          termCode: 'MONTHLY_30',
          ruleType: 'MONTH_END',
          monthOffset: 1,
          dayOfMonth: 0,
          dayOffset: 0,
          defaultSalesSurcharge: '0.10',
        },
        paymentMethod: {
          id: auxIds[9],
          code: 'TST-0010',
          name: '测试引用 10',
          defaultSalesSurcharge: '0.05',
        },
        transportPolicy: {
          methodCode: 'DELIVERY',
          methodName: '送货',
          surcharge: '0.00',
        },
        pricingPolicy: {
          defaultPremiumUnitPrice: '0.00',
          defaultDiscountUnitPrice: '0.00',
          costItems: [],
          thirdPartyIntermediaryFixedUnitCost: '0.00',
          thirdPartyIntermediaryVariableUnitCost: '0.00',
        },
        creditLimits: [{ currency: 'CNY', amount: '10000.00' }],
        primarySalesAttribution: {
          type: 'INTERNAL_EMPLOYEE',
          objectId: employee.id,
          code: 'FORGED-EMPLOYEE',
          name: '伪造业务员',
        },
        internalReminder: '',
        defaultSalesOrderRemark: '',
        attachments: [],
        enabled: true,
      },
    ],
  }
  for (const malformed of [
    {
      id: auxIds[8]!,
      data: {
        name: '测试引用 9',
        termCode: 'MONTHLY_30',
        ruleType: 'MONTH_END',
        monthOffset: 1,
        dayOfMonth: 0,
        dayOffset: 0,
        description: '',
      },
      restored: {
        name: '测试引用 9',
        termCode: 'MONTHLY_30',
        ruleType: 'MONTH_END',
        monthOffset: 1,
        dayOfMonth: 0,
        dayOffset: 0,
        defaultSalesSurcharge: '0.10',
        description: '',
      },
    },
    {
      id: auxIds[9]!,
      data: {
        name: '测试引用 10',
        defaultSalesSurcharge: 'invalid',
        description: '',
      },
      restored: {
        name: '测试引用 10',
        defaultSalesSurcharge: '0.05',
        description: '',
      },
    },
  ]) {
    await db
      .updateTable('aux_objects')
      .set({ data: JSON.stringify(malformed.data) })
      .where('id', '=', malformed.id)
      .execute()
    const malformedSubjectId = ulid()
    const malformedSubmissionId = ulid()
    subjectIds.push(malformedSubjectId)
    const adopted = await bobArchives.submit(
      'customer',
      'submit-new',
      {
        subjectId: malformedSubjectId,
        submissionId: malformedSubmissionId,
        idempotencyKey: malformedSubmissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          ...customerSnapshot,
          legalIdentifier: `ADOPTED-${malformedSubjectId}`,
          identityAttachments: [],
          subunits: customerSnapshot.subunits.map((subunit) => ({
            ...subunit,
            id: ulid(),
          })),
        },
      },
      submitter,
      ulid(),
    )
    const adoptedSubunit = (
      adopted.snapshot.subunits as Array<Record<string, unknown>>
    )[0]!
    assert.deepEqual(
      adoptedSubunit.settlementMethod,
      customerSnapshot.subunits[0]!.settlementMethod,
    )
    assert.deepEqual(
      adoptedSubunit.paymentMethod,
      customerSnapshot.subunits[0]!.paymentMethod,
    )
    await bobArchives.delete(
      'customer',
      {
        subjectId: malformedSubjectId,
        submissionId: malformedSubmissionId,
        expectedRevision: adopted.revision,
      },
      submitter,
      ulid(),
    )
    await db
      .updateTable('aux_objects')
      .set({ data: JSON.stringify(malformed.restored) })
      .where('id', '=', malformed.id)
      .execute()
  }
  const customer = await submitAndApprove('customer', customerSnapshot)
  const customerSubunit = (
    customer.snapshot.subunits as Array<Record<string, unknown>>
  )[0]!
  assert.deepEqual(customerSubunit.customerType, {
    id: auxIds[0],
    code: 'TST-0001',
    name: '测试引用 1',
  })
  assert.deepEqual(customerSubunit.settlementMethod, {
    id: auxIds[8],
    code: 'TST-0009',
    name: '测试引用 9',
    termCode: 'MONTHLY_30',
    ruleType: 'MONTH_END',
    monthOffset: 1,
    dayOfMonth: 0,
    dayOffset: 0,
    defaultSalesSurcharge: '0.10',
  })
  assert.deepEqual(customerSubunit.paymentMethod, {
    id: auxIds[9],
    code: 'TST-0010',
    name: '测试引用 10',
    defaultSalesSurcharge: '0.05',
  })
  const persistedCustomerType = await db
    .selectFrom('bob_customer_version_subunits')
    .select('customer_type_snapshot')
    .where('customer_approval_entry_id', '=', customer.submissionId)
    .executeTakeFirstOrThrow()
  assert.deepEqual(persistedCustomerType.customer_type_snapshot, {
    id: auxIds[0],
    code: 'TST-0001',
    name: '测试引用 1',
  })
  assert.equal(
    await db
      .selectFrom('bob_customer_attachments')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('approval_entry_id', '=', customer.submissionId)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    1,
  )
  assert.equal(
    await db
      .selectFrom('bob_customer_attachment_staging')
      .select('id')
      .where('id', '=', stagingId)
      .executeTakeFirst(),
    undefined,
  )
  const permanentAttachment = await sql<{ storage_key: string }>`
    SELECT storage_key FROM bob_customer_attachments
    WHERE approval_entry_id = ${customer.submissionId} AND file_id = ${attachmentId}
  `.execute(db)
  assert.deepEqual(
    await attachmentStore.read(permanentAttachment.rows[0]!.storage_key),
    attachment,
  )

  const deletedStagingId = ulid()
  const deletedAttachmentId = ulid()
  await bobArchives.stageCustomerAttachment(
    {
      stagingId: deletedStagingId,
      fileId: deletedAttachmentId,
      fileName: 'delete-me.pdf',
      mimeType: 'application/pdf',
      size: attachment.length,
      digest,
      contentBase64: attachment.toString('base64'),
    },
    submitter,
  )
  const deletedCustomerSubjectId = ulid()
  const deletedCustomerSubmissionId = ulid()
  subjectIds.push(deletedCustomerSubjectId)
  const deletedCustomer = await bobArchives.submit(
    'customer',
    'submit-new',
    {
      subjectId: deletedCustomerSubjectId,
      submissionId: deletedCustomerSubmissionId,
      idempotencyKey: deletedCustomerSubmissionId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot: {
        ...customerSnapshot,
        legalName: '待删除客户',
        displayName: '待删除客户',
        legalIdentifier: 'CUSTOMER-DELETE-001',
        identityAttachments: [
          {
            id: deletedAttachmentId,
            fileName: 'delete-me.pdf',
            contentType: 'application/pdf',
            sizeBytes: attachment.length,
            sha256: digest,
            stagingId: deletedStagingId,
          },
        ],
        subunits: customerSnapshot.subunits.map((subunit) => ({
          ...subunit,
          id: ulid(),
        })),
      },
    },
    submitter,
    ulid(),
  )
  const deletedPermanentKey = `permanent/bob/customer/${deletedCustomerSubmissionId}/${deletedAttachmentId}`
  assert.deepEqual(await attachmentStore.read(deletedPermanentKey), attachment)
  await bobArchives.delete(
    'customer',
    {
      subjectId: deletedCustomerSubjectId,
      submissionId: deletedCustomerSubmissionId,
      expectedRevision: deletedCustomer.revision,
    },
    submitter,
    ulid(),
  )
  await assert.rejects(
    attachmentStore.read(deletedPermanentKey),
    /attachment_not_found/,
  )
  assert.equal(
    await db
      .selectFrom('attachment_deletion_jobs')
      .select('storage_key')
      .where('storage_key', '=', deletedPermanentKey)
      .executeTakeFirst(),
    undefined,
  )

  for (const entity of [
    'product',
    'supplier',
    'customer',
    'other-unit',
    'sales-partner',
  ] as const) {
    const items = await bobArchives.query(
      entity,
      { page: 1, pageSize: 20, filters: {} },
      reviewer,
    )
    const item = items.items.find((candidate) =>
      subjectIds.includes(candidate.subjectId),
    )
    assert.ok(item, entity)
    for (const submission of [item.latestApproved, item.openCandidate])
      if (submission) assert.ok(!('snapshot' in submission), entity)
  }

  const unitActor = {
    id: submitterId,
    permissions: ['get', 'save', 'disable', 'delete'].map(
      (action) => `/aux/measurement-unit/${action}`,
    ),
  }
  const unitBefore = await aux.get(
    'measurement-unit',
    { id: auxIds[3]! },
    unitActor,
  )
  const unitChanged = await aux.save(
    'measurement-unit',
    {
      id: unitBefore.id,
      revision: unitBefore.revision,
      name: '新的单位名称',
      symbol: 'new',
      quantityScale: 6,
    },
    unitActor,
  )
  const disabledUnit = await aux.disable(
    'measurement-unit',
    { id: unitBefore.id, revision: unitChanged.revision },
    unitActor,
    ulid(),
  )
  const historicalProduct = await bobArchives.get(
    'product',
    product.subjectId,
    reviewer,
    product.submissionId,
  )
  assert.deepEqual(historicalProduct.snapshot.pricingUnit, {
    id: auxIds[3],
    code: 'TST-0004',
    name: '测试引用 4',
    symbol: 'kg',
    quantityScale: 3,
  })
  await assert.rejects(
    () =>
      aux.delete(
        'measurement-unit',
        { id: unitBefore.id, revision: disabledUnit.revision },
        unitActor,
      ),
    (error: unknown) => {
      assert.ok(error instanceof AuxApplicationError)
      assert.equal(error.errorKey, 'conflict')
      const { blockers } = error.data as {
        blockers: Array<{ source: string; count: number }>
      }
      assert.ok(
        blockers.some(
          (blocker) =>
            blocker.source === 'bob_product_versions' && blocker.count > 0,
        ),
      )
      return true
    },
  )
  assert.equal(
    (await aux.get('measurement-unit', { id: unitBefore.id }, unitActor))
      .revision,
    disabledUnit.revision,
  )
  const rejectedUnitSubjectId = ulid()
  subjectIds.push(rejectedUnitSubjectId)
  await assert.rejects(
    bobArchives.submit(
      'product',
      'submit-new',
      {
        subjectId: rejectedUnitSubjectId,
        submissionId: ulid(),
        idempotencyKey: ulid(),
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: { ...formulaSnapshot, barcode: 'disabled-unit-387' },
      },
      submitter,
      ulid(),
    ),
    (error: unknown) =>
      error instanceof BobArchiveApplicationError &&
      error.errorKey === 'product_reference_unavailable',
  )
  const auxActor = {
    id: submitterId,
    permissions: [
      '/aux/payment-method/get',
      '/aux/payment-method/save',
      '/aux/payment-method/disable',
    ],
  }
  const paymentBefore = await aux.get(
    'payment-method',
    { id: auxIds[9]! },
    auxActor,
  )
  const paymentChanged = await aux.save(
    'payment-method',
    {
      id: paymentBefore.id,
      revision: paymentBefore.revision,
      name: '新收款名称',
      defaultSalesSurcharge: '0.06',
      description: '',
    },
    auxActor,
  )
  const paymentDisabled = await aux.disable(
    'payment-method',
    { id: paymentBefore.id, revision: paymentChanged.revision },
    auxActor,
    ulid(),
  )
  assert.equal(paymentDisabled.enabled, false)
  const rejectedCustomerSubjectId = ulid()
  const rejectedCustomerSubmissionId = ulid()
  subjectIds.push(rejectedCustomerSubjectId)
  const retainedCustomer = await bobArchives.submit(
    'customer',
    'submit-new',
    {
      subjectId: rejectedCustomerSubjectId,
      submissionId: rejectedCustomerSubmissionId,
      idempotencyKey: rejectedCustomerSubmissionId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot: {
        ...customerSnapshot,
        legalName: '保留已经采用的收款快照',
        displayName: '保留已经采用的收款快照',
        legalIdentifier: 'CUSTOMER-DISABLED-AUX-001',
        identityAttachments: [],
        subunits: customerSnapshot.subunits.map((subunit) => ({
          ...subunit,
          id: ulid(),
        })),
      },
    },
    submitter,
    ulid(),
  )
  assert.deepEqual(
    (retainedCustomer.snapshot.subunits as Array<Record<string, unknown>>)[0]!
      .paymentMethod,
    customerSubunit.paymentMethod,
  )
  const historicalCustomer = await bobArchives.get(
    'customer',
    customer.subjectId,
    reviewer,
    customer.submissionId,
  )
  const historicalSubunit = (
    historicalCustomer.snapshot.subunits as Array<Record<string, unknown>>
  )[0]!
  assert.deepEqual(
    historicalSubunit.paymentMethod,
    customerSubunit.paymentMethod,
  )
  assert.deepEqual(
    historicalSubunit.settlementMethod,
    customerSubunit.settlementMethod,
  )
  const paymentAfter = await aux.get(
    'payment-method',
    { id: paymentBefore.id },
    auxActor,
  )
  assert.equal(paymentAfter.enabled, false)
  assert.equal(paymentAfter.revision, paymentDisabled.revision)
  assert.equal(paymentAfter.defaultSalesSurcharge, '0.06')
})
