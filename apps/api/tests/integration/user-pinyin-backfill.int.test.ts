import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { ulid } from 'ulid'
import { sql } from 'kysely'

import {
  userPinyin,
  UserPinyinMaintenanceService,
} from '../../src/app/user-pinyin.ts'
import { createDatabase } from '../../src/db/database.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const script = fileURLToPath(
  new URL('../../scripts/backfill-user-pinyin.ts', import.meta.url),
)

test('controlled user pinyin backfill preserves identities, credentials, roles, and audit facts', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const suffix = randomBytes(8).toString('hex')
  const userId = ulid()
  const roleId = ulid()
  const auditId = ulid()
  const name = '重庆用户'
  const passwordHash = `unchanged-${suffix}`
  context.after(async () => {
    try {
      await db
        .deleteFrom('app_audit_events')
        .where('id', '=', auditId)
        .execute()
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', '=', userId)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      await db.deleteFrom('app_users').where('id', '=', userId).execute()
    } finally {
      await db.destroy()
    }
  })
  await db
    .insertInto('app_users')
    .values({
      id: userId,
      username: `pinyin-${suffix}`,
      display_name: name,
      py: 'stale-pinyin',
      password_hash: passwordHash,
      status: 'ENABLED',
      password_changed_at: new Date('2026-01-02T03:04:05.000Z'),
      password_change_required: false,
    })
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `pinyin-${suffix}`,
      name: 'Pinyin backfill role',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_user_roles')
    .values({ user_id: userId, role_id: roleId, created_by: userId })
    .execute()
  await db
    .insertInto('app_audit_events')
    .values({
      id: auditId,
      event_type: 'PINYIN_BACKFILL_FIXTURE',
      actor_user_id: userId,
      target_type: 'user',
      target_id: userId,
      result: 'SUCCESS',
      request_id: `pinyin-${suffix}`,
      summary: JSON.stringify({ preserved: true }),
      created_by: userId,
    })
    .execute()
  const before = {
    user: await db
      .selectFrom('app_users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow(),
    role: await db
      .selectFrom('app_user_roles')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow(),
    audit: await db
      .selectFrom('app_audit_events')
      .selectAll()
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow(),
  }
  const service = new UserPinyinMaintenanceService(db)
  const preview = await service.inspect()
  assert.ok(preview.changedUsers >= 1)
  assert.match(preview.factsSha256, /^[a-f0-9]{64}$/)

  const rejected = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TARGET_DATABASE_URL: databaseUrl,
      TARGET_DATABASE_SCOPE: 'isolated',
      USER_PY_BACKFILL_APPLY: 'true',
      USER_PY_BACKFILL_EXPECTED_USER_COUNT: String(preview.userCount),
      USER_PY_BACKFILL_EXPECTED_FACTS_SHA256: '0'.repeat(64),
    },
  })
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stderr, /baseline changed; inspect again/)
  assert.equal(
    await db
      .selectFrom('app_users')
      .select('py')
      .where('id', '=', userId)
      .executeTakeFirstOrThrow()
      .then((row) => row.py),
    'stale-pinyin',
  )

  const applied = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TARGET_DATABASE_URL: databaseUrl,
      TARGET_DATABASE_SCOPE: 'isolated',
      USER_PY_BACKFILL_APPLY: 'true',
      USER_PY_BACKFILL_EXPECTED_USER_COUNT: String(preview.userCount),
      USER_PY_BACKFILL_EXPECTED_FACTS_SHA256: preview.factsSha256,
    },
  })
  assert.equal(applied.status, 0, applied.stderr)
  assert.match(applied.stdout, /user pinyin backfill applied:/)
  assert.match(applied.stdout, /changed=[1-9]\d*/)

  const after = {
    user: await db
      .selectFrom('app_users')
      .selectAll()
      .where('id', '=', userId)
      .executeTakeFirstOrThrow(),
    role: await db
      .selectFrom('app_user_roles')
      .selectAll()
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow(),
    audit: await db
      .selectFrom('app_audit_events')
      .selectAll()
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow(),
  }
  assert.equal(after.user.py, userPinyin(name))
  assert.equal(after.user.py, 'chongqingyonghu')
  assert.deepEqual({ ...after.user, py: before.user.py }, before.user)
  assert.deepEqual(after.role, before.role)
  assert.deepEqual(after.audit, before.audit)
  const terminal = await service.inspect()
  assert.equal(terminal.changedUsers, 0)
  assert.equal(terminal.factsSha256, preview.factsSha256)
  assert.equal(terminal.columnRequired, true)
  assert.equal(terminal.constraintPresent, true)

  // Rehearse the actual pre-slice schema, where the pinyin column is absent.
  await sql`ALTER TABLE public.app_users DROP COLUMN py`.execute(db)
  const oldSchema = await service.inspect()
  assert.equal(oldSchema.columnPresent, false)
  assert.equal(oldSchema.factsSha256, preview.factsSha256)
  const converted = await service.apply(oldSchema)
  assert.equal(converted.columnPresent, true)
  assert.equal(converted.columnRequired, true)
  assert.equal(converted.constraintPresent, true)
  assert.equal(converted.factsSha256, preview.factsSha256)
  const restoredUser = await db
    .selectFrom('app_users')
    .selectAll()
    .where('id', '=', userId)
    .executeTakeFirstOrThrow()
  assert.equal(restoredUser.py, 'chongqingyonghu')
  assert.deepEqual({ ...restoredUser, py: before.user.py }, before.user)
  const repeated = await service.apply(converted)
  assert.equal(repeated.changedUsers, 0)
  assert.equal(repeated.factsSha256, preview.factsSha256)
})
