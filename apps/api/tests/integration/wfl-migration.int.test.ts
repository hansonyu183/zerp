import { restoreWflMigrationSource } from './wfl-fixture.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import { createDatabase } from '../../src/db/database.ts'
import { WflMigrationService } from '../../src/wfl/migration.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

test('WFL identity, immutable history and exact grants convert together and conversion failure rolls back', async () => {
  assert.ok(process.env.TARGET_TEST_DATABASE_URL)
  const db = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const rollback = new Error('rollback migration fixture')
  try {
    await assert.rejects(
      db.transaction().execute(async (tx) => {
        await restoreWflMigrationSource(tx)
        const actorId = ulid(),
          subjectId = ulid(),
          entryId = ulid(),
          roleId = ulid(),
          permissionId = ulid()
        await tx
          .insertInto('app_users')
          .values({
            id: actorId,
            username: `migration-${actorId}`,
            display_name: '迁移测试',
            py: 'qycs',
            password_hash: 'unused',
            status: 'ENABLED',
            password_changed_at: new Date(),
            password_change_required: false,
          })
          .execute()
        await sql`INSERT INTO dcl_subjects(id,entity,code,created_at,created_by) VALUES(${subjectId},'wfl-process-definition','wfl-999991',now(),${actorId})`.execute(
          tx,
        )
        await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,updated_by,updated_at)
        VALUES(${entryId},'dcl','wfl-process-definition',${subjectId},1,'PENDING',7,${actorId},now(),${actorId},now())`.execute(
          tx,
        )
        await tx
          .insertInto('wfl_definition_versions')
          .values({
            approval_entry_id: entryId,
            script: 'frozen legacy script',
            compiled_graph: JSON.stringify({
              code: 'legacy',
              name: '历史流程',
              nodes: [],
              edges: [],
              rootKey: 'root',
            }),
          })
          .execute()
        await tx
          .insertInto('app_roles')
          .values({
            id: roleId,
            code: `wfl-${roleId}`,
            name: '精确审批',
            status: 'ENABLED',
          })
          .execute()
        await tx
          .insertInto('app_permissions')
          .values({
            id: permissionId,
            domain: 'dcl',
            entity: 'wfl-process-definition',
            action: 'approve',
            path: '/dcl/wfl-process-definition/approve',
            status: 'ENABLED',
          })
          .execute()
        await tx
          .insertInto('app_role_permissions')
          .values({ role_id: roleId, permission_id: permissionId })
          .execute()
        const catalog = await readTargetPermissionCatalog()
        const service = new WflMigrationService(db)
        await sql`SAVEPOINT failed_conversion`.execute(tx)
        await assert.rejects(
          service.migrateInTransaction(
            tx,
            catalog.filter((p) => p.path !== '/wfl/process-definition/approve'),
          ),
        )
        await sql`ROLLBACK TO SAVEPOINT failed_conversion`.execute(tx)
        assert.equal(
          (
            await tx
              .selectFrom('approval_entries')
              .select('domain')
              .where('id', '=', entryId)
              .executeTakeFirstOrThrow()
          ).domain,
          'dcl',
        )
        assert.equal(
          (
            await sql<{
              target: string | null
            }>`SELECT to_regclass('wfl_definitions')::text target`.execute(tx)
          ).rows[0]!.target,
          null,
        )
        await service.migrateInTransaction(tx, catalog)
        const row = await tx
          .selectFrom('approval_entries')
          .selectAll()
          .where('id', '=', entryId)
          .executeTakeFirstOrThrow()
        assert.equal(row.domain, 'wfl')
        assert.equal(row.entity, 'process-definition')
        assert.equal(String(row.revision), '7')
        assert.equal(
          (
            await tx
              .selectFrom('wfl_definition_versions')
              .select('script')
              .where('approval_entry_id', '=', entryId)
              .executeTakeFirstOrThrow()
          ).script,
          'frozen legacy script',
        )
        assert.equal(
          (
            await tx
              .selectFrom('wfl_definitions')
              .select('code')
              .where('id', '=', subjectId)
              .executeTakeFirstOrThrow()
          ).code,
          'wfl-999991',
        )
        const grants = await tx
          .selectFrom('app_role_permissions as rp')
          .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
          .select('p.path')
          .where('rp.role_id', '=', roleId)
          .execute()
        assert.deepEqual(
          grants.map((p) => p.path),
          ['/wfl/process-definition/approve'],
        )
        assert.equal(
          (
            await tx
              .selectFrom('dcl_subjects')
              .select('id')
              .where('id', '=', subjectId)
              .execute()
          ).length,
          0,
        )
        throw rollback
      }),
      (e) => e === rollback,
    )
  } finally {
    await db.destroy()
  }
})
