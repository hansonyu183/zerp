import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { AuxService } from '../../src/aux/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import { BobService } from '../../src/bob/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('Customer HTTP directly owns business attributes without legal identity or subunit permission', async (context) => {
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
  ]
  const permissions = actions.map(
    (action) =>
      `/${['query', 'get', 'versions', 'audit-history', 'enable', 'disable', 'attachment-read'].includes(action) ? 'bob' : 'dcl'}/customer/${action}`,
  )
  await bootstrap.createE2EPrincipal(submitter, false, [
    ...permissions,
    ...permissions.map((path) => path.replace('/customer/', '/supplier/')),
  ])
  await bootstrap.createE2EPrincipal(reviewer, false, [
    ...permissions,
    ...permissions.map((path) => path.replace('/customer/', '/supplier/')),
  ])
  context.after(async () => {
    try {
      const subjects = db
        .selectFrom('bob_archive_objects')
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
        .deleteFrom('dcl_subjects')
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
    dclArchives: new DclArchiveService(db),
  })
  const login = async (code: string, entity = 'customer') => {
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
      const response = await app.request(
        `/${['query', 'get', 'versions', 'audit-history', 'enable', 'disable', 'attachment-read'].includes(action) ? 'bob' : 'dcl'}/${entity}/${action}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(input),
        },
      )
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
  const archives = new DclArchiveService(db)
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
  const snapshot = {
    displayName: `客户-${suffix}`,
    phone: '123',
    email: '',
    address: '厦门',
    contactName: '联系人',
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
      costItems: [],
      thirdPartyIntermediaryFixedUnitCost: '0.01',
      thirdPartyIntermediaryVariableUnitCost: '0.02',
    },
    creditLimits: [{ currency: 'CNY', amount: '10000.00' }],
    primarySalesAttribution: {
      type: 'CHANNEL_PARTNER',
      objectId: partnerId,
      approvalEntryId: partnerEntry,
      code: 'FORGED',
      name: '伪造来源',
    },
    internalReminder: '内部提示',
    defaultSalesOrderRemark: '送货前联系',
    attachments: [],
    remittanceProfiles: [
      { payerName: '付款单位', bank: '', accountNumber: '' },
    ],
    defaultOperatingEntity: { objectId: oe.id, code: oe.code, name: oe.name },
    taxInformation: [],
  }
  const taxActor = {
    id: submitter.userId,
    permissions: ['create', 'get', 'save', 'delete'].map(
      (action) => `/aux/tax-information/${action}`,
    ),
  }
  const taxInput = {
    name: '税务原名称',
    taxNumber: `TAX${suffix}`,
    registeredAddress: '',
    phone: '',
    bank: '',
    accountNumber: '',
    remark: '',
  }
  const tax = await aux.create('tax-information', taxInput, taxActor)
  const taxView = await aux.get('tax-information', { id: tax.id }, taxActor)
  const taxSnapshot = {
    ...taxInput,
    id: tax.id,
    code: taxView.code,
    revision: taxView.revision,
  }
  const linkedSnapshot = {
    ...snapshot,
    taxInformation: [{ ...taxSnapshot, name: '客户端伪造名称' }],
  }
  const input = {
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot: linkedSnapshot,
  }
  const unassignedInput = {
    ...input,
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    snapshot: { ...snapshot, primarySalesAttribution: null },
  }
  const missingEmployee = await write('submit-new', {
    ...unassignedInput,
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    snapshot: {
      ...snapshot,
      primarySalesAttribution: {
        type: 'INTERNAL_EMPLOYEE',
        objectId: ulid(),
        code: 'MISSING',
        name: '不存在员工',
      },
    },
  })
  assert.notEqual(missingEmployee.code, 0)
  assert.equal(missingEmployee.errorKey, 'archive_reference_unavailable')
  const unassigned = await write('submit-new', unassignedInput)
  assert.equal(unassigned.code, 0, unassigned.errorKey)
  assert.equal(unassigned.data.snapshot.primarySalesAttribution, null)
  const unassignedApproval = await review('approve', {
    subjectId: unassignedInput.subjectId,
    submissionId: unassignedInput.submissionId,
    expectedRevision: unassigned.data.revision,
  })
  assert.equal(unassignedApproval.code, 0, unassignedApproval.errorKey)
  const unassignedCurrent = await write('get', {
    objectId: unassignedInput.subjectId,
  })
  assert.equal(unassignedCurrent.code, 0, unassignedCurrent.errorKey)
  assert.equal(unassignedCurrent.data.data.primarySalesAttribution, null)

  let previousUnassigned = unassignedApproval.data
  for (const attribution of [snapshot.primarySalesAttribution, null]) {
    const submissionId = ulid()
    const change = await write('submit-change', {
      ...unassignedInput,
      submissionId,
      idempotencyKey: ulid(),
      expectedLatestApprovedSubmissionId: previousUnassigned.submissionId,
      expectedLatestApprovedRevision: previousUnassigned.revision,
      snapshot: { ...snapshot, primarySalesAttribution: attribution },
    })
    assert.equal(change.code, 0, change.errorKey)
    const approvedChange = await review('approve', {
      subjectId: unassignedInput.subjectId,
      submissionId,
      expectedRevision: change.data.revision,
    })
    assert.equal(approvedChange.code, 0, approvedChange.errorKey)
    previousUnassigned = approvedChange.data
    const view = await write('get', { objectId: unassignedInput.subjectId })
    assert.equal(view.code, 0, view.errorKey)
    assert.equal(
      view.data.data.primarySalesAttribution?.objectId ?? null,
      attribution?.objectId ?? null,
    )
  }

  const submitted = await write('submit-new', input)
  assert.equal(submitted.code, 0, submitted.errorKey)
  assert.equal(submitted.data.snapshot.primarySalesAttribution.name, '渠道商')
  assert.equal('subunits' in submitted.data.snapshot, false)
  assert.equal('identityKind' in submitted.data.snapshot, false)
  const approved = await review('approve', {
    subjectId: input.subjectId,
    submissionId: input.submissionId,
    expectedRevision: submitted.data.revision,
  })
  assert.equal(approved.code, 0, approved.errorKey)
  const current = await write('get', { objectId: input.subjectId })
  assert.equal(current.code, 0, current.errorKey)
  assert.deepEqual(current.data.data, approved.data.snapshot)
  assert.equal(current.data.data.creditLimits[0].amount, '10000.00')
  assert.equal('implicitSubunitId' in current.data, false)
  assert.equal(current.data.data.taxInformation[0].name, '税务原名称')
  await aux.save(
    'tax-information',
    { ...taxInput, id: tax.id, revision: tax.revision, name: '税务新名称' },
    taxActor,
  )
  const reread = await write('get', { objectId: input.subjectId })
  assert.equal(reread.data.data.taxInformation[0].name, '税务原名称')
  await assert.rejects(
    () =>
      aux.delete('tax-information', { id: tax.id, revision: '2' }, taxActor),
    (error: unknown) => error instanceof Error && error.message === 'conflict',
  )

  const supplierWrite = await login(submitter.username, 'supplier'),
    supplierReview = await login(reviewer.username, 'supplier')
  const supplierInput = {
    ...input,
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    snapshot: {
      displayName: '共享税务供应商',
      contactName: '',
      phone: '',
      address: '',
      remark: '',
      operatingEntities: [{ objectId: oe.id, code: oe.code, name: oe.name }],
      defaultOperatingEntityId: oe.id,
      settlementMethod: null,
      defaultPurchaser: null,
      taxInformation: [taxSnapshot],
    },
  }
  const supplier = await supplierWrite('submit-new', supplierInput)
  assert.equal(supplier.code, 0, supplier.errorKey)
  assert.equal(supplier.data.snapshot.taxInformation[0].name, '税务新名称')
  assert.equal(supplier.data.snapshot.taxInformation[0].id, tax.id)
  assert.equal('legalIdentifier' in supplier.data.snapshot, false)
  assert.equal(
    (
      await supplierReview('approve', {
        subjectId: supplierInput.subjectId,
        submissionId: supplierInput.submissionId,
        expectedRevision: supplier.data.revision,
      })
    ).code,
    0,
  )
  assert.equal(
    (await supplierWrite('get', { objectId: supplierInput.subjectId })).data
      .data.taxInformation[0].name,
    '税务新名称',
  )
})
