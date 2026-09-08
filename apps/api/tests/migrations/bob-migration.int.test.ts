import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import { createDatabase } from '../../src/db/database.ts'
import { BobArchiveMigrationService } from '../../src/bob/migration.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'

// Run against the existing source before the one-time conversion. All fixture
// and DDL changes roll back, including the successful conversion inspection.
test('BOB migration preserves version identities and exact grants atomically', async (context) => {
  const url = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(url)
  const db = createDatabase(url)
  context.after(() => db.destroy())
  const source = await sql<{
    name: string | null
  }>`SELECT to_regclass('dcl_supplier_versions')::text AS name`.execute(db)
  assert.ok(source.rows[0]?.name, 'pinned pre-migration schema is required')
  const catalog: TargetPermissionCatalogEntry[] = JSON.parse(
    await readFile(
      new URL(
        '../../src/generated/target-permission-catalog.json',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const actorId = ulid(),
    subjectId = ulid(),
    entry1 = ulid(),
    entry2 = ulid(),
    roleId = ulid()
  const rollback = new Error('rollback inspected migration')
  await assert.rejects(
    db.transaction().execute(async (tx) => {
      await sql`INSERT INTO app_users(id,username,display_name,py,password_hash,status,password_changed_at) VALUES (${actorId},${`migration-${actorId}`},'迁移验证','qianyiyanzheng','unused','ENABLED',now())`.execute(
        tx,
      )
      await sql`INSERT INTO dcl_subjects(id,entity,code,created_at,created_by) VALUES (${subjectId},'supplier','SUP-9999',now(),${actorId})`.execute(
        tx,
      )
      for (const [entryId, version, status, enabled] of [
        [entry1, 1, 'APPROVED', false],
        [entry2, 2, 'PENDING', true],
      ] as const) {
        await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,updated_by,updated_at)
        VALUES (${entryId},'dcl','supplier',${subjectId},${version},${status},1,${actorId},now(),${actorId},now())`.execute(
          tx,
        )
        await sql`INSERT INTO dcl_supplier_versions(approval_entry_id,kind,legal_name,display_name,legal_identifier,enabled)
        VALUES (${entryId},'PERSON','历史供应商','历史供应商',${subjectId},${enabled})`.execute(
          tx,
        )
      }
      await sql`INSERT INTO app_roles(id,code,name,status) VALUES (${roleId},${roleId},'迁移有限权限','ENABLED')`.execute(
        tx,
      )
      await sql`INSERT INTO app_role_permissions(role_id,permission_id) SELECT ${roleId},id FROM app_permissions WHERE path IN ('/dcl/supplier/query','/dcl/supplier/get','/dcl/supplier/submit-change')`.execute(
        tx,
      )
      const grantsBefore = await sql<{
        n: string
      }>`SELECT count(*)::text AS n FROM app_role_permissions WHERE role_id=${roleId}`.execute(
        tx,
      )
      assert.equal(grantsBefore.rows[0]?.n, '3')
      await new BobArchiveMigrationService(db).migrateInTransaction(tx, catalog)
      const current = await sql<{
        id: string
        code: string
        enabled: boolean
        revision: string
      }>`SELECT id,code,enabled,revision::text AS revision FROM bob_subjects WHERE id=${subjectId}`.execute(
        tx,
      )
      assert.deepEqual(current.rows, [
        { id: subjectId, code: 'SUP-9999', enabled: false, revision: '1' },
      ])
      const history = await sql<{
        id: string
        domain: string
        version_no: number
        status: string
      }>`SELECT id,domain,version_no,status FROM approval_entries WHERE subject_id=${subjectId} ORDER BY version_no`.execute(
        tx,
      )
      assert.deepEqual(history.rows, [
        { id: entry1, domain: 'bob', version_no: 1, status: 'APPROVED' },
        { id: entry2, domain: 'bob', version_no: 2, status: 'PENDING' },
      ])
      const evidence = await sql<{
        approval_entry_id: string
        enabled: boolean
      }>`SELECT * FROM bob_legacy_enablement_evidence WHERE approval_entry_id IN (${entry1},${entry2}) ORDER BY approval_entry_id`.execute(
        tx,
      )
      assert.deepEqual(
        Object.fromEntries(
          evidence.rows.map((row) => [row.approval_entry_id, row.enabled]),
        ),
        { [entry1]: false, [entry2]: true },
      )
      const grants = await sql<{
        path: string
      }>`SELECT path FROM app_permissions p JOIN app_role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=${roleId} ORDER BY path`.execute(
        tx,
      )
      assert.deepEqual(
        grants.rows.map((row) => row.path),
        [
          '/bob/supplier/submission-get',
          '/bob/supplier/submission-query',
          '/bob/supplier/submit-change',
        ],
      )
      throw rollback
    }),
    (error) => error === rollback,
  )
  assert.equal(
    (
      await sql<{
        name: string | null
      }>`SELECT to_regclass('bob_subjects')::text AS name`.execute(db)
    ).rows[0]?.name,
    null,
  )
  assert.equal(
    (
      await db
        .selectFrom('app_users')
        .select('id')
        .where('id', '=', actorId)
        .execute()
    ).length,
    0,
  )
  // A late authorization failure also restores every earlier DDL/data mutation.
  await assert.rejects(
    new BobArchiveMigrationService(db).migrate([]),
    /target is absent/,
  )
  assert.equal(
    (
      await sql<{
        name: string | null
      }>`SELECT to_regclass('bob_subjects')::text AS name`.execute(db)
    ).rows[0]?.name,
    null,
  )
})
