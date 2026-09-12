import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { ulid } from 'ulid'
import { modelBuildId, type CustomerData } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { AuxService } from '../../src/aux/service.ts'
import { BobArchiveService } from '../../src/bob/archives.ts'
import { BobService } from '../../src/bob/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('Customer HTTP preserves subunit identity, exact snapshots and independent enablement across versions', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const password = randomBytes(24).toString('base64url')
  const suffix = ulid()
  const principal = async (label: string) => ({
    userId: ulid(),
    roleId: ulid(),
    username: `customer-${label}-${suffix}`,
    passwordHash: await hashPassword(password),
  })
  const submitter = await principal('submit'),
    reviewer = await principal('review')
  const actions = [
    'query',
    'get',
    'submission-query',
    'submission-get',
    'versions',
    'audit-history',
    'submit-new',
    'submit-change',
    'approve',
    'reject',
    'unreject',
    'unapprove',
    'enable',
    'disable',
    'delete',
    'save-subunits',
  ]
  const permissions = actions.map((action) => `/bob/customer/${action}`)
  await bootstrap.createE2EPrincipal(submitter, false, permissions)
  await bootstrap.createE2EPrincipal(reviewer, false, permissions)
  context.after(async () => {
    try {
      const subjects = db
        .selectFrom('bob_subjects')
        .select('id')
        .where('created_by', '=', submitter.userId)
      await db
        .deleteFrom('archive_idempotency')
        .where('subject_id', 'in', subjects)
        .execute()
      await db
        .deleteFrom('approval_events')
        .where('subject_id', 'in', subjects)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where('subject_id', 'in', subjects)
        .execute()
      await db
        .deleteFrom('bob_subjects')
        .where('created_by', '=', submitter.userId)
        .execute()
      await bootstrap.deleteE2EPrincipal(submitter)
      await bootstrap.deleteE2EPrincipal(reviewer)
    } finally {
      await db.destroy()
    }
  })
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    bob: new BobService(db),
    bobArchives: new BobArchiveService(db),
  })
  const login = async (code: string) => {
    const response = await app.request('/session/auth/signin', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zerp-model-build': modelBuildId,
      },
      body: JSON.stringify({ code, password }),
    })
    const envelope = await response.json()
    assert.equal(envelope.code, 0)
    const headers = {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': envelope.data.csrfToken,
      cookie: response.headers.getSetCookie()[0]!,
    }
    return async (action: string, input: unknown) => {
      const response = await app.request(`/bob/customer/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      })
      return response.json()
    }
  }
  const write = await login(submitter.username),
    review = await login(reviewer.username)
  const absent = await review('approve', {
    subjectId: ulid(),
    submissionId: ulid(),
    expectedRevision: '1',
  })
  assert.equal(absent.errorKey, 'approval_not_found')
  const aux = new AuxService(db)
  const actor = {
    id: submitter.userId,
    permissions: [
      'operating-entity',
      'dictionary-type',
      'dictionary-item',
    ].flatMap((entity) =>
      ['create', 'get'].map((action) => `/aux/${entity}/${action}`),
    ),
  }
  const oeId = (
    await aux.create(
      'operating-entity',
      {
        legalName: `主体-${suffix}`,
        shortName: '客户验证主体',
        legalIdentifier: suffix.slice(0, 18),
        registeredAddress: '',
        contactName: '',
        contactPhone: '',
        invoiceTitle: '',
        invoiceAddress: '',
        invoicePhone: '',
        invoiceBank: '',
        invoiceAccount: '',
        remark: '',
      },
      actor,
    )
  ).id
  const oe = await aux.get('operating-entity', { id: oeId }, actor)
  const dictId = (
    await aux.create(
      'dictionary-type',
      { name: `客户类型-${suffix}`, description: '' },
      actor,
    )
  ).id
  const typeId = (
    await aux.create(
      'dictionary-item',
      { name: '直销客户', dictionaryTypeId: dictId, sortOrder: 0 },
      actor,
    )
  ).id
  const customerType = await aux.get('dictionary-item', { id: typeId }, actor)
  const archives = new BobArchiveService(db)
  const partnerId = ulid(),
    partnerEntry = ulid()
  const trusted = {
    id: submitter.userId,
    permissions: [] as string[],
    trusted: true,
  }
  const partner = await archives.submit(
    'sales-partner',
    'submit-new',
    {
      subjectId: partnerId,
      submissionId: partnerEntry,
      idempotencyKey: partnerEntry,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot: {
        identityKind: 'ORGANIZATION',
        legalName: `渠道-${suffix}`,
        displayName: '渠道商',
        legalIdentifier: `PARTNER-${suffix}`,
        contactName: '',
        phone: '',
        address: '',
        operatingEntities: [{ objectId: oe.id, code: oe.code, name: oe.name }],
        defaultOperatingEntityId: oe.id,
        remark: '',
        capabilities: ['CHANNEL_PARTNER'],
      },
    },
    trusted,
    ulid(),
  )
  await archives.review(
    'sales-partner',
    'approve',
    {
      subjectId: partnerId,
      submissionId: partnerEntry,
      expectedRevision: partner.revision,
    },
    { ...trusted, id: reviewer.userId },
    ulid(),
  )
  const subunit = () => ({
    id: ulid(),
    intent: 'NEW' as const,
    code: null,
    name: '总部',
    contactName: '联系人',
    address: '厦门',
    customerType: {
      id: customerType.id,
      code: customerType.code,
      name: customerType.name,
    },
    settlementMethod: null,
    paymentMethod: null,
    transportPolicy: {
      methodCode: 'DELIVERY',
      methodName: '送货',
      surcharge: '0.00',
    },
    pricingPolicy: {
      defaultPremiumUnitPrice: '0.10',
      defaultDiscountUnitPrice: '0.00',
      costItems: [
        {
          name: '装卸',
          calculationBasis: 'ORDER_AMOUNT' as const,
          orderAmount: '0.01',
        },
      ],
      thirdPartyIntermediaryFixedUnitCost: '0.01',
      thirdPartyIntermediaryVariableUnitCost: '0.02',
    },
    creditLimits: [{ currency: 'CNY', amount: '10000.00' }],
    primarySalesAttribution: {
      type: 'CHANNEL_PARTNER' as const,
      objectId: partnerId,
      approvalEntryId: partnerEntry,
      code: 'FORGED',
      name: '伪造来源',
    },
    internalReminder: '内部提示',
    defaultSalesOrderRemark: '送货前联系',
    attachments: [],
    enabled: true,
  })
  const snapshot = {
    identityKind: 'OTHER',
    legalName: `客户-${suffix}`,
    displayName: `客户-${suffix}`,
    legalIdentifier: `customer-${suffix}`,
    phone: '123',
    email: 'test@example.test',
    address: '厦门',
    invoiceTitle: '客户抬头',
    invoiceAddress: '开票地址',
    invoicePhone: '456',
    invoiceBank: '银行',
    invoiceAccount: '62220000',
    remittanceProfiles: [
      { payerName: '付款单位', bank: '银行', accountNumber: '12345678' },
    ],
    defaultOperatingEntity: { objectId: oe.id, code: oe.code, name: oe.name },
    identityAttachments: [],
    subunits: [subunit()],
  }
  const noActive = await write('submit-new', {
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot: {
      ...snapshot,
      legalIdentifier: `inactive-${suffix}`,
      subunits: [{ ...subunit(), enabled: false }],
    },
  })
  assert.equal(
    noActive.errorKey,
    'customer_invalid_data',
    'a newly enabled customer must have an enabled subunit',
  )
  const input = {
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot,
  }
  const submitted = await write('submit-new', input)
  assert.equal(submitted.code, 0, submitted.errorKey)
  assert.equal('enabled' in submitted.data.snapshot, false)
  assert.equal(submitted.data.snapshot.subunits[0].code, 'SUB-0001')
  assert.equal(
    submitted.data.snapshot.subunits[0].primarySalesAttribution.name,
    '渠道商',
  )
  assert.deepEqual((await write('submit-new', input)).data, submitted.data)
  assert.equal(
    (
      await write('query', {
        page: 1,
        pageSize: 20,
        filters: { keyword: snapshot.displayName },
      })
    ).data.items.length,
    0,
  )
  const reviewInput = {
    subjectId: input.subjectId,
    submissionId: input.submissionId,
    expectedRevision: submitted.data.revision,
  }
  assert.equal(
    (await write('approve', reviewInput)).errorKey,
    'approval_self_review_forbidden',
  )
  const approved = await review('approve', reviewInput)
  assert.equal(approved.code, 0, approved.errorKey)
  const current = await write('get', { objectId: input.subjectId })
  assert.equal(current.code, 0, current.errorKey)
  assert.deepEqual(current.data.data, approved.data.snapshot)
  assert.equal(current.data.revision, '1')
  assert.equal(
    current.data.implicitSubunitId,
    approved.data.snapshot.subunits[0].id,
  )
  await aux.save(
    'dictionary-item',
    {
      id: typeId,
      revision: customerType.revision,
      name: '客户类型已改名',
      dictionaryTypeId: dictId,
      sortOrder: 0,
    },
    {
      ...actor,
      permissions: [...actor.permissions, '/aux/dictionary-item/save'],
    },
  )
  const rootOnlyId = ulid()
  const rootOnly = await archives.submit(
    'customer',
    'submit-change',
    {
      ...input,
      submissionId: rootOnlyId,
      idempotencyKey: rootOnlyId,
      expectedLatestApprovedSubmissionId: input.submissionId,
      expectedLatestApprovedRevision: approved.data.revision,
      snapshot: { ...approved.data.snapshot, phone: '789' },
    },
    { id: submitter.userId, permissions: ['/bob/customer/submit-change'] },
    ulid(),
  )
  assert.deepEqual(
    rootOnly.snapshot.subunits,
    approved.data.snapshot.subunits,
    'root edit keeps adopted subunit snapshots after source rename without extra permission',
  )
  await archives.delete(
    'customer',
    {
      subjectId: input.subjectId,
      submissionId: rootOnlyId,
      expectedRevision: rootOnly.revision,
    },
    trusted,
    ulid(),
  )
  // Duplicate identity rejection must leave no candidate, code or idempotency record.
  const duplicate = {
    ...input,
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    snapshot: { ...snapshot, subunits: [subunit()] },
  }
  assert.equal(
    (await write('submit-new', duplicate)).errorKey,
    'customer_duplicate_legal_identifier',
  )
  assert.equal(
    (
      await write('submission-get', {
        subjectId: duplicate.subjectId,
        submissionId: duplicate.submissionId,
      })
    ).errorKey,
    'approval_not_found',
  )
  const next = {
    ...input,
    submissionId: ulid(),
    idempotencyKey: ulid(),
    expectedLatestApprovedSubmissionId: input.submissionId,
    expectedLatestApprovedRevision: approved.data.revision,
    snapshot: {
      ...approved.data.snapshot,
      displayName: `二版-${suffix}`,
      subunits: [
        ...approved.data.snapshot.subunits,
        { ...subunit(), name: '分部' },
      ],
    },
  }
  const pending = await write('submit-change', next)
  assert.equal(pending.code, 0, pending.errorKey)
  assert.deepEqual(
    pending.data.snapshot.subunits.map((s: { code: string }) => s.code),
    ['SUB-0001', 'SUB-0002'],
  )
  const [disabled, approved2] = await Promise.all([
    write('disable', { objectId: input.subjectId, expectedRevision: '1' }),
    review('approve', {
      subjectId: input.subjectId,
      submissionId: next.submissionId,
      expectedRevision: pending.data.revision,
    }),
  ])
  assert.equal(disabled.code, 0, disabled.errorKey)
  assert.equal(approved2.code, 0, approved2.errorKey)
  const after = (await write('get', { objectId: input.subjectId })).data
  assert.equal(after.enabled, false)
  assert.equal(after.implicitSubunitId, null)
  assert.equal(after.revision, '2')
  assert.equal(after.sourceApprovalEntryId, next.submissionId)
  assert.deepEqual(
    (
      await write('submission-get', {
        subjectId: input.subjectId,
        submissionId: input.submissionId,
      })
    ).data.snapshot,
    approved.data.snapshot,
  )
  assert.equal(
    (
      await write('enable', {
        objectId: input.subjectId,
        expectedRevision: '1',
      })
    ).errorKey,
    'conflict',
  )
  assert.equal(
    (
      await write('enable', {
        objectId: input.subjectId,
        expectedRevision: '2',
      })
    ).code,
    0,
  )
  assert.equal(
    (await write('get', { objectId: input.subjectId })).data.implicitSubunitId,
    null,
  )
  const history = await write('versions', { subjectId: input.subjectId })
  assert.equal(history.data.items.length, 2)
  const saleEntry = ulid(),
    saleDocument = ulid(),
    now = new Date()
  await db
    .insertInto('approval_entries')
    .values({
      id: saleEntry,
      domain: 'vou',
      entity: 'sale-receipt',
      subject_id: saleDocument,
      version_no: null,
      status: 'APPROVED',
      revision: 1,
      submitted_by: submitter.userId,
      submitted_at: now,
      approved_by: reviewer.userId,
      approved_at: now,
      updated_by: reviewer.userId,
      updated_at: now,
    })
    .execute()
  try {
    await db
      .insertInto('vou_reference_snapshots')
      .values({
        approval_entry_id: saleEntry,
        field: 'allocations.counterparty',
        line_no: 1,
        object_id: approved2.data.snapshot.subunits[0].id,
        approval_reference_id: next.submissionId,
        selection_origin: 'CURRENT',
        reference_entity: 'customer-subunit',
        reference_code: 'SUB-0001',
        reference_name: '总部',
      })
      .execute()
    const blocked = await review('unapprove', {
      subjectId: input.subjectId,
      submissionId: next.submissionId,
      expectedRevision: approved2.data.revision,
      reason: '正式收款正在引用',
    })
    assert.equal(blocked.errorKey, 'approval_strong_reference_exists')
    assert.deepEqual(blocked.data.blockers, [
      {
        kind: 'CUSTOMER_REFERENCE',
        domain: 'vou',
        entity: 'sale-receipt',
        objectId: saleDocument,
        approvalEntryId: saleEntry,
        field: 'allocations.counterparty',
      },
    ])
    assert.equal(
      (await write('get', { objectId: input.subjectId })).data
        .sourceApprovalEntryId,
      next.submissionId,
    )
  } finally {
    await db
      .deleteFrom('approval_entries')
      .where('id', '=', saleEntry)
      .execute()
  }
  const unapproved = await review('unapprove', {
    subjectId: input.subjectId,
    submissionId: next.submissionId,
    expectedRevision: approved2.data.revision,
    reason: '验证版本回落',
  })
  assert.equal(unapproved.code, 0, unapproved.errorKey)
  const rolledBack = (await write('get', { objectId: input.subjectId })).data
  assert.equal(rolledBack.enabled, true)
  assert.equal(rolledBack.revision, '3')
  assert.equal(rolledBack.sourceApprovalEntryId, input.submissionId)
  assert.equal(
    (
      await write('delete', {
        subjectId: input.subjectId,
        submissionId: next.submissionId,
        expectedRevision: unapproved.data.revision,
      })
    ).code,
    0,
  )
  assert.equal(
    (
      await write('disable', {
        objectId: input.subjectId,
        expectedRevision: '3',
      })
    ).code,
    0,
  )
  const submitVersion = async (
    base: { submissionId: string; revision: string; snapshot: CustomerData },
    active: boolean,
  ) => {
    const submissionId = ulid()
    const pending = await write('submit-change', {
      ...input,
      submissionId,
      idempotencyKey: submissionId,
      expectedLatestApprovedSubmissionId: base.submissionId,
      expectedLatestApprovedRevision: base.revision,
      snapshot: {
        ...base.snapshot,
        subunits: base.snapshot.subunits.map((subunit) => ({
          ...subunit,
          enabled: active,
        })),
      },
    })
    assert.equal(pending.code, 0, pending.errorKey)
    const approved = await review('approve', {
      subjectId: input.subjectId,
      submissionId,
      expectedRevision: pending.data.revision,
    })
    assert.equal(approved.code, 0, approved.errorKey)
    return approved.data
  }
  const inactiveVersion = await submitVersion(approved.data, false)
  assert.equal(
    (
      await write('enable', {
        objectId: input.subjectId,
        expectedRevision: '4',
      })
    ).errorKey,
    'customer_enabled_subunit_required',
  )
  const activeVersion = await submitVersion(inactiveVersion, true)
  assert.equal(
    (
      await write('enable', {
        objectId: input.subjectId,
        expectedRevision: '4',
      })
    ).code,
    0,
  )
  const rollbackActive = {
    subjectId: input.subjectId,
    submissionId: activeVersion.submissionId,
    expectedRevision: activeVersion.revision,
    reason: '回落到全部停用子单位版本',
  }
  assert.equal(
    (await review('unapprove', rollbackActive)).errorKey,
    'customer_enabled_subunit_required',
  )
  assert.equal(
    (
      await write('disable', {
        objectId: input.subjectId,
        expectedRevision: '5',
      })
    ).code,
    0,
  )
  assert.equal((await review('unapprove', rollbackActive)).code, 0)
  assert.equal(
    (await write('get', { objectId: input.subjectId })).data.enabled,
    false,
  )
})
