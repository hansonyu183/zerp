import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { sql } from 'kysely'
import { ulid } from 'ulid'

import { createDatabase } from '../../src/db/database.ts'
import {
  ArchiveApplicationError,
  ArchiveService,
} from '../../src/dcl/archives.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('business-key and referenced-entry locks admit at most one concurrent writer', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const service = new ArchiveService(db)
  const submitterId = ulid(),
    reviewerId = ulid()
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
  const snapshot = (legalIdentifier: string) => ({
    legalName: '并发锁经营主体',
    legalIdentifier,
    registeredAddress: '上海市',
    contactName: '锁测试',
    contactPhone: '13800000000',
    invoiceTitle: '并发锁经营主体',
    invoiceAddress: '上海市',
    invoicePhone: '021-10000000',
    invoiceBank: '测试银行',
    invoiceAccount: '62220000',
    remark: '',
    enabled: true,
  })
  context.after(async () => {
    try {
      await db
        .deleteFrom('dcl_archive_idempotency')
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
      await db
        .deleteFrom('dcl_subjects')
        .where('id', 'in', subjectIds)
        .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [submitterId, reviewerId])
        .execute()
    } finally {
      await db.destroy()
    }
  })
  await db
    .insertInto('app_users')
    .values(
      [submitterId, reviewerId].map((id) => ({
        id,
        username: `archive-lock-${id}`,
        display_name: 'Archive lock test',
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      })),
    )
    .execute()

  const key = '91310000MA1K12345X'
  const contenders = await Promise.allSettled(
    [0, 1].map((index) => {
      const subjectId = ulid(),
        submissionId = ulid()
      subjectIds.push(subjectId)
      return service.submit(
        'operating-entity',
        'submit-new',
        {
          subjectId,
          submissionId,
          idempotencyKey: submissionId,
          expectedLatestApprovedSubmissionId: null,
          expectedLatestApprovedRevision: null,
          snapshot: snapshot(key),
        },
        submitter,
        `business-key-${index}`,
      )
    }),
  )
  const accepted = contenders.filter(
    (
      result,
    ): result is PromiseFulfilledResult<
      Awaited<ReturnType<ArchiveService['submit']>>
    > => result.status === 'fulfilled',
  )
  assert.equal(accepted.length, 1)
  const rejected = await service.review(
    'operating-entity',
    'reject',
    {
      subjectId: accepted[0]!.value.subjectId,
      submissionId: accepted[0]!.value.submissionId,
      expectedRevision: accepted[0]!.value.revision,
      reason: '验证 REJECTED 仍占用业务键',
    },
    reviewer,
    ulid(),
  )
  assert.equal(rejected.status, 'REJECTED')
  const afterRejectedSubject = ulid(),
    afterRejectedSubmission = ulid()
  subjectIds.push(afterRejectedSubject)
  await assert.rejects(
    service.submit(
      'operating-entity',
      'submit-new',
      {
        subjectId: afterRejectedSubject,
        submissionId: afterRejectedSubmission,
        idempotencyKey: afterRejectedSubmission,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: snapshot(key),
      },
      submitter,
      ulid(),
    ),
    (error: unknown) =>
      error instanceof ArchiveApplicationError &&
      error.errorKey === 'operating_entity_duplicate_legal_identifier',
  )

  const ordinarySubmitter = {
    id: submitterId,
    permissions: ['/dcl/operating-entity/submit-new'],
    trusted: false,
  }
  const ordinaryReviewer = {
    id: reviewerId,
    permissions: ['/dcl/operating-entity/approve'],
    trusted: false,
  }
  const splitSubjectId = ulid(),
    splitSubmissionId = ulid()
  subjectIds.push(splitSubjectId)
  const splitPending = await service.submit(
    'operating-entity',
    'submit-new',
    {
      subjectId: splitSubjectId,
      submissionId: splitSubmissionId,
      idempotencyKey: splitSubmissionId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot: snapshot('91310000MA1K54321X'),
    },
    ordinarySubmitter,
    ulid(),
  )
  const splitApproved = await service.review(
    'operating-entity',
    'approve',
    {
      subjectId: splitSubjectId,
      submissionId: splitSubmissionId,
      expectedRevision: splitPending.revision,
    },
    ordinaryReviewer,
    ulid(),
  )
  assert.equal(splitApproved.status, 'APPROVED')

  const targetSubjectId = ulid(),
    targetSubmissionId = ulid()
  subjectIds.push(targetSubjectId)
  const target = await service.submit(
    'operating-entity',
    'submit-new',
    {
      subjectId: targetSubjectId,
      submissionId: targetSubmissionId,
      idempotencyKey: targetSubmissionId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot: snapshot('91310000MA1K12346X'),
    },
    submitter,
    ulid(),
  )
  const targetApproved = await service.review(
    'operating-entity',
    'approve',
    {
      subjectId: targetSubjectId,
      submissionId: targetSubmissionId,
      expectedRevision: target.revision,
    },
    reviewer,
    ulid(),
  )
  const fundSubjectId = ulid(),
    fundSubmissionId = ulid()
  subjectIds.push(fundSubjectId)
  const referenceRace = await Promise.allSettled([
    service.submit(
      'fund-account',
      'submit-new',
      {
        subjectId: fundSubjectId,
        submissionId: fundSubmissionId,
        idempotencyKey: fundSubmissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          name: '竞态账户',
          currency: 'CNY',
          accountName: '锁测试',
          bank: '测试银行',
          branch: '',
          accountNumber: '6222-LOCK',
          remark: '',
          enabled: true,
          operatingEntity: {
            objectId: targetSubjectId,
            approvalEntryId: targetSubmissionId,
            code: targetApproved.code!,
            name: '伪造显示名',
          },
        },
      },
      submitter,
      ulid(),
    ),
    service.review(
      'operating-entity',
      'unapprove',
      {
        subjectId: targetSubjectId,
        submissionId: targetSubmissionId,
        expectedRevision: targetApproved.revision,
        reason: '并发引用验证',
      },
      reviewer,
      ulid(),
    ),
  ])
  assert.equal(
    referenceRace.filter((result) => result.status === 'fulfilled').length,
    1,
  )
})

