import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql, type Transaction } from 'kysely'
import type { DB } from '../../src/db/generated.ts'
import { createDatabase } from '../../src/db/database.ts'
import {
  RptMigrationService,
  RptMigrationError,
} from '../../src/rpt/migration.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

async function previousSchema(tx: Transaction<DB>) {
  // Match the repository's rollback-only migration seam: retain all shared rows in
  // renamed tables; every DDL change and fixture below is undone by ROLLBACK.
  for (const table of [
    'rpt_definitions',
    'rpt_code_counter',
    'rpt_definition_audits',
    'rpt_definition_history',
    'rpt_definition_validity_history',
    'rpt_execution_audits',
  ])
    await sql`ALTER TABLE ${sql.table(table)} RENAME TO ${sql.id(`_400_saved_${table}`)}`.execute(
      tx,
    )
  await sql`CREATE TABLE dcl_rpt_definition_versions (LIKE _400_saved_rpt_definition_history INCLUDING ALL)`.execute(
    tx,
  )
  await sql`INSERT INTO dcl_rpt_definition_versions SELECT * FROM _400_saved_rpt_definition_history`.execute(
    tx,
  )
  await sql`CREATE TABLE rpt_definition_validities (LIKE _400_saved_rpt_definition_validity_history INCLUDING ALL)`.execute(
    tx,
  )
  await sql`INSERT INTO rpt_definition_validities SELECT * FROM _400_saved_rpt_definition_validity_history`.execute(
    tx,
  )
  await sql`CREATE TABLE rpt_execution_audits (LIKE _400_saved_rpt_execution_audits INCLUDING ALL)`.execute(
    tx,
  )
  await sql`ALTER TABLE rpt_execution_audits DROP COLUMN definition_revision,
    ADD CONSTRAINT rpt_execution_audits_definition_subject_id_fkey FOREIGN KEY(definition_subject_id) REFERENCES dcl_subjects(id)`.execute(
    tx,
  )
  await sql`INSERT INTO rpt_execution_audits SELECT id,definition_subject_id,approval_entry_id,actor_id,action,parameters,row_count,request_id,created_at
    FROM _400_saved_rpt_execution_audits WHERE approval_entry_id IS NOT NULL`.execute(
    tx,
  )
}

