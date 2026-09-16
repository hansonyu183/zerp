import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import {
  seedBusinessData,
  businessSeedBookId,
} from '../../scripts/lib/business-seed.ts'
import { withWflDatabase } from './wfl-fixture.ts'

test('business seed rolls back a failed installation and preserves a completed dataset on repeat', async () => {
  await withWflDatabase(async (db) => {
    const password = randomBytes(24).toString('base64url')
    await new TargetBootstrapService(db).seedOnlineTestUsers([
      { username: 'tester', displayName: '测试用户', password },
      { username: 'test-admin', displayName: '测试管理员', password },
    ])
    const pool = new pg.Pool({
      connectionString: process.env.TARGET_TEST_DATABASE_URL,
    })
    const unavailablePool = new pg.Pool({
      connectionString: process.env.TARGET_TEST_DATABASE_URL,
    })
    await unavailablePool.end()
    try {
      const before = await db
        .selectFrom('aux_objects')
        .select('id')
        .orderBy('id')
        .execute()
      await assert.rejects(seedBusinessData(db, unavailablePool))
      assert.deepEqual(
        await db.selectFrom('aux_objects').select('id').orderBy('id').execute(),
        before,
      )
      assert.equal(
        await db
          .selectFrom('acc_books')
          .select('id')
          .where('id', '=', businessSeedBookId)
          .executeTakeFirst(),
        undefined,
      )
      assert.equal((await seedBusinessData(db, pool)).created, true)
      const entries = await db
        .selectFrom('approval_entries')
        .select(['id', 'status', 'revision', 'submitted_by', 'approved_by'])
        .orderBy('id')
        .execute()
      for (const status of ['PENDING', 'APPROVED', 'REJECTED'])
        assert.ok(entries.some((row) => row.status === status))
      for (const row of entries.filter((row) => row.status === 'APPROVED'))
        assert.notEqual(row.submitted_by, row.approved_by)
      const journals = await db
        .selectFrom('acc_journal_entries')
        .select('id')
        .where('book_id', '=', businessSeedBookId)
        .execute()
      assert.ok(
        journals.length >= 3,
        'approved payments must produce real journal entries',
      )
      assert.equal((await seedBusinessData(db, pool)).created, false)
      assert.deepEqual(
        await db
          .selectFrom('approval_entries')
          .select(['id', 'status', 'revision', 'submitted_by', 'approved_by'])
          .orderBy('id')
          .execute(),
        entries,
      )
    } finally {
      await pool.end()
    }
  })
})