test('typed DCL archives persist idempotent V1/V2 lifecycle and derive current from approvals', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const submitterId = ulid()
  const reviewerId = ulid()
  const subjectId = ulid()
  const v1Id = ulid()
  const v2Id = ulid()
  const service = new ArchiveService(db)
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

  context.after(async () => {
    try {
      await db
        .deleteFrom('dcl_archive_idempotency')
        .where('subject_id', '=', subjectId)
        .execute()
      await db
        .deleteFrom('approval_events')
        .where('subject_id', '=', subjectId)
        .execute()
      await db.deleteFrom('approval_entries').where('subject_id', '=', subjectId).execute()
      await db.deleteFrom('dcl_subjects').where('id', '=', subjectId).execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [submitterId, reviewerId])
        .execute()
    } finally {
      await db.destroy()
    }
  })

  await db
    .insertInto('app_users')
    .values([
      {
        id: submitterId,
        username: `archive-submitter-${submitterId}`,
        display_name: 'Archive Submitter',
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      },
      {
        id: reviewerId,
        username: `archive-reviewer-${reviewerId}`,
        display_name: 'Archive Reviewer',
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      },
    ])
    .execute()

  const snapshot = {
    legalName: '  上海目标科技有限公司  ',
    legalIdentifier: '91310000MA1K12345X',
    registeredAddress: '上海市',
    contactName: '张三',
    contactPhone: '13800000000',
    invoiceTitle: '上海目标科技有限公司',
    invoiceAddress: '上海市',
    invoicePhone: '021-12345678',
    invoiceBank: '目标银行',
    invoiceAccount: '62220001',
    remark: '',
    enabled: true,
  }
  const v1Input = {
    subjectId,
    submissionId: v1Id,
    idempotencyKey: v1Id,
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot,
  }
  const v1 = await service.submit(
    'operating-entity',
    'submit-new',
    v1Input,
    submitter,
    ulid(),
  )
  assert.match(v1.code ?? '', /^OPE-\d{4}$/)
  assert.equal(v1.versionNo, 1)
  assert.equal(v1.status, 'PENDING')
  assert.equal(v1.snapshot.legalName, '上海目标科技有限公司')

  const retried = await service.submit(
    'operating-entity',
    'submit-new',
    v1Input,
    submitter,
    ulid(),
  )
  assert.deepEqual(retried, v1)
  await assert.rejects(
    service.submit(
      'operating-entity',
      'submit-new',
      { ...v1Input, snapshot: { ...snapshot, legalName: '不同内容' } },
      submitter,
      ulid(),
    ),
    (error: unknown) =>
      error instanceof ArchiveApplicationError &&
      error.errorKey === 'archive_idempotency_conflict',
  )

  const approvedV1 = await service.review(
    'operating-entity',
    'approve',
    {
      subjectId,
      submissionId: v1Id,
      expectedRevision: v1.revision,
    },
    reviewer,
    ulid(),
  )
  assert.equal(approvedV1.status, 'APPROVED')

  const v2 = await service.submit(
    'operating-entity',
    'submit-change',
    {
      subjectId,
      submissionId: v2Id,
      idempotencyKey: v2Id,
      expectedLatestApprovedSubmissionId: v1Id,
      expectedLatestApprovedRevision: approvedV1.revision,
      snapshot: { ...snapshot, legalName: '上海目标科技二期有限公司' },
    },
    submitter,
    ulid(),
  )
  const approvedV2 = await service.review(
    'operating-entity',
    'approve',
    {
      subjectId,
      submissionId: v2Id,
      expectedRevision: v2.revision,
    },
    reviewer,
    ulid(),
  )
  assert.equal(approvedV2.status, 'APPROVED')
  const rolledBack = await service.review(
    'operating-entity',
    'unapprove',
    {
      subjectId,
      submissionId: v2Id,
      expectedRevision: approvedV2.revision,
      reason: '回落验证',
    },
    reviewer,
    ulid(),
  )
  assert.equal(rolledBack.status, 'PENDING')

  const current = await service.query(
    'operating-entity',
    { page: 1, pageSize: 20, filters: {} },
    reviewer,
  )
  assert.deepEqual(
    current.items.map((item) => [
      item.subjectId,
      item.latestApproved?.submissionId,
      item.latestApproved?.status,
      item.openCandidate?.submissionId,
      item.openCandidate?.status,
    ]),
    [[subjectId, v1Id, 'APPROVED', v2Id, 'PENDING']],
  )
  const pending = await service.query(
    'operating-entity',
    {
      page: 1,
      pageSize: 20,
      filters: {
        keyword: '91310000MA1K12345X',
        status: 'PENDING',
        enabled: true,
      },
    },
    reviewer,
  )
  assert.equal(pending.total, 1)
  assert.equal(pending.items[0]?.openCandidate?.submissionId, v2Id)
  const approved = await service.query(
    'operating-entity',
    {
      page: 2,
      pageSize: 20,
      filters: { keyword: '91310000MA1K12345X', status: 'APPROVED' },
    },
    reviewer,
  )
  assert.equal(approved.total, 1)
  assert.deepEqual(approved.items, [])
  assert.equal(
    (await service.versions('operating-entity', subjectId, reviewer)).length,
    2,
  )
  assert.deepEqual(
    (await service.auditHistory('operating-entity', subjectId, reviewer)).map(
      (event) => event.action,
    ),
    ['SUBMITTED', 'APPROVED', 'SUBMITTED', 'APPROVED', 'UNAPPROVED'],
  )
})

