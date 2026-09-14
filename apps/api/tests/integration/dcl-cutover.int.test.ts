import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'
import { createDatabase } from '../../src/db/database.ts'
import {
  inspectArchiveCutover,
  migrateArchiveOwnership,
} from '../../src/dcl/cutover.ts'
import {
  inspectCustomerCutover,
  migrateCustomers,
} from '../../src/dcl/customer-cutover/service.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { SessionService, hashPassword } from '../../src/app/session.ts'
import { createApp } from '../../src/app.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { AuxService } from '../../src/aux/service.ts'
import { BobService } from '../../src/bob/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'

test('ownership migration preserves formal/history facts and exact grants, and rolls back a failed conversion', async (context) => {
  assert.ok(process.env.TARGET_TEST_DATABASE_URL)
  const admin = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const name = `archive_438_${ulid().toLowerCase()}_test`
  await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin)
  const url = new URL(process.env.TARGET_TEST_DATABASE_URL)
  url.pathname = `/${name}`
  const db = createDatabase(url.toString())
  context.after(async () => {
    await db.destroy()
    await sql`DROP DATABASE ${sql.id(name)}`.execute(admin)
    await admin.destroy()
  })
  const baselineSql = await readFile(
    new URL('../fixtures/issue-438-before.sql', import.meta.url),
    'utf8',
  )
  await sql.raw(baselineSql).execute(db)
  const catalog = await readTargetPermissionCatalog()
  const legacy = [
    ...new Map(
      catalog.map((row) => {
        const path = row.path.replace('/dcl/', '/bob/')
        return [
          path,
          {
            ...row,
            path,
            domain: row.domain === 'dcl' ? 'bob' : row.domain,
            id: `01J${createHash('sha256').update(path).digest('hex').slice(0, 23).toUpperCase()}`,
          },
        ]
      }),
    ).values(),
  ]
  const bootstrap = new TargetBootstrapService(db)
  await bootstrap.syncPermissionCatalog(legacy)
  const password = randomBytes(24).toString('hex')
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `cutover-${ulid()}`,
    passwordHash: await hashPassword(password),
  }
  await bootstrap.createE2EPrincipal(principal, false, [
    '/bob/supplier/get',
    '/bob/supplier/versions',
    '/bob/supplier/submission-get',
    '/bob/supplier/submit-change',
    '/bob/supplier/delete',
    '/aux/payment-method/delete',
    '/bob/customer/attachment-read',
  ])
  const objectId = ulid(),
    entryId = ulid(),
    pendingId = ulid()
  await sql`INSERT INTO bob_subjects(id,entity,code,enabled,revision,created_at,created_by) VALUES (${objectId},'supplier','SUP-0042',false,7,now(),${principal.userId})`.execute(
    db,
  )
  for (const [id, version, status, title] of [
    [entryId, 1, 'APPROVED', '旧正式资料'],
    [pendingId, 2, 'PENDING', '待批变更'],
  ] as const) {
    await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,updated_by,updated_at) VALUES (${id},'bob','supplier',${objectId},${version},${status},3,${principal.userId},now(),${principal.userId},now())`.execute(
      db,
    )
    await sql`INSERT INTO bob_supplier_versions(approval_entry_id,kind,legal_name,legal_identifier,display_name) VALUES (${id},'ORGANIZATION','供方税务名称','TAX-438',${title})`.execute(
      db,
    )
  }
  const legacySubject = ulid(),
    legacyEntry = ulid(),
    legacyEvent = ulid(),
    auxId = ulid()
  await sql`INSERT INTO dcl_subjects(id,entity,code,created_at,created_by) VALUES (${legacySubject},'supplier','SUP-0043',now(),${principal.userId})`.execute(
    db,
  )
  await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,updated_by,updated_at) VALUES (${legacyEntry},'dcl','supplier',${legacySubject},1,'REJECTED',1,${principal.userId},now(),${principal.userId},now())`.execute(
    db,
  )
  await sql`INSERT INTO approval_events(id,entry_id,domain,entity,subject_id,version_no,action,actor_id,request_id,created_at) VALUES (${legacyEvent},${legacyEntry},'dcl','supplier',${legacySubject},1,'REJECTED',${principal.userId},'legacy-evidence',now())`.execute(
    db,
  )
  const legacyBefore = await db
    .selectFrom('approval_entries')
    .selectAll()
    .where('id', '=', legacyEntry)
    .executeTakeFirstOrThrow()
  await sql`INSERT INTO aux_objects(id,entity,code,created_by,updated_by) VALUES (${auxId},'payment-method','PAY-0042',${principal.userId},${principal.userId})`.execute(
    db,
  )
  await sql`INSERT INTO aux_reference_facts(id,aux_object_id,source) VALUES (${ulid()},${auxId},${`bob:supplier:${pendingId}:paymentMethodId`})`.execute(
    db,
  )
  const before = await inspectArchiveCutover(db)
  await assert.rejects(
    migrateArchiveOwnership(db, 'stale-baseline', catalog),
    /baseline_changed/,
  )
  assert.deepEqual(await inspectArchiveCutover(db), before)
  // A missing target grant fails late, after DDL and payload ownership conversion.
  await assert.rejects(
    migrateArchiveOwnership(
      db,
      before.baseline,
      catalog.filter((row) => row.path !== '/dcl/supplier/submit-change'),
    ),
    /authority_mismatch/,
  )
  assert.deepEqual(await inspectArchiveCutover(db), before)
  const report = await migrateArchiveOwnership(db, before.baseline, catalog)
  assert.equal(report.preserved, true)
  assert.deepEqual(
    await db
      .selectFrom('approval_entries')
      .selectAll()
      .where('id', '=', legacyEntry)
      .executeTakeFirstOrThrow(),
    legacyBefore,
  )
  assert.deepEqual(report.facts, before.facts)
  const migrationOperator = {
    userId: ulid(),
    roleId: ulid(),
    username: `operator-${ulid()}`,
    passwordHash: await hashPassword(randomBytes(24).toString('hex')),
  }
  await bootstrap.createE2EPrincipal(migrationOperator, true)
  const customerBaseline = await inspectCustomerCutover(db)
  assert.deepEqual(customerBaseline.review, [])
  await migrateCustomers(
    db,
    {
      baseline: customerBaseline.baseline,
      sourceReleaseSha: 'a'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
      actorId: migrationOperator.userId,
    },
    catalog,
  )
  const config = loadConfig({
    DATABASE_URL: url.toString(),
    TARGET_DATABASE_SCOPE: 'isolated',
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    bob: new BobService(db),
    aux: new AuxService(db),
    dclArchives: new DclArchiveService(db),
  })
  const signin = await app.request('/session/auth/signin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    },
    body: JSON.stringify({ code: principal.username, password }),
  })
  const signed = await signin.json()
  assert.equal(signed.code, 0)
  const call = async (path: string, input: unknown) =>
    (
      await app.request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-zerp-model-build': modelBuildId,
          'x-csrf-token': signed.data.csrfToken,
          cookie: signin.headers.getSetCookie()[0]!,
        },
        body: JSON.stringify(input),
      })
    ).json()
  const formal = await call('/bob/supplier/get', { objectId })
  assert.equal(formal.code, 0)
  assert.equal(formal.data.data.displayName, '旧正式资料')
  assert.equal(formal.data.enabled, false)
  assert.equal(formal.data.revision, '7')
  assert.equal(formal.data.sourceApprovalEntryId, entryId)
  const history = await call('/bob/supplier/versions', { subjectId: objectId })
  assert.deepEqual(
    history.data.items.map((row: { submissionId: string }) => row.submissionId),
    [pendingId, entryId],
  )
  assert.equal(
    (
      await call('/dcl/supplier/submission-get', {
        subjectId: objectId,
        submissionId: pendingId,
      })
    ).data.snapshot.displayName,
    '待批变更',
  )
  assert.equal(
    (
      await call('/dcl/supplier/approve', {
        subjectId: objectId,
        submissionId: pendingId,
        expectedRevision: '3',
      })
    ).errorKey,
    'forbidden',
  )
  assert.equal(
    (await call('/bob/supplier/enable', { objectId, expectedRevision: '7' }))
      .errorKey,
    'forbidden',
  )
  assert.equal(
    (
      await call('/dcl/supplier/delete', {
        subjectId: objectId,
        submissionId: pendingId,
        expectedRevision: '3',
      })
    ).code,
    0,
  )
  assert.equal(
    (await call('/aux/payment-method/delete', { id: auxId, revision: '1' }))
      .code,
    0,
  )
})
