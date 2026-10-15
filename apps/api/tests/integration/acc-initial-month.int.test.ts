import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ulid } from 'ulid'
import { AccService } from '../../src/acc/service.ts'
import { internalBookId } from '../../src/acc/internal-book-seed.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { withCommittedPurchaseDatabase } from '../fixtures/vou-purchase-http.ts'

// Tests only the new initialization boundary, with synthetic exclusive books.
test('explicit October control-book initialization preserves VAT detail and cannot revise an existing January book', async () => {
  for (const startMonth of ['2026-10', '2026-01']) {
    await withCommittedPurchaseDatabase(async (db, databaseUrl) => {
      const administrators = ['one', 'two'].map((name) => ({
        username: `month-${name}-${ulid()}`.toLowerCase(),
        displayName: '合成初始化管理员',
        password: `Initial!Aa1${ulid()}`,
      }))
      const bootstrap = new TargetBootstrapService(db)
      await bootstrap.initializeAdministrators(administrators, 12)
      const acc = new AccService(db)
      const usernames = administrators.map((user) => user.username)
      await assert.rejects(acc.initializeInternalBook(usernames, '2026-13'))
      assert.equal(
        (await db.selectFrom('acc_books').select('id').execute()).length,
        0,
      )
      const seed = () =>
        promisify(execFile)(
          process.execPath,
          [new URL('../../scripts/seed-database.ts', import.meta.url).pathname],
          {
            env: {
              ...process.env,
              TARGET_DATABASE_URL: databaseUrl,
              TARGET_DATABASE_SCOPE: 'isolated',
              APP_ADMIN_1_USERNAME: usernames[0],
              APP_ADMIN_2_USERNAME: usernames[1],
              ACC_INITIAL_BOOK_START_MONTH: startMonth,
            },
          },
        )
      assert.match((await seed()).stdout, /internal book created/)

      const principal = await db
        .selectFrom('app_users')
        .select('id')
        .where('username', '=', usernames[0]!)
        .executeTakeFirstOrThrow()
      const actor = { id: principal.id, permissions: [], trusted: true }
      const before = await acc.getBook(internalBookId, actor)
      assert.equal(before.startMonth, startMonth)
      assert.equal(before.controlBook, true)
      const subjects = await acc.querySubjects(
        { bookId: before.id, pageSize: 200 },
        actor,
      )
      const byCode = new Map(
        subjects.items.map((subject) => [subject.code, subject]),
      )
      for (const [code, name, direction] of [
        ['2171.01.01', '进项税额', 'DEBIT'],
        ['2171.01.05', '销项税额', 'CREDIT'],
        ['2171.01.07', '进项税额转出', 'CREDIT'],
      ]) {
        const subject = byCode.get(code!)!
        assert.equal(subject.name, name)
        assert.equal(subject.balanceDirection, direction)
        assert.equal(subject.parentId, byCode.get('2171.01')!.id)
      }
      assert.equal(
        await acc.initializeInternalBook(usernames, startMonth),
        'unchanged',
      )
      await assert.rejects(
        acc.initializeInternalBook(
          usernames,
          startMonth === '2026-10' ? '2026-01' : '2026-10',
        ),
      )
      assert.deepEqual(await acc.getBook(internalBookId, actor), before)
      assert.deepEqual(
        await acc.querySubjects({ bookId: before.id, pageSize: 200 }, actor),
        subjects,
      )
      assert.equal(
        (await db.selectFrom('acc_opening_snapshots').selectAll().execute())
          .length,
        0,
      )
    })
  }
})
