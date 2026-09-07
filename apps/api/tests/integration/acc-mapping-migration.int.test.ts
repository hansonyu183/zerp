import assert from 'node:assert/strict'
import test from 'node:test'
import { sql, type Transaction } from 'kysely'
import { ulid } from 'ulid'
import { createDatabase } from '../../src/db/database.ts'
import type { DB } from '../../src/db/generated.ts'
import {
  AccMappingMigrationService,
  AccMappingMigrationError,
} from '../../src/acc/mapping-migration.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

async function previousSchema(tx: Transaction<DB>) {
  // All DDL and fixtures are rolled back; shared rows stay in renamed tables.
  await sql`ALTER TABLE acc_mapping_vou_entities RENAME TO dcl_acc_vou_entity_facts`.execute(
    tx,
  )
  await sql`CREATE TABLE dcl_acc_book_facts(id varchar(26) PRIMARY KEY)`.execute(
    tx,
  )
  await sql`CREATE TABLE dcl_acc_subject_facts(id varchar(26) PRIMARY KEY)`.execute(
    tx,
  )
  await sql`ALTER TABLE acc_mappings RENAME TO _399_saved_mappings`.execute(tx)
  await sql`ALTER TABLE acc_mapping_subject_usages RENAME TO _399_saved_usages`.execute(
    tx,
  )
  await sql`ALTER TABLE acc_mapping_history RENAME TO _399_saved_history`.execute(
    tx,
  )
  await sql`ALTER TABLE acc_mapping_legacy_reference_facts RENAME TO _399_saved_references`.execute(
    tx,
  )
  await sql`CREATE TABLE dcl_acc_mapping_versions (LIKE _399_saved_history INCLUDING ALL)`.execute(
    tx,
  )
  await sql`INSERT INTO dcl_acc_mapping_versions SELECT * FROM _399_saved_history`.execute(
    tx,
  )
  await sql`CREATE TABLE dcl_acc_mapping_reference_facts (LIKE _399_saved_references INCLUDING ALL)`.execute(
    tx,
  )
  await sql`INSERT INTO dcl_acc_mapping_reference_facts SELECT * FROM _399_saved_references`.execute(
    tx,
  )
  await sql`CREATE TABLE dcl_acc_mapping_subject_usages(approval_entry_id varchar(26),subject_id varchar(26),PRIMARY KEY(approval_entry_id,subject_id))`.execute(
    tx,
  )
  await sql`ALTER TABLE acc_journal_entries DROP COLUMN mapping_id,DROP COLUMN mapping_revision`.execute(
    tx,
  )
}