test('RPT migration preserves identities and historical audits in an atomic conversion', async () => {
  assert.ok(process.env.TARGET_TEST_DATABASE_URL)
  const db = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const rollback = new Error('rollback migration test')
  try {
    await assert.rejects(
      db.transaction().execute(async (tx) => {
        await previousSchema(tx)
        const actorId = ulid(),
          subjectId = ulid(),
          entryId = ulid(),
          pendingId = ulid(),
          pendingEntryId = ulid()
        await sql`INSERT INTO app_users(id,username,display_name,py,password_hash,status,password_changed_at,password_change_required)
        VALUES(${actorId},${`rpt-migration-${actorId}`},'转换测试','zhcs','unused','ENABLED',now(),false)`.execute(
          tx,
        )
        for (const [id, entry, code, status] of [
          [subjectId, entryId, 'rpt-999998', 'APPROVED'],
          [pendingId, pendingEntryId, 'rpt-999997', 'PENDING'],
        ] as const) {
          await sql`INSERT INTO dcl_subjects(id,entity,code,created_at,created_by) VALUES(${id},'rpt-definition',${code},now(),${actorId})`.execute(
            tx,
          )
          await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,updated_by,updated_at)
          VALUES(${entry},'dcl','rpt-definition',${id},1,${status},1,${actorId},now(),${actorId},now())`.execute(
            tx,
          )
          await sql`INSERT INTO dcl_rpt_definition_versions(approval_entry_id,name,description,enabled,sql_text,parameters,columns)
          VALUES(${entry},'历史客户名称','',true,'SELECT 1 AS total','[]','[{"alias":"total","name":"总数","order":1,"type":"INTEGER","width":120,"visible":true}]')`.execute(
            tx,
          )
        }
        await sql`INSERT INTO rpt_execution_audits(id,definition_subject_id,approval_entry_id,actor_id,action,parameters,row_count,request_id,created_at)
        VALUES(${ulid()},${subjectId},${entryId},${actorId},'QUERY','{}',1,'migration-history',now())`.execute(
          tx,
        )
        const enumSubject = ulid(),
          enumEntry = ulid(),
          roleId = ulid()
        await sql`INSERT INTO dcl_subjects(id,entity,code,created_at,created_by) VALUES(${enumSubject},'rpt-definition','rpt-999996',now(),${actorId})`.execute(
          tx,
        )
        await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,updated_by,updated_at)
        VALUES(${enumEntry},'dcl','rpt-definition',${enumSubject},1,'APPROVED',1,${actorId},now(),${actorId},now())`.execute(
          tx,
        )
        const enumParameters = JSON.stringify([
          {
            key: 'state',
            name: '状态',
            type: 'ENUM',
            required: true,
            enumValues: ['OPEN'],
          },
        ])
        await sql`INSERT INTO dcl_rpt_definition_versions(approval_entry_id,name,description,enabled,sql_text,parameters,columns)
        VALUES(${enumEntry},'旧枚举','',true,'SELECT :state AS total',${enumParameters}::jsonb,'[{"alias":"total","name":"状态","order":1,"type":"TEXT","width":120,"visible":true}]')`.execute(
          tx,
        )
        for (const entry of [entryId, enumEntry])
          await sql`INSERT INTO rpt_definition_validities(approval_entry_id,status,diagnostic,validated_at,validated_by) VALUES(${entry},'VALID',NULL,now(),${actorId})`.execute(
            tx,
          )
        await sql`INSERT INTO app_roles(id,code,name,status) VALUES(${roleId},${`rpt-migration-${roleId}`},'迁移权限','ENABLED')`.execute(
          tx,
        )
        for (const [domain, entity, action] of [
          ['dcl', 'rpt-definition', 'get'],
          ['dcl', 'rpt-definition', 'submit-new'],
          ['rpt', 'rpt-999996', 'query'],
        ] as const) {
          const path = `/${domain}/${entity}/${action}`
          const permission = await tx
            .insertInto('app_permissions')
            .values({
              id: ulid(),
              path,
              domain,
              entity,
              action,
              description: '迁移权限',
              status: 'ENABLED',
            })
            .onConflict((conflict) =>
              conflict.column('path').doUpdateSet({ status: 'ENABLED' }),
            )
            .returning('id')
            .executeTakeFirstOrThrow()
          await tx
            .insertInto('app_role_permissions')
            .values({ role_id: roleId, permission_id: permission.id })
            .execute()
        }
        const conflictId = ulid()
        await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,updated_by,updated_at)
        VALUES(${conflictId},'dcl','rpt-definition',${subjectId},2,'PENDING',1,${actorId},now(),${actorId},now())`.execute(
          tx,
        )
        await assert.rejects(
          new RptMigrationService(db).migrateInTransaction(
            tx,
            await readTargetPermissionCatalog(),
          ),
          (error) =>
            error instanceof RptMigrationError &&
            error.blockers.some((b) => b.subjectId === subjectId),
        )
        await sql`DELETE FROM approval_entries WHERE id=${conflictId}`.execute(
          tx,
        )
        const before = await sql<{
          id: string
          code: string
        }>`SELECT id,code FROM dcl_subjects WHERE entity='rpt-definition' ORDER BY id`.execute(
          tx,
        )
        const audits = await tx
          .selectFrom('rpt_execution_audits')
          .selectAll()
          .orderBy('id')
          .execute()
        const result = await new RptMigrationService(db).migrateInTransaction(
          tx,
          await readTargetPermissionCatalog(),
        )
        assert.equal(result.migrated, before.rows.length)
        const after = await sql<{
          id: string
          code: string
        }>`SELECT id,code FROM rpt_definitions ORDER BY id`.execute(tx)
        assert.deepEqual(after.rows, before.rows)
        const enumCurrent = await sql<{
          parameters: unknown
          validity: string
        }>`SELECT parameters,validity FROM rpt_definitions WHERE id=${enumSubject}`.execute(
          tx,
        )
        assert.equal(enumCurrent.rows[0]?.validity, 'INVALID')
        assert.deepEqual(
          enumCurrent.rows[0]?.parameters,
          JSON.parse(enumParameters),
        )
        const grants = await tx
          .selectFrom('app_role_permissions as grant')
          .innerJoin(
            'app_permissions as permission',
            'permission.id',
            'grant.permission_id',
          )
          .select(['permission.path', 'permission.status'])
          .where('grant.role_id', '=', roleId)
          .orderBy('permission.path')
          .execute()
        assert.deepEqual(grants, [
          { path: '/rpt/definition/get', status: 'ENABLED' },
          { path: '/rpt/rpt-999996/query', status: 'DISABLED' },
        ])
        const approved = await sql<{
          validity: string
        }>`SELECT validity FROM rpt_definitions WHERE id=${subjectId}`.execute(
          tx,
        )
        assert.equal(approved.rows[0]?.validity, 'VALID')
        const pending = await sql<{
          validity: string
        }>`SELECT validity FROM rpt_definitions WHERE id=${pendingId}`.execute(
          tx,
        )
        assert.equal(pending.rows[0]?.validity, 'INVALID')
        const historical = await tx
          .selectFrom('rpt_execution_audits')
          .selectAll()
          .orderBy('id')
          .execute()
        assert.deepEqual(
          historical.map(({ definition_revision, ...row }) => row),
          audits,
        )
        throw rollback
      }),
      (error) => error === rollback,
    )
  } finally {
    await db.destroy()
  }
})