test('all issue 364 aggregates own typed PostgreSQL snapshots and customer attachment finalization', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const service = new ArchiveService(db)
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
  const auxIds = Array.from({ length: 8 }, () => ulid())
  const bookId = ulid()
  const vouEntityId = ulid()
  const accountId = ulid()

  context.after(async () => {
    try {
      if (subjectIds.length) {
        await db
          .deleteFrom('dcl_archive_idempotency')
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
      await db.deleteFrom('aux_objects').where('id', 'in', auxIds).execute()
      await sql`DELETE FROM dcl_acc_subject_facts WHERE id = ${accountId}`.execute(
        db,
      )
      await db
        .deleteFrom('dcl_acc_book_facts')
        .where('id', '=', bookId)
        .execute()
      await db
        .deleteFrom('dcl_acc_vou_entity_facts')
        .where('id', '=', vouEntityId)
        .execute()
      await db
        .deleteFrom('app_users')
        .where('id', 'in', [submitterId, reviewerId])
        .execute()
    } finally {
      await db.destroy()
    }
  })

  await db
    .insertInto('app_users')
    .values([
      {
        id: submitterId,
        username: `archive-all-submitter-${submitterId}`,
        display_name: 'All Archive Submitter',
        password_hash: 'unused',
        status: 'ENABLED',
        password_changed_at: new Date(),
        password_change_required: false,
      },
      {
        id: reviewerId,
        username: `archive-all-reviewer-${reviewerId}`,
        display_name: 'All Archive Reviewer',
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
          ...(index === 3 || index === 4 ? { quantityScale: 3 } : {}),
        }),
        enabled: true,
        created_by: submitterId,
        updated_by: submitterId,
      })),
    )
    .execute()
  await db
    .insertInto('dcl_acc_book_facts')
    .values({ id: bookId, code: 'BOOK-01', name: '测试账簿', enabled: true })
    .execute()
  await sql`INSERT INTO dcl_acc_vou_entity_facts (id, code, name, field_catalog, enabled)
    VALUES (${vouEntityId}, 'SALE', '销售凭证', ${JSON.stringify({ headerFields: ['status'], lineFields: ['amount', 'currency', 'customer'] })}::jsonb, true)`.execute(
    db,
  )
  await sql`INSERT INTO dcl_acc_subject_facts (id, book_id, code, name, leaf, enabled, required_dimensions)
    VALUES (${accountId}, ${bookId}, '1001', '测试科目', true, true, '["customer"]'::jsonb)`.execute(
    db,
  )

  async function submitAndApprove(
    entity: Parameters<ArchiveService['submit']>[0],
    snapshot: Record<string, unknown>,
  ) {
    const subjectId = ulid()
    const submissionId = ulid()
    subjectIds.push(subjectId)
    const pending = await service.submit(
      entity,
      'submit-new',
      {
        subjectId,
        submissionId,
        idempotencyKey: submissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot,
      },
      submitter,
      ulid(),
    )
    const approved = await service.review(
      entity,
      'approve',
      { subjectId, submissionId, expectedRevision: pending.revision },
      reviewer,
      ulid(),
    )
    assert.equal(approved.status, 'APPROVED')
    assert.deepEqual(approved.snapshot, pending.snapshot)
    assert.equal(
      (await service.auditHistory(entity, subjectId, reviewer)).length,
      2,
    )
    return approved
  }

  const operatingEntity = await submitAndApprove('operating-entity', {
    legalName: '全聚合经营主体',
    legalIdentifier: '91350211M000100Y4J',
    registeredAddress: '厦门市',
    contactName: '联系人',
    contactPhone: '13800000000',
    invoiceTitle: '全聚合经营主体',
    invoiceAddress: '厦门市',
    invoicePhone: '0592-1234567',
    invoiceBank: '目标银行',
    invoiceAccount: '622200001',
    remark: '',
    enabled: true,
  })
  const operatingEntityReference = {
    objectId: operatingEntity.subjectId,
    approvalEntryId: operatingEntity.submissionId,
    code: operatingEntity.code!,
    name: '全聚合经营主体',
  }

  const wrongTypeSubjectId = ulid()
  const wrongTypeSubmissionId = ulid()
  subjectIds.push(wrongTypeSubjectId)
  await assert.rejects(
    service.submit(
      'vehicle',
      'submit-new',
      {
        subjectId: wrongTypeSubjectId,
        submissionId: wrongTypeSubmissionId,
        idempotencyKey: wrongTypeSubmissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          name: '错误类型车辆',
          plateNumber: '闽D54321',
          vehicleType: { id: auxIds[1], code: 'FORGED', name: '伪造车型' },
          carrier: {
            kind: 'INTERNAL',
            operatingEntityId: operatingEntity.subjectId,
            approvalEntryId: operatingEntity.submissionId,
          },
          vin: 'VIN00000000000002',
          engineNumber: 'ENGINE-02',
          ratedLoadKg: 1,
          bulkWaterCarrier: false,
          remark: '',
          enabled: true,
        },
      },
      submitter,
      ulid(),
    ),
    (error: unknown) =>
      error instanceof ArchiveApplicationError &&
      error.errorKey === 'vehicle_reference_unavailable',
  )

  await submitAndApprove('vehicle', {
    name: '测试车辆',
    plateNumber: '闽D12345',
    vehicleType: { id: auxIds[0], code: 'TST-0001', name: '货车' },
    carrier: {
      kind: 'INTERNAL',
      operatingEntityId: operatingEntity.subjectId,
      approvalEntryId: operatingEntity.submissionId,
    },
    vin: 'VIN00000000000001',
    engineNumber: 'ENGINE-01',
    ratedLoadKg: 1200.5,
    bulkWaterCarrier: false,
    remark: '',
    enabled: true,
  })
  await submitAndApprove('fund-account', {
    name: '基本户',
    currency: 'cny',
    accountName: '全聚合经营主体',
    bank: '目标银行',
    branch: '厦门分行',
    accountNumber: '6222-0000-01',
    remark: '',
    enabled: true,
    operatingEntity: operatingEntityReference,
  })
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
      quantityScale: 0,
    },
    defaultInputUnit: {
      id: auxIds[4],
      code: 'FORGED-INPUT',
      name: '伪造默认单位',
      quantityScale: 0,
    },
    defaultPackageSpec: '袋',
    recyclable: false,
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
    quantityScale: 3,
  })
  const employee = await submitAndApprove('employee', {
    identityKind: 'PERSON',
    legalName: '采购员甲',
    displayName: '采购员甲',
    legalIdentifier: 'EMPLOYEE-001',
    contactName: '采购员甲',
    phone: '13900000000',
    address: '厦门市',
    employeeCategory: { id: auxIds[5], code: 'TST-0006', name: '正式员工' },
    department: { id: auxIds[6], code: 'TST-0007', name: '采购部' },
    position: { id: auxIds[7], code: 'TST-0008', name: '采购员' },
    employmentDate: '2026-09-01',
    workPhone: '0592-1000000',
    workEmail: 'buyer@example.test',
    operatingEntity: operatingEntityReference,
    remark: '',
    enabled: true,
  })
  const employeeReference = {
    objectId: employee.subjectId,
    approvalEntryId: employee.submissionId,
    code: employee.code!,
    name: '采购员甲',
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
    defaultOperatingEntityId: operatingEntity.subjectId,
    remark: '',
    enabled: true,
  }
  await submitAndApprove('supplier', {
    ...identityBase,
    legalIdentifier: 'SUPPLIER-001',
    settlementMethod: null,
    defaultPurchaser: employeeReference,
  })
  await submitAndApprove('other-unit', {
    ...identityBase,
    legalIdentifier: 'OTHER-UNIT-001',
    settlementMethod: null,
  })
  await submitAndApprove('sales-partner', {
    ...identityBase,
    legalIdentifier: 'SALES-PARTNER-001',
    capabilities: ['CHANNEL_PARTNER'],
  })

  const attachment = Buffer.from('customer identity attachment')
  const attachmentId = ulid()
  const stagingId = ulid()
  const digest = createHash('sha256').update(attachment).digest('hex')
  await service.stageCustomerAttachment(
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
  const failedStagingId = ulid()
  const failedAttachmentId = ulid()
  await service.stageCustomerAttachment(
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
  const failedSubjectId = ulid(),
    failedSubmissionId = ulid()
  subjectIds.push(failedSubjectId)
  await assert.rejects(
    service.submit(
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
    (error: unknown) => error instanceof ArchiveApplicationError,
  )
  assert.ok(
    await db
      .selectFrom('dcl_customer_attachment_staging')
      .select('id')
      .where('id', '=', failedStagingId)
      .executeTakeFirst(),
    'failed submit keeps its staged attachment for retry',
  )
  await db
    .updateTable('dcl_customer_attachment_staging')
    .set({ created_at: new Date(-1_000), expires_at: new Date(0) })
    .where('id', '=', failedStagingId)
    .execute()
  const restaged = await service.stageCustomerAttachment(
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
  await db
    .updateTable('dcl_customer_attachment_staging')
    .set({ created_at: new Date(-1_000), expires_at: new Date(0) })
    .where('id', '=', failedStagingId)
    .execute()
  assert.deepEqual(await service.cleanupCustomerAttachments(submitter), {
    deleted: 1,
  })
  const customer = await submitAndApprove('customer', {
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
        customerType: 'DIRECT',
        settlementMethod: null,
        receiptMethod: 'TRANSFER',
        transportMethod: 'DELIVERY',
        pricePolicy: 'STANDARD',
        creditLimits: [{ currency: 'CNY', amount: '10000.00' }],
        salesAttribution: null,
        internalReminder: '',
        defaultOrderRemark: '',
        attachments: [],
        enabled: true,
      },
    ],
    enabled: true,
  })
  assert.equal(
    await db
      .selectFrom('dcl_customer_attachments')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('approval_entry_id', '=', customer.submissionId)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    1,
  )
  assert.equal(
    await db
      .selectFrom('dcl_customer_attachment_staging')
      .select('id')
      .where('id', '=', stagingId)
      .executeTakeFirst(),
    undefined,
  )

  const accMappingSubjectId = ulid()
  const accMappingSubmissionId = ulid()
  subjectIds.push(accMappingSubjectId)
  const accMapping = await service.submit(
    'acc-mapping',
    'submit-new',
    {
      subjectId: accMappingSubjectId,
      submissionId: accMappingSubmissionId,
      idempotencyKey: accMappingSubmissionId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot: {
        book: { id: bookId, code: 'BOOK-01', name: '测试账簿' },
        vouEntity: { id: vouEntityId, code: 'SALE', name: '销售凭证' },
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [
            {
              conditions: [
                { field: 'status', operator: 'EQ', values: ['READY'] },
              ],
              result: 'POST',
              templateId: 'standard',
            },
          ],
          templates: [
            {
              templateId: 'standard',
              collection: null,
              lines: [
                {
                  subjectSource: 'FIXED',
                  subjectValue: accountId,
                  direction: 'DEBIT',
                  amountField: 'amount',
                  currencyField: 'currency',
                  dimensions: { customer: 'customer' },
                  quantityField: null,
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
                {
                  subjectSource: 'FIXED',
                  subjectValue: accountId,
                  direction: 'CREDIT',
                  amountField: 'amount',
                  currencyField: 'currency',
                  dimensions: { customer: 'customer' },
                  quantityField: null,
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
              ],
            },
          ],
          assetConfiguration: null,
        },
      },
    },
    submitter,
    ulid(),
  )
  assert.equal(accMapping.code, null)
  await sql`UPDATE dcl_acc_subject_facts
    SET required_dimensions = '["department"]'::jsonb
    WHERE id = ${accountId}`.execute(db)
  await assert.rejects(
    service.review(
      'acc-mapping',
      'approve',
      {
        subjectId: accMappingSubjectId,
        submissionId: accMappingSubmissionId,
        expectedRevision: accMapping.revision,
      },
      reviewer,
      ulid(),
    ),
    (error: unknown) =>
      error instanceof ArchiveApplicationError &&
      error.errorKey === 'acc_mapping_invalid_data',
  )
  await sql`UPDATE dcl_acc_subject_facts
    SET required_dimensions = '["customer"]'::jsonb
    WHERE id = ${accountId}`.execute(db)
  const approvedAccMapping = await service.review(
    'acc-mapping',
    'approve',
    {
      subjectId: accMappingSubjectId,
      submissionId: accMappingSubmissionId,
      expectedRevision: accMapping.revision,
    },
    reviewer,
    ulid(),
  )
  assert.equal(approvedAccMapping.status, 'APPROVED')
  assert.deepEqual(
    (
      await sql<{ approval_entry_id: string; subject_id: string }>`
      SELECT approval_entry_id, subject_id
      FROM dcl_acc_mapping_subject_usages
      WHERE approval_entry_id = ${accMappingSubmissionId}
      ORDER BY subject_id
    `.execute(db)
    ).rows,
    [{ approval_entry_id: accMappingSubmissionId, subject_id: accountId }],
  )
  const accMappingV2Id = ulid()
  const accMappingV2 = await service.submit(
    'acc-mapping',
    'submit-change',
    {
      subjectId: accMappingSubjectId,
      submissionId: accMappingV2Id,
      idempotencyKey: accMappingV2Id,
      expectedLatestApprovedSubmissionId: accMappingSubmissionId,
      expectedLatestApprovedRevision: approvedAccMapping.revision,
      snapshot: accMapping.snapshot,
    },
    submitter,
    ulid(),
  )
  const approvedAccMappingV2 = await service.review(
    'acc-mapping',
    'approve',
    {
      subjectId: accMappingSubjectId,
      submissionId: accMappingV2Id,
      expectedRevision: accMappingV2.revision,
    },
    reviewer,
    ulid(),
  )
  assert.equal(approvedAccMappingV2.status, 'APPROVED')
  assert.equal(
    (
      await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM dcl_acc_mapping_subject_usages
      WHERE approval_entry_id IN (${accMappingSubmissionId}, ${accMappingV2Id})
    `.execute(db)
    ).rows[0]!.count,
    '2',
  )
  await sql`
    INSERT INTO dcl_acc_mapping_reference_facts (
      mapping_approval_entry_id, document_type, document_id
    ) VALUES (${accMappingV2Id}, 'VOU', 'vou-usage-1')
  `.execute(db)
  await assert.rejects(
    service.review(
      'acc-mapping',
      'unapprove',
      {
        subjectId: accMappingSubjectId,
        submissionId: accMappingV2Id,
        expectedRevision: approvedAccMappingV2.revision,
        reason: '已被凭证精确引用',
      },
      reviewer,
      ulid(),
    ),
    (error: unknown) =>
      error instanceof ArchiveApplicationError &&
      error.errorKey === 'approval_strong_reference_exists',
  )
  assert.equal(
    (
      await db
        .selectFrom('approval_entries')
        .select('status')
        .where('id', '=', accMappingV2Id)
        .executeTakeFirstOrThrow()
    ).status,
    'APPROVED',
  )
  assert.equal(
    (
      await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM dcl_acc_mapping_subject_usages
      WHERE approval_entry_id IN (${accMappingSubmissionId}, ${accMappingV2Id})
    `.execute(db)
    ).rows[0]!.count,
    '2',
  )
  await sql`DELETE FROM dcl_acc_mapping_reference_facts
    WHERE mapping_approval_entry_id = ${accMappingV2Id}`.execute(db)
  const unapprovedAccMappingV2 = await service.review(
    'acc-mapping',
    'unapprove',
    {
      subjectId: accMappingSubjectId,
      submissionId: accMappingV2Id,
      expectedRevision: approvedAccMappingV2.revision,
      reason: '移除凭证引用后回落',
    },
    reviewer,
    ulid(),
  )
  assert.equal(unapprovedAccMappingV2.status, 'PENDING')
  assert.deepEqual(
    (
      await sql<{ approval_entry_id: string; subject_id: string }>`
      SELECT approval_entry_id, subject_id
      FROM dcl_acc_mapping_subject_usages
      WHERE approval_entry_id IN (${accMappingSubmissionId}, ${accMappingV2Id})
      ORDER BY approval_entry_id, subject_id
    `.execute(db)
    ).rows,
    [{ approval_entry_id: accMappingSubmissionId, subject_id: accountId }],
  )
  const validReport = await submitAndApprove('rpt-definition', {
    name: '测试报表',
    description: '目标报表定义',
    enabled: true,
    sql: 'SELECT 1 AS total',
    parameters: [],
    columns: [
      {
        alias: 'total',
        label: '总数',
        order: 1,
        type: 'INTEGER',
        width: 120,
        visible: true,
        format: '',
      },
    ],
  })
  assert.equal(validReport.validity?.status, 'VALID')
  assert.equal(validReport.validity?.validatedBy, reviewerId)
  assert.match(validReport.validity?.validatedAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
  const invalidReport = await submitAndApprove('rpt-definition', {
    name: '失效但可批准的报表',
    description: 'Approval 与技术有效性彼此独立',
    enabled: true,
    sql: 'SELECT missing_column FROM missing_table',
    parameters: [],
    columns: [
      {
        alias: 'missing_column',
        label: '缺失列',
        order: 1,
        type: 'TEXT',
        width: 120,
        visible: true,
        format: '',
      },
    ],
  })
  assert.equal(invalidReport.status, 'APPROVED')
  assert.equal(invalidReport.validity?.status, 'INVALID')
  assert.equal(invalidReport.validity?.validatedBy, reviewerId)
  const reportVersion = await service.get(
    'rpt-definition',
    validReport.subjectId,
    reviewer,
    validReport.submissionId,
  )
  assert.equal(reportVersion.submissionId, validReport.submissionId)
  await assert.rejects(
    service.get(
      'rpt-definition',
      validReport.subjectId,
      reviewer,
      invalidReport.submissionId,
    ),
    (error: unknown) =>
      error instanceof ArchiveApplicationError &&
      error.errorKey === 'approval_not_found',
  )
  for (const entity of [
    'operating-entity',
    'vehicle',
    'fund-account',
    'product',
    'employee',
    'supplier',
    'customer',
    'other-unit',
    'sales-partner',
    'acc-mapping',
    'rpt-definition',
  ] as const) {
    const items = await service.query(
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

  const duplicateSubjectId = ulid()
  const duplicateSubmissionId = ulid()
  subjectIds.push(duplicateSubjectId)
  await assert.rejects(
    service.submit(
      'operating-entity',
      'submit-new',
      {
        subjectId: duplicateSubjectId,
        submissionId: duplicateSubmissionId,
        idempotencyKey: duplicateSubmissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: operatingEntity.snapshot,
      },
      submitter,
      ulid(),
    ),
    (error: unknown) =>
      error instanceof ArchiveApplicationError &&
      error.errorKey === 'operating_entity_duplicate_legal_identifier',
  )
})
