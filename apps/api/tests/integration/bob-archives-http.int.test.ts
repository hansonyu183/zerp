import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'

import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { AuxService } from '../../src/aux/service.ts'
import { BobArchiveService } from '../../src/bob/archives.ts'
import { BobService } from '../../src/bob/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('BOB HTTP keeps formal data, immutable submissions and object enablement independent', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = ulid()
  const password = randomBytes(24).toString('base64url')
  const submitter = {
    userId: ulid(),
    roleId: ulid(),
    username: `bob-submit-${suffix}`,
    passwordHash: await hashPassword(password),
  }
  const reviewer = {
    userId: ulid(),
    roleId: ulid(),
    username: `bob-review-${suffix}`,
    passwordHash: await hashPassword(password),
  }
  const entities = ['supplier', 'other-unit', 'sales-partner'] as const
  const auxPaths = ['vehicle', 'dictionary-type', 'dictionary-item'].flatMap(
    (entity) =>
      ['create', 'delete'].map((action) => `/aux/${entity}/${action}`),
  )
  const read = [
    'query',
    'get',
    'submission-query',
    'submission-get',
    'versions',
    'audit-history',
  ]
  const submitPaths = entities.flatMap((entity) =>
    [...read, 'submit-new', 'submit-change', 'enable', 'disable', 'delete'].map(
      (action) => `/bob/${entity}/${action}`,
    ),
  )
  const reviewPaths = entities.flatMap((entity) =>
    [...read, 'approve', 'unapprove', 'reject', 'unreject'].map(
      (action) => `/bob/${entity}/${action}`,
    ),
  )
  await bootstrap.createE2EPrincipal(submitter, false, [
    ...submitPaths,
    ...auxPaths,
  ])
  await bootstrap.createE2EPrincipal(reviewer, false, reviewPaths)
  context.after(async () => {
    try {
      await bootstrap.deleteE2EWarehouseFixtures(submitter.userId)
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
  async function client(code: string) {
    const response = await app.request('/session/auth/signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zerp-model-build': modelBuildId,
      },
      body: JSON.stringify({ code, password }),
    })
    const envelope = await response.json()
    assert.equal(envelope.code, 0)
    const headers = {
      'Content-Type': 'application/json',
      'x-zerp-model-build': modelBuildId,
      'x-csrf-token': envelope.data.csrfToken,
      cookie: response.headers.getSetCookie()[0]!,
    }
    return async (path: string, input: unknown) => {
      const response = await app.request(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      })
      return response.json()
    }
  }
  const write = await client(submitter.username),
    review = await client(reviewer.username)
  for (const entity of entities) {
    const subjectId = ulid(),
      submissionId = ulid()
    const snapshot = {
      identityKind: 'ORGANIZATION',
      legalName: `法定-${entity}`,
      displayName: `供应资料-${entity}`,
      legalIdentifier: `${entity.replaceAll('-', '').toUpperCase()}${suffix}`,
      contactName: '联系人',
      phone: '123',
      address: '地址',
      operatingEntities: [],
      defaultOperatingEntityId: null,
      remark: '完整资料',
      ...(entity === 'sales-partner'
        ? { capabilities: ['CHANNEL_PARTNER'] }
        : { settlementMethod: null }),
      ...(entity === 'supplier' ? { defaultPurchaser: null } : {}),
    }
    const input = {
      subjectId,
      submissionId,
      idempotencyKey: ulid(),
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot,
    }
    const submitted = await write(`/bob/${entity}/submit-new`, input)
    assert.equal(submitted.code, 0, submitted.errorKey)
    assert.equal(submitted.data.status, 'PENDING')
    assert.equal('enabled' in submitted.data.snapshot, false)
    assert.deepEqual(
      (await write(`/bob/${entity}/submit-new`, input)).data,
      submitted.data,
    )
    const pending = await write(`/bob/${entity}/submission-query`, {
      page: 1,
      pageSize: 20,
      filters: { keyword: subjectId },
    })
    assert.equal(pending.code, 0)
    const formalBefore = await write(`/bob/${entity}/query`, {
      page: 1,
      pageSize: 20,
      filters: { keyword: snapshot.displayName },
    })
    assert.equal(
      formalBefore.data.items.some(
        (item: { objectId: string }) => item.objectId === subjectId,
      ),
      false,
    )
    const disabled = await write(`/bob/${entity}/disable`, {
      objectId: subjectId,
      expectedRevision: '1',
    })
    assert.equal(disabled.code, 0, disabled.errorKey)
    assert.deepEqual(disabled.data, {
      id: subjectId,
      enabled: false,
      revision: '2',
    })
    const approved = await review(`/bob/${entity}/approve`, {
      subjectId,
      submissionId,
      expectedRevision: '1',
    })
    assert.equal(approved.code, 0, approved.errorKey)
    const current = await write(`/bob/${entity}/get`, { objectId: subjectId })
    assert.equal(current.code, 0, current.errorKey)
    assert.equal(current.data.enabled, false)
    assert.equal(current.data.revision, '2')
    assert.equal(current.data.sourceApprovalEntryId, submissionId)
    assert.deepEqual(current.data.data, snapshot)
    const py = await write(`/bob/${entity}/query`, {
      page: 1,
      pageSize: 20,
      filters: { keyword: current.data.py },
    })
    assert.equal(
      py.data.items.some(
        (item: { objectId: string }) => item.objectId === subjectId,
      ),
      true,
    )
    const secondId = ulid()
    const changed = await write(`/bob/${entity}/submit-change`, {
      ...input,
      submissionId: secondId,
      idempotencyKey: ulid(),
      expectedLatestApprovedSubmissionId: submissionId,
      expectedLatestApprovedRevision: approved.data.revision,
      snapshot: { ...snapshot, displayName: '第二版资料' },
    })
    assert.equal(changed.code, 0, changed.errorKey)
    const unchanged = await write(`/bob/${entity}/get`, { objectId: subjectId })
    assert.equal(unchanged.data.sourceApprovalEntryId, submissionId)
    const second = await review(`/bob/${entity}/approve`, {
      subjectId,
      submissionId: secondId,
      expectedRevision: '1',
    })
    assert.equal(second.code, 0, second.errorKey)
    assert.equal(
      (await write(`/bob/${entity}/get`, { objectId: subjectId })).data.enabled,
      false,
    )
    const reversed = await review(`/bob/${entity}/unapprove`, {
      subjectId,
      submissionId: secondId,
      expectedRevision: second.data.revision,
      reason: '核对',
    })
    assert.equal(reversed.code, 0, reversed.errorKey)
    const fallenBack = await write(`/bob/${entity}/get`, {
      objectId: subjectId,
    })
    assert.equal(fallenBack.data.sourceApprovalEntryId, submissionId)
    assert.equal(fallenBack.data.enabled, false)
    assert.equal(fallenBack.data.revision, '2')
    const history = await write(`/bob/${entity}/versions`, { subjectId })
    assert.equal(history.data.items.length, 2)
    const exact = await write(`/bob/${entity}/submission-get`, {
      subjectId,
      submissionId,
    })
    assert.equal(exact.data.submissionId, submissionId)
    const stale = await write(`/bob/${entity}/enable`, {
      objectId: subjectId,
      expectedRevision: '1',
    })
    assert.equal(stale.errorKey, 'conflict')
    const forbidden = await review(`/bob/${entity}/enable`, {
      objectId: subjectId,
      expectedRevision: '2',
    })
    assert.notEqual(forbidden.code, 0)
    // Audit storage failure must roll back the object's CAS and keep versions unchanged.
    const bob = new BobService(db)
    const actor = { id: submitter.userId, permissions: submitPaths }
    await assert.rejects(
      bob.setEnabled(
        entity,
        { objectId: subjectId, expectedRevision: '2' },
        true,
        actor,
        'x'.repeat(129),
      ),
    )
    assert.equal(
      (await write(`/bob/${entity}/get`, { objectId: subjectId })).data
        .revision,
      '2',
    )
    const attempts = await Promise.all([
      write(`/bob/${entity}/enable`, {
        objectId: subjectId,
        expectedRevision: '2',
      }),
      write(`/bob/${entity}/enable`, {
        objectId: subjectId,
        expectedRevision: '2',
      }),
    ])
    assert.equal(attempts.filter((result) => result.code === 0).length, 1)
    assert.equal(
      (await write(`/bob/${entity}/versions`, { subjectId })).data.items.length,
      2,
    )
    if (entity === 'other-unit') {
      const aux = new AuxService(db)
      const auxActor = { id: submitter.userId, permissions: auxPaths }
      const type = await aux.create(
        'dictionary-type',
        { name: `车型${suffix}`, description: '' },
        auxActor,
      )
      const item = await aux.create(
        'dictionary-item',
        { name: '货车', dictionaryTypeId: type.id, sortOrder: 0 },
        auxActor,
      )
      const vehicle = await aux.create(
        'vehicle',
        {
          name: '外部承运车辆',
          plateNumber: `车${suffix}`,
          vehicleTypeId: item.id,
          carrier: {
            kind: 'EXTERNAL',
            otherUnitId: subjectId,
            approvalEntryId: submissionId,
          },
          vin: '',
          engineNumber: '',
          ratedLoadKg: 1000,
          bulkWaterCarrier: false,
          remark: '',
        },
        auxActor,
      )
      const blocked = await write('/bob/other-unit/disable', {
        objectId: subjectId,
        expectedRevision: '3',
      })
      assert.equal(blocked.errorKey, 'conflict')
      assert.equal(blocked.data.blockers[0].objectId, vehicle.id)
      assert.equal(
        (await write('/bob/other-unit/get', { objectId: subjectId })).data
          .revision,
        '3',
      )
      assert.equal(
        (
          await write('/bob/other-unit/delete', {
            subjectId,
            submissionId: secondId,
            expectedRevision: reversed.data.revision,
          })
        ).code,
        0,
      )
      const referenced = await review('/bob/other-unit/unapprove', {
        subjectId,
        submissionId,
        expectedRevision: approved.data.revision,
        reason: '被精确引用',
      })
      assert.equal(referenced.errorKey, 'approval_strong_reference_exists')
      assert.equal(
        referenced.data.blockers.some(
          (blocker: { objectId?: string }) => blocker.objectId === vehicle.id,
        ),
        true,
      )
      await aux.delete(
        'vehicle',
        { id: vehicle.id, revision: vehicle.revision },
        auxActor,
      )
    }
    const legacy = await app.request(`/dcl/${entity}/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId }),
    })
    assert.equal(legacy.status, 404)
  }
  const audit = await sql<{
    n: string
  }>`SELECT count(*)::text AS n FROM app_audit_events WHERE actor_user_id=${submitter.userId} AND event_type LIKE 'BOB_%'`.execute(
    db,
  )
  assert.equal(audit.rows[0]?.n, '6')
})
