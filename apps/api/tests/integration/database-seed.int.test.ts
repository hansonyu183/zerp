import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { promisify } from 'node:util'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import {
  internalBookId,
  internalBookSubjects,
} from '../../src/acc/internal-book-seed.ts'
import { AccService } from '../../src/acc/service.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { createDatabase } from '../../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../../src/platform/config.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

test('database seed is atomic, concurrent-safe and preserves subsequent book maintenance', async (context) => {
  const source = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(source, 'TARGET_TEST_DATABASE_URL is required')
  assertTargetDatabaseBoundary(source, 'isolated')
  const suffix = randomBytes(6).toString('hex')
  const databaseName = `seed_${suffix}_test`
  const owner = createDatabase(source)
  const url = new URL(source)
  url.pathname = `/${databaseName}`
  const db = createDatabase(url.toString())
  context.after(async () => {
    try {
      await db.destroy()
      // Pool shutdown can precede the socket end callback. Let PostgreSQL wait
      // for graceful disconnect instead of sending an error to a closing client.
      await sql.raw(`DROP DATABASE IF EXISTS "${databaseName}"`).execute(owner)
    } finally {
      await owner.destroy()
    }
  })
  await sql.raw(`CREATE DATABASE "${databaseName}"`).execute(owner)
  const schema = await readFile(
    new URL('../../db/target-schema.sql', import.meta.url),
    'utf8',
  )
  await sql.raw(schema).execute(db)
  const bootstrap = new TargetBootstrapService(db)
  await bootstrap.syncPermissionCatalog(await readTargetPermissionCatalog())
  const administrators = ['seed-admin-one', 'seed-admin-two'].map(
    (username) => ({
      username,
      displayName: username,
      password: `Initial!Aa1${suffix}`,
    }),
  )
  const seed = (overrides: Record<string, string> = {}) =>
    promisify(execFile)(
      process.execPath,
      [new URL('../../scripts/seed-database.ts', import.meta.url).pathname],
      {
        env: {
          ...process.env,
          TARGET_DATABASE_URL: url.toString(),
          TARGET_DATABASE_SCOPE: 'isolated',
          APP_ADMIN_1_USERNAME: administrators[0]!.username,
          APP_ADMIN_2_USERNAME: administrators[1]!.username,
          ...overrides,
        },
      },
    )
  const emptyBookFacts = async () => {
    assert.deepEqual(await db.selectFrom('acc_books').selectAll().execute(), [])
    assert.deepEqual(
      await db.selectFrom('acc_subjects').selectAll().execute(),
      [],
    )
    assert.deepEqual(
      await db.selectFrom('acc_book_access').selectAll().execute(),
      [],
    )
  }
  await assert.rejects(seed())
  await emptyBookFacts()
  await bootstrap.initializeAdministrators(administrators, 12)
  await assert.rejects(
    seed({ APP_ADMIN_2_USERNAME: administrators[0]!.username }),
  )
  await emptyBookFacts()

  // A late persistence failure must roll back the book, permissions and earlier subjects.
  await sql`ALTER TABLE acc_subjects ADD CONSTRAINT seed_failure CHECK (code <> '5801')`.execute(
    db,
  )
  await assert.rejects(seed())
  await emptyBookFacts()
  await sql`ALTER TABLE acc_subjects DROP CONSTRAINT seed_failure`.execute(db)
  const results = await Promise.all([seed(), seed()])
  assert.deepEqual(
    results.map((result) => result.stdout.trim().split(';')[0]).sort(),
    [
      'database seed: internal book created',
      'database seed: internal book unchanged',
    ],
  )
  const seededRoles = await db.selectFrom('app_roles').selectAll().execute()
  assert.equal(seededRoles.length, 13)
  assert.deepEqual(
    seededRoles
      .filter((role) => role.code !== 'superadmin')
      .map((role) => role.name)
      .sort(),
    [
      '客服',
      '客服主管',
      '业务员',
      '业务经理',
      '采购员',
      '采购主管',
      '仓库管理员',
      '仓库主管',
      '会计',
      '会计主管',
      '档案管理员',
      '人事主管',
    ].sort(),
  )
  assert.equal(
    seededRoles.find((role) => role.name === '业务员')!.customer_scope,
    'OWN',
  )
  const grants = async (name: string) =>
    (
      await db
        .selectFrom('app_role_permissions as rp')
        .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
        .select('p.path')
        .where(
          'rp.role_id',
          '=',
          seededRoles.find((role) => role.name === name)!.id,
        )
        .execute()
    ).map((row) => row.path)
  const salespersonPaths = await grants('业务员')
  assert.ok(salespersonPaths.includes('/vou/sale-order/submit-new'))
  assert.ok(!salespersonPaths.includes('/vou/sale-order/approve'))
  assert.ok(!salespersonPaths.some((path) => path.startsWith('/app/')))
  assert.ok((await grants('业务经理')).includes('/vou/sale-order/approve'))
  assert.ok((await grants('客服主管')).includes('/vou/sales-receipt/approve'))
  assert.ok(
    (await grants('客服')).includes(
      '/wfl/process-instance/create-sale-delivery',
    ),
  )
  assert.ok(
    !(await grants('客服')).includes(
      '/wfl/process-instance/create-sale-outbound',
    ),
  )
  assert.ok(
    (await grants('仓库管理员')).includes(
      '/wfl/process-instance/create-sale-outbound',
    ),
  )
  assert.ok(
    !(await grants('仓库管理员')).includes('/vou/sale-outbound/approve'),
  )
  assert.ok((await grants('仓库主管')).includes('/vou/sale-outbound/approve'))
  assert.ok((await grants('会计主管')).includes('/acc/period/lock'))
  assert.ok(!(await grants('档案管理员')).includes('/dcl/customer/approve'))
  assert.equal(
    (await db.selectFrom('rpt_definitions').select('id').execute()).length,
    4,
  )
  assert.equal(
    (await db.selectFrom('app_user_roles').selectAll().execute()).length,
    2,
  )
  const users = await db
    .selectFrom('app_users')
    .select(['id', 'username'])
    .orderBy('username')
    .execute()
  const actor = { id: users[0]!.id, permissions: [], trusted: true }
  const acc = new AccService(db)
  const book = await acc.getBook(internalBookId, actor)
  assert.equal(book.name, '内账')
  assert.equal(book.code, 'ACC-0001')
  assert.equal(book.startMonth, '2026-01')
  assert.equal(book.baseCurrency, 'CNY')
  assert.equal(book.controlBook, true)
  assert.deepEqual(
    [...book.queryUserIds].sort(),
    users.map((user) => user.id).sort(),
  )
  assert.deepEqual(
    [...book.operateUserIds].sort(),
    [...book.queryUserIds].sort(),
  )
  const subjects = await acc.querySubjects(
    { bookId: internalBookId, pageSize: 200 },
    actor,
  )
  assert.equal(subjects.total, 185)
  const byCode = new Map(
    subjects.items.map((subject) => [subject.code, subject]),
  )
  for (const expected of internalBookSubjects) {
    const subject = byCode.get(expected.code)!
    assert.equal(subject.name, expected.name)
    assert.equal(subject.balanceDirection, expected.balanceDirection)
    assert.equal(
      subject.parentId,
      expected.parentCode ? byCode.get(expected.parentCode)!.id : null,
    )
    assert.deepEqual(subject.requiredDimensions, expected.requiredDimensions)
    assert.equal(subject.inventoryQuantity, false)
    assert.equal(subject.settlementPurpose, expected.settlementPurpose)
  }
  assert.equal(byCode.get('2171.01.01')!.parentId, byCode.get('2171.01')!.id)
  assert.deepEqual(byCode.get('1131')!.requiredDimensions, ['CUSTOMER'])
  assert.equal(byCode.get('1131')!.settlementPurpose, 'RECEIVABLE')
  assert.equal(byCode.get('1151')!.settlementPurpose, 'PREPAID')
  assert.equal(byCode.get('2121')!.settlementPurpose, 'PAYABLE')
  assert.equal(byCode.get('2131')!.settlementPurpose, 'ADVANCE_RECEIPT')
  // No sample opening, approval, mapping, personnel or departmental facts are imported.
  for (const table of [
    'approval_entries',
    'acc_mappings',
    'acc_journal_entries',
    'aux_objects',
  ] as const) {
    const rows = await sql<{
      count: string
    }>`SELECT count(*)::text AS count FROM ${sql.table(table)}`.execute(db)
    assert.equal(rows.rows[0]!.count, '0', table)
  }
  await acc.saveBook(
    {
      ...book,
      expectedRevision: book.revision,
      name: '已维护内账',
      queryUserIds: [actor.id],
      operateUserIds: [actor.id],
    },
    actor,
  )
  const leaf = byCode.get('5801')!
  await acc.deleteSubject(leaf.id, leaf.revision, actor)
  const current = byCode.get('1001.01')!
  await acc.saveSubject(
    {
      ...current,
      balanceDirection: 'DEBIT',
      requiredDimensions: [],
      settlementPurpose: 'NONE',
      name: '人民币现金',
      expectedRevision: current.revision,
    },
    actor,
  )
  const snapshot = async () => ({
    roles: await db.selectFrom('app_roles').selectAll().orderBy('id').execute(),
    grants: await db
      .selectFrom('app_role_permissions')
      .selectAll()
      .orderBy('role_id')
      .orderBy('permission_id')
      .execute(),
    reports: await db
      .selectFrom('rpt_definitions')
      .selectAll()
      .orderBy('id')
      .execute(),
    books: await db.selectFrom('acc_books').selectAll().orderBy('id').execute(),
    access: await db
      .selectFrom('acc_book_access')
      .selectAll()
      .orderBy('user_id')
      .execute(),
    subjects: await db
      .selectFrom('acc_subjects')
      .selectAll()
      .orderBy('code')
      .execute(),
  })
  const before = await snapshot()
  assert.match((await seed()).stdout, /unchanged/)
  assert.deepEqual(await snapshot(), before)

  // On a different baseline, initialization cannot silently create a second book.
  await sql.raw('DROP SCHEMA public CASCADE; CREATE SCHEMA public;').execute(db)
  await sql.raw(schema).execute(db)
  await bootstrap.syncPermissionCatalog(await readTargetPermissionCatalog())
  await bootstrap.initializeAdministrators(administrators, 12)
  const newUser = await db
    .selectFrom('app_users')
    .select('id')
    .orderBy('username')
    .executeTakeFirstOrThrow()
  const other = await acc.createBook(
    {
      id: ulid(),
      name: '既有账簿',
      description: '',
      startMonth: '2025-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    { ...actor, id: newUser.id },
  )
  await assert.rejects(seed())
  assert.deepEqual(await db.selectFrom('acc_books').select('id').execute(), [
    { id: other.id },
  ])
})