test('mapping conversion preserves identity, historical approvals and exact reads without granting save; conflicting candidate aborts atomically', async () => {
  const url = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(url)
  const db = createDatabase(url)
  const catalog = await readTargetPermissionCatalog()
  const rollback = new Error('rollback migration fixture')
  try {
    await assert.rejects(
      db.transaction().execute(async (tx) => {
        await previousSchema(tx)
        const user = ulid(),
          book = ulid(),
          subject = ulid(),
          entry = ulid(),
          candidate = ulid(),
          role = ulid(),
          permission = ulid()
        await tx
          .insertInto('app_users')
          .values({
            id: user,
            username: `migration-${user}`,
            display_name: '迁移测试',
            py: 'qianyiceshi',
            password_hash: 'unused',
            status: 'ENABLED',
            password_changed_at: new Date(),
            password_change_required: false,
          })
          .execute()
        await sql`INSERT INTO acc_books(id,code,name,start_month,base_currency,control_book,created_at,created_by,updated_at,updated_by) VALUES(${book},'ACC-9999','迁移账簿','2098-01','CNY',false,now(),${user},now(),${user})`.execute(
          tx,
        )
        await tx
          .insertInto('dcl_subjects')
          .values({
            id: subject,
            entity: 'acc-mapping',
            code: null,
            created_at: new Date(),
            created_by: user,
          })
          .execute()
        for (const [id, version, status] of [
          [entry, 1, 'APPROVED'],
          [candidate, 2, 'PENDING'],
        ] as const) {
          await tx
            .insertInto('approval_entries')
            .values({
              id,
              domain: 'dcl',
              entity: 'acc-mapping',
              subject_id: subject,
              version_no: version,
              status,
              revision: 1,
              submitted_by: user,
              submitted_at: new Date(),
              updated_by: user,
              updated_at: new Date(),
            })
            .execute()
          await sql`INSERT INTO dcl_acc_mapping_versions(approval_entry_id,book_id,vou_entity_id,book_snapshot,vou_entity_snapshot,default_result,mapping_definition) VALUES(${id},${book},'sale-order',${JSON.stringify({ id: book, code: 'ACC-9999', name: '迁移账簿' })}::jsonb,'{"id":"sale-order","code":"sale-order","name":"销售订单"}'::jsonb,'UN_POST','{"defaultTemplateId":null,"rules":[],"templates":[],"assetConfiguration":null}'::jsonb)`.execute(
            tx,
          )
        }
        const migration = new AccMappingMigrationService(db)
        await assert.rejects(
          migration.migrateInTransaction(tx, catalog),
          (error: unknown) =>
            error instanceof AccMappingMigrationError &&
            error.blockers.some((blocker) => blocker.subjectId === subject),
        )
        assert.equal(
          (
            await sql<{
              name: string | null
            }>`SELECT to_regclass('acc_mappings')::text name`.execute(tx)
          ).rows[0]!.name,
          null,
        )
        assert.equal(
          (
            await tx
              .selectFrom('approval_entries')
              .select('status')
              .where('id', '=', candidate)
              .executeTakeFirstOrThrow()
          ).status,
          'PENDING',
        )
        // Fixture simulates the owner explicitly resolving the open candidate before conversion.
        await sql`DELETE FROM dcl_acc_mapping_versions WHERE approval_entry_id=${candidate}`.execute(
          tx,
        )
        await tx
          .deleteFrom('approval_entries')
          .where('id', '=', candidate)
          .execute()
        await tx
          .insertInto('app_roles')
          .values({
            id: role,
            code: `m399-${role}`,
            name: '迁移只读',
            status: 'ENABLED',
          })
          .execute()
        await tx
          .insertInto('app_permissions')
          .values({
            id: permission,
            path: '/dcl/acc-mapping/query',
            domain: 'dcl',
            entity: 'acc-mapping',
            action: 'query',
            status: 'ENABLED',
          })
          .execute()
        await tx
          .insertInto('app_role_permissions')
          .values({ role_id: role, permission_id: permission })
          .execute()
        const report = await migration.migrateInTransaction(tx, catalog)
        assert.ok(report.migrated >= 1)
        const current = await sql<{
          id: string
          revision: string
          default_result: string
        }>`SELECT id,revision::text,default_result FROM acc_mappings WHERE id=${subject}`.execute(
          tx,
        )
        assert.deepEqual(current.rows, [
          { id: subject, revision: '1', default_result: 'UN_POST' },
        ])
        assert.equal(
          (
            await tx
              .selectFrom('approval_entries')
              .select('status')
              .where('id', '=', entry)
              .executeTakeFirstOrThrow()
          ).status,
          'APPROVED',
        )
        assert.equal(
          (
            await sql`SELECT * FROM acc_mapping_history WHERE approval_entry_id=${entry}`.execute(
              tx,
            )
          ).rows.length,
          1,
        )
        const permissions = await tx
          .selectFrom('app_role_permissions as r')
          .innerJoin('app_permissions as p', 'p.id', 'r.permission_id')
          .select('p.path')
          .where('r.role_id', '=', role)
          .execute()
        assert.deepEqual(
          permissions.map((row) => row.path),
          ['/acc/mapping/query'],
        )
        throw rollback
      }),
      (error) => error === rollback,
    )
  } finally {
    await db.destroy()
  }
})
