import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedOpeningFixture } from '../fixtures/vou-opening.ts'
import {
  OpeningMigrationService,
  OpeningMigrationError,
} from '../../src/vou/opening-migration.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

test('opening conversion preserves approval/book/reference identity, audit and exact read authority', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedOpeningFixture(db)
    const pending = await f.opening.submitOpening(
      f.input,
      f.submitter.actor,
      'historical-submit',
    )
    await f.opening.reviewOpening(
      'approve',
      {
        bookId: f.book.id,
        submissionId: f.input.submissionId,
        expectedRevision: '1',
      },
      f.reviewer.actor,
      'historical-approve',
    )
    // Historical source fixture: identical stored facts with the previous owner and permission path.
    await db
      .updateTable('approval_entries')
      .set({ domain: 'acc' })
      .where('id', '=', pending.submissionId)
      .execute()
    await db
      .updateTable('approval_events')
      .set({ domain: 'acc' })
      .where('entry_id', '=', pending.submissionId)
      .execute()
    await db
      .deleteFrom('vou_idempotency')
      .where('entity', '=', 'opening')
      .where('submission_id', '=', pending.submissionId)
      .execute()
    const oldId = ulid()
    await db
      .insertInto('app_permissions')
      .values({
        id: oldId,
        path: '/acc/opening/query',
        domain: 'acc',
        entity: 'opening',
        action: 'query',
        status: 'ENABLED',
        description: '历史期初读取',
      })
      .onConflict((c) => c.column('path').doNothing())
      .execute()
    const old = await db
      .selectFrom('app_permissions')
      .select('id')
      .where('path', '=', '/acc/opening/query')
      .executeTakeFirstOrThrow()
    await db
      .deleteFrom('app_role_permissions')
      .where('role_id', '=', f.reader.roleId)
      .execute()
    await db
      .insertInto('app_role_permissions')
      .values({ role_id: f.reader.roleId, permission_id: old.id })
      .execute()
    const before = await db
      .selectFrom('approval_events')
      .selectAll()
      .where('entry_id', '=', pending.submissionId)
      .orderBy('id')
      .execute()
    const snapshot = await db
      .selectFrom('acc_opening_snapshots')
      .selectAll()
      .where('approval_entry_id', '=', pending.submissionId)
      .executeTakeFirstOrThrow()
    const catalog = await readTargetPermissionCatalog()
    await assert.rejects(
      new TargetBootstrapService(db).migratePermissionCatalog(catalog),
      /migrate:vou-opening/,
    )
    await new OpeningMigrationService(db).migrate(catalog)
    const migrated = await f.opening.getOpening(f.book.id, f.reader.actor)
    assert.equal(migrated.submissionId, pending.submissionId)
    assert.equal(migrated.documentId, f.book.id)
    assert.equal(migrated.approval.domain, 'vou')
    assert.equal(migrated.status, 'APPROVED')
    assert.equal(migrated.revision, '2')
    assert.deepEqual(
      await db
        .selectFrom('acc_opening_snapshots')
        .selectAll()
        .where('approval_entry_id', '=', pending.submissionId)
        .executeTakeFirstOrThrow(),
      snapshot,
    )
    assert.deepEqual(
      await db
        .selectFrom('approval_events')
        .selectAll()
        .where('entry_id', '=', pending.submissionId)
        .orderBy('id')
        .execute(),
      before.map((row) => ({ ...row, domain: 'vou' })),
    )
    const paths = await db
      .selectFrom('app_role_permissions as g')
      .innerJoin('app_permissions as p', 'p.id', 'g.permission_id')
      .select('p.path')
      .where('g.role_id', '=', f.reader.roleId)
      .orderBy('p.path')
      .execute()
    assert.deepEqual(
      paths.map((row) => row.path),
      ['/vou/opening/get', '/vou/opening/query'],
    )
    const replay = await f.opening.submitOpening(
      f.input,
      f.submitter.actor,
      'historical-retry',
    )
    assert.equal(replay.submissionId, pending.submissionId)
    assert.equal(
      (await new OpeningMigrationService(db).migrate(catalog))
        .convertedOpenings,
      0,
    )
  })
})

test('a conflicting historical opening intent rolls back the entire conversion', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedOpeningFixture(db)
    await f.opening.submitOpening(
      f.input,
      f.submitter.actor,
      'historical-submit',
    )
    await db
      .updateTable('approval_entries')
      .set({ domain: 'acc' })
      .where('id', '=', f.input.submissionId)
      .execute()
    await db
      .updateTable('approval_events')
      .set({ domain: 'acc' })
      .where('entry_id', '=', f.input.submissionId)
      .execute()
    await assert.rejects(
      new OpeningMigrationService(db).migrate(
        await readTargetPermissionCatalog(),
      ),
      (error) =>
        error instanceof OpeningMigrationError &&
        error.blockers[0]?.reason === 'DUPLICATE_IDEMPOTENCY_KEY',
    )
    const unchanged = await db
      .selectFrom('approval_entries')
      .select(['domain', 'status', 'revision'])
      .where('id', '=', f.input.submissionId)
      .executeTakeFirstOrThrow()
    assert.equal(unchanged.domain, 'acc')
    assert.equal(unchanged.status, 'PENDING')
    assert.equal(String(unchanged.revision), '1')
    const audit = await db
      .selectFrom('approval_events')
      .select('domain')
      .where('entry_id', '=', f.input.submissionId)
      .execute()
    assert.deepEqual(
      audit.map((row) => row.domain),
      ['acc'],
    )
  })
})
