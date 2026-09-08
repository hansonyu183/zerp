import assert from 'node:assert/strict'
import test from 'node:test'
import { sql, type Transaction } from 'kysely'
import { ulid } from 'ulid'
import { createDatabase } from '../../src/db/database.ts'
import type { DB } from '../../src/db/generated.ts'
import { CustomerMigrationService } from '../../src/bob/customer-migration.ts'
import { customerPermissionMappings } from '../../src/bob/customer-permissions.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'

const customerTables = [
  'versions',
  'subunit_roots',
  'version_subunits',
  'attachments',
  'attachment_staging',
] as const

// Build the immediately preceding schema inside the rollback-only transaction.
// Existing target rows stay in renamed tables and are restored by ROLLBACK;
// no database is cleared, rebuilt or committed by this regression.
async function sourceFixture(tx: Transaction<DB>) {
  for (const suffix of customerTables) {
    const target = `bob_customer_${suffix}`,
      saved = `_398_saved_${suffix}`
    await sql`ALTER TABLE ${sql.table(target)} RENAME TO ${sql.id(saved)}`.execute(
      tx,
    )
    await sql`CREATE TABLE ${sql.table(`dcl_customer_${suffix}`)} (LIKE ${sql.table(saved)} INCLUDING ALL)`.execute(
      tx,
    )
  }
  await sql`ALTER TABLE dcl_customer_versions ADD COLUMN enabled boolean NOT NULL DEFAULT true`.execute(
    tx,
  )
  await sql`ALTER TABLE bob_subjects DROP CONSTRAINT bob_subjects_customer_code_ck`.execute(
    tx,
  )
  await sql`ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check, DROP CONSTRAINT dcl_subjects_entity_code_ck`.execute(
    tx,
  )
  await sql`ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check CHECK(entity IN ('customer','acc-mapping','rpt-definition','wfl-process-definition')), ADD CONSTRAINT dcl_subjects_entity_code_ck CHECK(entity='acc-mapping' OR code IS NOT NULL)`.execute(
    tx,
  )
  await sql`ALTER TABLE dcl_customer_subunit_roots ADD CONSTRAINT dcl_customer_subunit_roots_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES dcl_subjects(id) ON DELETE CASCADE`.execute(
    tx,
  )
  for (const table of [
    'acc_opening_container_balances',
    'acc_container_entries',
  ]) {
    await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT ${sql.id(`${table}_customer_id_fkey`)}, DROP CONSTRAINT ${sql.id(`${table}_customer_subunit_id_fkey`)}`.execute(
      tx,
    )
    // Existing rows are outside the fixture; new source rows must satisfy both FKs.
    await sql`ALTER TABLE ${sql.table(table)} ADD CONSTRAINT ${sql.id(`${table}_customer_id_fkey`)} FOREIGN KEY(customer_id) REFERENCES dcl_subjects(id) ON DELETE RESTRICT NOT VALID, ADD CONSTRAINT ${sql.id(`${table}_customer_subunit_id_fkey`)} FOREIGN KEY(customer_subunit_id) REFERENCES dcl_customer_subunit_roots(subunit_id) ON DELETE RESTRICT NOT VALID`.execute(
      tx,
    )
  }
  const actorId = ulid(),
    subjectId = ulid(),
    approvedId = ulid(),
    pendingId = ulid(),
    subunitId = ulid(),
    openingId = ulid(),
    saleId = ulid(),
    roleId = ulid()
  const now = new Date()
  await tx
    .insertInto('app_users')
    .values({
      id: actorId,
      username: `migration-${actorId}`,
      display_name: '客户迁移回归',
      py: 'keh u',
      password_hash: 'unused',
      status: 'ENABLED',
      password_changed_at: now,
      password_change_required: false,
    })
    .execute()
  const counter = await tx
    .updateTable('archive_code_counters')
    .set((eb) => ({ next_value: eb('next_value', '+', 1) }))
    .where('entity', '=', 'customer')
    .returning('next_value')
    .executeTakeFirstOrThrow()
  const code = `CUS-${String(counter.next_value - 1).padStart(4, '0')}`
  await sql`INSERT INTO dcl_subjects(id,entity,code,created_at,created_by) VALUES(${subjectId},'customer',${code},${now},${actorId})`.execute(
    tx,
  )
  for (const [id, domain, entity, status, version] of [
    [approvedId, 'dcl', 'customer', 'APPROVED', 1],
    [pendingId, 'dcl', 'customer', 'PENDING', 2],
    [openingId, 'acc', 'opening', 'APPROVED', null],
    [saleId, 'vou', 'sale-receipt', 'APPROVED', null],
  ] as const) {
    await tx
      .insertInto('approval_entries')
      .values({
        id,
        domain,
        entity,
        subject_id: domain === 'dcl' ? subjectId : ulid(),
        version_no: version,
        status,
        revision: 1,
        submitted_by: actorId,
        submitted_at: now,
        approved_by: status === 'APPROVED' ? actorId : null,
        approved_at: status === 'APPROVED' ? now : null,
        updated_by: actorId,
        updated_at: now,
      })
      .execute()
  }
  await sql`INSERT INTO dcl_customer_subunit_roots(subunit_id,customer_id,code) VALUES(${subunitId},${subjectId},'SUB-0001')`.execute(
    tx,
  )
  for (const [id, enabled] of [
    [approvedId, true],
    [pendingId, false],
  ] as const) {
    await sql`INSERT INTO dcl_customer_versions(approval_entry_id,kind,legal_identifier,display_name,legal_name,phone,email,address,invoice_title,invoice_address,invoice_phone,invoice_bank,invoice_account,remittance_profiles,tax_attachments,enabled) VALUES(${id},'OTHER',${`IDENTITY-${subjectId}`},'迁移客户','客户法定名称','123','migration@example.test','地址','抬头','开票地址','456','银行','12345678','[{"payerName":"付款单位","bank":"来款银行","accountNumber":"87654321"}]'::jsonb,'[]'::jsonb,${enabled})`.execute(
      tx,
    )
    await sql`INSERT INTO dcl_customer_version_subunits(customer_approval_entry_id,subunit_id,name,customer_type_id,customer_type_snapshot,pricing_snapshot,credit_limits,business_attachments,enabled) VALUES(${id},${subunitId},'总部',${ulid()},'{"id":"type","code":"DIRECT","name":"直销"}'::jsonb,'{"defaultPremiumUnitPrice":"0.10","defaultDiscountUnitPrice":"0.00","costItems":[],"thirdPartyIntermediaryFixedUnitCost":"0.01","thirdPartyIntermediaryVariableUnitCost":"0.02"}'::jsonb,'[{"currency":"CNY","amount":"10000.00"}]'::jsonb,'[]'::jsonb,true)`.execute(
      tx,
    )
  }
  await sql`INSERT INTO dcl_customer_attachments(approval_entry_id,file_id,file_name,mime_type,size_bytes,digest,storage_key,created_at) VALUES(${approvedId},${ulid()},'税务.pdf','application/pdf',10,${'a'.repeat(64)},${`legacy/${subjectId}/tax.pdf`},${now})`.execute(
    tx,
  )
  await sql`INSERT INTO dcl_customer_attachment_staging(id,file_id,owner_user_id,file_name,mime_type,size_bytes,digest,storage_key,created_at,expires_at) VALUES(${ulid()},${ulid()},${actorId},'合同.pdf','application/pdf',10,${'b'.repeat(64)},${`legacy/${subjectId}/stage.pdf`},${now},${new Date(now.getTime() + 60000)})`.execute(
    tx,
  )
  await tx
    .insertInto('approval_events')
    .values({
      id: ulid(),
      entry_id: approvedId,
      domain: 'dcl',
      entity: 'customer',
      subject_id: subjectId,
      version_no: 1,
      action: 'APPROVED',
      actor_id: actorId,
      request_id: ulid(),
      created_at: now,
    })
    .execute()
  await tx
    .insertInto('acc_opening_container_balances')
    .values({
      opening_approval_entry_id: openingId,
      customer_subunit_id: subunitId,
      customer_id: subjectId,
      customer_approval_entry_id: approvedId,
      customer_subunit_code: 'SUB-0001',
      customer_subunit_name: '总部',
      container_type: 'SOLVENT',
      quantity: '3',
      created_at: now,
    })
    .execute()
  await tx
    .insertInto('vou_reference_snapshots')
    .values({
      approval_entry_id: saleId,
      field: 'allocations.counterparty',
      line_no: 1,
      object_id: subunitId,
      approval_reference_id: approvedId,
      selection_origin: 'HISTORICAL',
      reference_entity: 'customer-subunit',
      reference_code: 'SUB-0001',
      reference_name: '总部',
    })
    .execute()
  await tx
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `migration-${roleId}`,
      name: '精确客户权限',
      status: 'ENABLED',
    })
    .execute()
  for (const mapping of customerPermissionMappings) {
    const existing = await tx
      .selectFrom('app_permissions')
      .select('id')
      .where('path', '=', mapping.from)
      .executeTakeFirst()
    const permissionId = existing?.id ?? ulid()
    if (!existing)
      await tx
        .insertInto('app_permissions')
        .values({
          id: permissionId,
          path: mapping.from,
          domain: 'dcl',
          entity: 'customer',
          action: mapping.from.split('/')[3]!,
          description: '客户迁移权限',
          status: 'ENABLED',
        })
        .execute()
    await tx
      .insertInto('app_role_permissions')
      .values({ role_id: roleId, permission_id: permissionId })
      .execute()
  }
  const reportPath = `/rpt/rpt-999998/query`
  const reportPermissionId = ulid()
  await tx
    .insertInto('app_permissions')
    .values({
      id: reportPermissionId,
      path: reportPath,
      domain: 'rpt',
      entity: 'rpt-999998',
      action: 'query',
      description: '独立报表权限',
      status: 'DISABLED',
    })
    .execute()
  await tx
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: reportPermissionId })
    .execute()
  return {
    subjectId,
    approvedId,
    pendingId,
    roleId,
    reportPath,
    reportPermissionId,
  }
}

test('Customer migration preserves historical content, attachments, exact grants and ACC/VOU references atomically', async (context) => {
  assert.ok(process.env.TARGET_TEST_DATABASE_URL)
  const db = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  context.after(() => db.destroy())
  const catalog = await readTargetPermissionCatalog()
  const initial = (
    await sql<{
      source: string | null
    }>`SELECT to_regclass('dcl_customer_versions')::text AS source`.execute(db)
  ).rows[0]!
  const rollback = new Error('rollback complete migration regression')
  await assert.rejects(
    db.transaction().execute(async (tx) => {
      const fixture = initial.source ? null : await sourceFixture(tx)
      const rows = async (table: string) =>
        (
          await sql<{
            data: unknown
          }>`SELECT to_jsonb(row) AS data FROM ${sql.table(table)} row ORDER BY to_jsonb(row)::text`.execute(
            tx,
          )
        ).rows
      const before = await Promise.all(
        customerTables.map((suffix) => rows(`dcl_customer_${suffix}`)),
      )
      const acc = await rows('acc_opening_container_balances'),
        vou = await rows('vou_reference_snapshots')
      const evidence = (
        await sql<{
          approval_entry_id: string
          enabled: boolean
        }>`SELECT approval_entry_id,enabled FROM dcl_customer_versions ORDER BY approval_entry_id`.execute(
          tx,
        )
      ).rows
      await new CustomerMigrationService(db).migrateInTransaction(tx, catalog)
      for (let i = 0; i < customerTables.length; i++) {
        const expected =
          customerTables[i] === 'versions'
            ? before[i]!.map((row) => {
                const { enabled: _enabled, ...data } = row.data as Record<
                  string,
                  unknown
                >
                return { data }
              })
            : before[i]
        assert.deepEqual(
          new Set(
            (await rows(`bob_customer_${customerTables[i]}`)).map((row) =>
              JSON.stringify(row),
            ),
          ),
          new Set(expected!.map((row) => JSON.stringify(row))),
        )
      }
      assert.deepEqual(await rows('acc_opening_container_balances'), acc)
      assert.deepEqual(await rows('vou_reference_snapshots'), vou)
      for (const row of evidence)
        assert.deepEqual(
          await tx
            .selectFrom('bob_legacy_enablement_evidence')
            .selectAll()
            .where('approval_entry_id', '=', String(row.approval_entry_id))
            .executeTakeFirst(),
          row,
        )
      assert.equal(
        (
          await sql`SELECT id FROM approval_entries WHERE domain='dcl' AND entity='customer'`.execute(
            tx,
          )
        ).rows.length,
        0,
      )
      const constraints = (
        await sql<{
          target: string
        }>`SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE conname IN ('acc_opening_container_balances_customer_id_fkey','acc_container_entries_customer_id_fkey')`.execute(
          tx,
        )
      ).rows
      assert.deepEqual(constraints, [
        { target: 'bob_subjects' },
        { target: 'bob_subjects' },
      ])
      if (fixture) {
        assert.equal(
          (
            await tx
              .selectFrom('bob_subjects')
              .select('enabled')
              .where('id', '=', fixture.subjectId)
              .executeTakeFirstOrThrow()
          ).enabled,
          true,
        )
        const grants = (
          await tx
            .selectFrom('app_role_permissions as rp')
            .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
            .select('p.path')
            .where('rp.role_id', '=', fixture.roleId)
            .execute()
        )
          .map((row) => row.path)
          .sort()
        assert.deepEqual(
          grants,
          [
            ...customerPermissionMappings.flatMap((mapping) => mapping.to),
            fixture.reportPath,
          ].sort(),
        )
        assert.deepEqual(
          await tx
            .selectFrom('app_permissions')
            .select(['id', 'status'])
            .where('path', '=', fixture.reportPath)
            .executeTakeFirstOrThrow(),
          { id: fixture.reportPermissionId, status: 'DISABLED' },
        )
        assert.equal(
          grants.some(
            (path) => path.endsWith('/enable') || path.endsWith('/disable'),
          ),
          false,
        )
      }
      throw rollback
    }),
    (error) => error === rollback,
  )
  assert.deepEqual(
    (
      await sql`SELECT to_regclass('dcl_customer_versions')::text AS source`.execute(
        db,
      )
    ).rows,
    [initial],
  )
  assert.equal(
    (
      await sql<{
        source: string | null
      }>`SELECT to_regclass('_398_saved_versions') AS source`.execute(db)
    ).rows[0]?.source,
    null,
  )
})
