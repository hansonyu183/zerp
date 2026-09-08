import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { AuxService, type AuxWriteData } from '../../src/aux/service.ts'
import { BobArchiveService } from '../../src/bob/archives.ts'
import { BobService } from '../../src/bob/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('product HTTP preserves precise formula history and independent enablement across versions', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const password = randomBytes(24).toString('base64url')
  const suffix = ulid()
  const principal = async (label: string) => ({
    userId: ulid(),
    roleId: ulid(),
    username: `product-${label}-${suffix}`,
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
  const permissions = actions.map((action) => `/bob/product/${action}`)
  permissions.push('/bob/reference/query')
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
      const response = await app.request(`/bob/product/${action}`, {
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
  const auxActor = {
    id: submitter.userId,
    permissions: [
      'measurement-unit',
      'product-category',
      'product-type',
    ].flatMap((entity) =>
      ['create', 'get', 'save', 'disable'].map(
        (action) => `/aux/${entity}/${action}`,
      ),
    ),
  }
  const createAux = async <
    Entity extends 'measurement-unit' | 'product-category' | 'product-type',
  >(
    entity: Entity,
    data: AuxWriteData<Entity>,
  ) => {
    const created = await aux.create(entity, data, auxActor)
    return aux.get(entity, { id: created.id }, auxActor)
  }
  const measurement = await createAux('measurement-unit', {
    name: `单位-${suffix}`,
    symbol: 'kg',
    quantityScale: 6,
  })
  const category = await createAux('product-category', {
    name: `分类-${suffix}`,
    description: '',
  })
  const rawType = await createAux('product-type', {
    name: `原料-${suffix}`,
    behaviorProfile: 'RAW_MATERIAL',
    description: '',
  })
  const finishedType = await createAux('product-type', {
    name: `成品-${suffix}`,
    behaviorProfile: 'STANDARD_FINISHED',
    description: '',
  })
  const unit = {
    id: measurement.id,
    code: measurement.code,
    name: measurement.name,
    symbol: 'kg',
    quantityScale: 6,
  }
  const snapshot = {
    name: `原料-${suffix}`,
    barcode: `barcode-${suffix}`,
    specification: '规格',
    model: 'M1',
    productType: {
      id: rawType.id,
      code: rawType.code,
      name: rawType.name,
      behaviorProfile: 'RAW_MATERIAL',
    },
    productCategory: {
      id: category.id,
      code: category.code,
      name: category.name,
    },
    pricingUnit: unit,
    defaultInputUnit: unit,
    unitConversions: [{ unit, factor: '2.500000' }],
    defaultPackagingSpec: '25.000000',
    recyclable: false,
    fixedFormula: null,
    remark: '完整产品',
  }
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
  assert.deepEqual((await write('submit-new', input)).data, submitted.data)
  assert.equal(
    (
      await write('submit-new', {
        ...input,
        submissionId: ulid(),
        idempotencyKey: ulid(),
        snapshot: { ...snapshot, enabled: true },
      })
    ).errorKey,
    'validation_failed',
  )
  const before = await write('query', {
    page: 1,
    pageSize: 20,
    filters: { keyword: snapshot.name },
  })
  assert.equal(before.data.items.length, 0)
  assert.equal(
    (
      await write('disable', {
        objectId: input.subjectId,
        expectedRevision: '1',
      })
    ).code,
    0,
  )
  const approved = await review('approve', {
    subjectId: input.subjectId,
    submissionId: input.submissionId,
    expectedRevision: '1',
  })
  assert.equal(approved.code, 0, approved.errorKey)
  const disabled = await write('get', { objectId: input.subjectId })
  assert.equal(disabled.data.enabled, false)
  assert.equal(disabled.data.revision, '2')
  assert.equal(
    (
      await write('enable', {
        objectId: input.subjectId,
        expectedRevision: '2',
      })
    ).code,
    0,
  )
  const formula = {
    output: {
      enteredQuantity: '2.000000',
      enteredUnit: unit,
      baseQuantity: '9007199254740993.000001',
    },
    components: [
      {
        material: {
          objectId: input.subjectId,
          approvalEntryId: input.submissionId,
          code: approved.data.code,
          name: snapshot.name,
        },
        quantity: {
          enteredQuantity: '1.000001',
          enteredUnit: unit,
          baseQuantity: '3.000001',
        },
        resolutionStatus: 'CURRENT',
        requiresConfirmation: false,
      },
    ],
  }
  const finishedInput = {
    ...input,
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    snapshot: {
      ...snapshot,
      name: `成品-${suffix}`,
      barcode: `finished-${suffix}`,
      productType: {
        id: finishedType.id,
        code: finishedType.code,
        name: finishedType.name,
        behaviorProfile: 'STANDARD_FINISHED',
      },
      fixedFormula: formula,
    },
  }
  assert.equal((await write('submit-new', finishedInput)).code, 0)
  const finished = await review('approve', {
    subjectId: finishedInput.subjectId,
    submissionId: finishedInput.submissionId,
    expectedRevision: '1',
  })
  assert.equal(finished.code, 0, finished.errorKey)
  assert.deepEqual(finished.data.snapshot.fixedFormula, formula)
  const blocked = await review('unapprove', {
    subjectId: input.subjectId,
    submissionId: input.submissionId,
    expectedRevision: approved.data.revision,
    reason: '精确引用检查',
  })
  assert.equal(blocked.errorKey, 'approval_strong_reference_exists')
  assert.ok(
    blocked.data.blockers.some(
      (blocker: { kind: string; objectId: string }) =>
        blocker.kind === 'PRODUCT_REFERENCE' &&
        blocker.objectId === finishedInput.subjectId,
    ),
  )
  assert.equal(
    (
      await write('submission-get', {
        subjectId: input.subjectId,
        submissionId: input.submissionId,
      })
    ).data.revision,
    approved.data.revision,
  )
  const duplicate = await write('submit-new', {
    ...input,
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    snapshot: { ...snapshot, barcode: snapshot.barcode.toUpperCase() },
  })
  assert.equal(duplicate.errorKey, 'product_duplicate_barcode')
  const change = {
    ...input,
    submissionId: ulid(),
    idempotencyKey: ulid(),
    expectedLatestApprovedSubmissionId: input.submissionId,
    expectedLatestApprovedRevision: approved.data.revision,
    snapshot: {
      ...snapshot,
      name: `新名称-${suffix}`,
      barcode: `new-${suffix}`,
    },
  }
  assert.equal((await write('submit-change', change)).code, 0)
  // AUX later stops being a valid new choice; the adopted product submission remains complete.
  const rawCurrent = await aux.get('product-type', { id: rawType.id }, auxActor)
  await aux.disable(
    'product-type',
    { id: rawType.id, revision: rawCurrent.revision },
    auxActor,
    ulid(),
  )
  const changed = await review('approve', {
    subjectId: input.subjectId,
    submissionId: change.submissionId,
    expectedRevision: '1',
  })
  assert.equal(changed.code, 0, changed.errorKey)
  const oldName = await write('query', {
    page: 1,
    pageSize: 20,
    filters: { keyword: snapshot.name },
  })
  assert.equal(
    oldName.data.items.some(
      (item: { objectId: string }) => item.objectId === input.subjectId,
    ),
    false,
  )
  const oldFormula = await write('submission-get', {
    subjectId: finishedInput.subjectId,
    submissionId: finishedInput.submissionId,
  })
  assert.deepEqual(oldFormula.data.snapshot.fixedFormula, formula)
  const releasedBarcode = await write('submit-new', {
    ...input,
    subjectId: ulid(),
    submissionId: ulid(),
    idempotencyKey: ulid(),
    snapshot: {
      ...snapshot,
      productType: finishedInput.snapshot.productType,
      fixedFormula: {
        ...formula,
        components: [
          {
            ...formula.components[0],
            material: {
              ...formula.components[0]!.material,
              approvalEntryId: change.submissionId,
              name: change.snapshot.name,
            },
          },
        ],
      },
    },
  })
  assert.equal(releasedBarcode.code, 0, releasedBarcode.errorKey)
  const restoredBarcode = await review('unapprove', {
    subjectId: input.subjectId,
    submissionId: change.submissionId,
    expectedRevision: changed.data.revision,
    reason: '恢复旧版本条码冲突',
  })
  assert.equal(restoredBarcode.errorKey, 'product_duplicate_barcode')
  const candidates = await new BobService(db).queryReferenceCandidates(
    { entity: 'product', behaviorProfile: 'RAW_MATERIAL' },
    { id: submitter.userId, permissions: ['/bob/reference/query'] },
  )
  assert.ok(
    candidates.some(
      (item) =>
        item.objectId === input.subjectId &&
        item.sourceApprovalEntryId === change.submissionId,
    ),
  )
  const versions = await write('versions', { subjectId: input.subjectId })
  assert.deepEqual(
    versions.data.items.map(
      (entry: { submissionId: string }) => entry.submissionId,
    ),
    [change.submissionId, input.submissionId],
  )
  assert.equal(
    (await app.request('/dcl/product/submit-new', { method: 'POST' })).status,
    404,
  )
})
