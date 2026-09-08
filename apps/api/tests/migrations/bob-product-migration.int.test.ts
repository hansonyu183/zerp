import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import { createDatabase } from '../../src/db/database.ts'
import { ProductMigrationService } from '../../src/bob/product-migration.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'

// Run against the existing source before the one-time conversion. All fixture
// and DDL changes roll back, including the successful conversion inspection.
test('product migration preserves identities, exact stored quantities, history and grants atomically', async (context) => {
  const url = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(url)
  const db = createDatabase(url)
  context.after(() => db.destroy())
  const source = await sql<{
    name: string | null
    target: string | null
  }>`SELECT to_regclass('dcl_product_versions')::text AS name,to_regclass('bob_product_versions')::text AS target`.execute(
    db,
  )
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
      const availableCode = await sql<{
        code: string
      }>`SELECT 'PRD-' || lpad(n::text,4,'0') AS code FROM generate_series(1,9999) n WHERE NOT EXISTS(SELECT 1 FROM dcl_subjects WHERE entity='product' AND code='PRD-' || lpad(n::text,4,'0')) ORDER BY n DESC LIMIT 1`.execute(
        tx,
      )
      const code = availableCode.rows[0]?.code
      assert.ok(code, 'no product fixture code available')
      await sql`INSERT INTO dcl_subjects(id,entity,code,created_at,created_by) VALUES (${subjectId},'product',${code},now(),${actorId})`.execute(
        tx,
      )
      for (const [entryId, version, status, enabled] of [
        [entry1, 1, 'APPROVED', false],
        [entry2, 2, 'PENDING', true],
      ] as const) {
        await sql`INSERT INTO approval_entries(id,domain,entity,subject_id,version_no,status,revision,submitted_by,submitted_at,updated_by,updated_at)
        VALUES (${entryId},'dcl','product',${subjectId},${version},${status},1,${actorId},now(),${actorId},now())`.execute(
          tx,
        )
        await sql`INSERT INTO dcl_product_versions(approval_entry_id,name,enabled,source_snapshots,unit_conversions,fixed_formula)
        VALUES (${entryId},'历史产品',${enabled},${JSON.stringify({ pricingUnit: { id: ulid(), name: '已停用单位', quantityScale: 6, symbol: 'kg' }, productType: { id: ulid(), name: '旧成品', behaviorProfile: 'STANDARD_FINISHED' } })}::jsonb,
        ${JSON.stringify([{ unit: { id: ulid(), name: '旧录入单位', quantityScale: 6, symbol: 'kg' }, factor: '0.000001' }])}::jsonb,
        ${JSON.stringify({ output: { enteredQuantity: '9007199254740993.000001', baseQuantity: '0.000001', enteredUnit: { id: ulid(), name: '旧单位', quantityScale: 6, symbol: 'kg' } }, components: [{ material: { objectId: ulid(), approvalEntryId: ulid(), name: '旧原料', code: 'PRD-0001' }, quantity: { enteredQuantity: '1.000001', baseQuantity: '999999999999999999.000001' } }] })}::jsonb)`.execute(
          tx,
        )
      }
      await sql`INSERT INTO app_roles(id,code,name,status) VALUES (${roleId},${roleId},'迁移有限权限','ENABLED')`.execute(
        tx,
      )
      await sql`INSERT INTO app_role_permissions(role_id,permission_id) SELECT ${roleId},id FROM app_permissions WHERE path IN ('/dcl/product/query','/dcl/product/get','/dcl/product/submit-change')`.execute(
        tx,
      )
      const grantsBefore = await sql<{
        n: string
      }>`SELECT count(*)::text AS n FROM app_role_permissions WHERE role_id=${roleId}`.execute(
        tx,
      )
      assert.equal(grantsBefore.rows[0]?.n, '3')
      const before = await sql<{
        snapshot: unknown
      }>`SELECT to_jsonb(v)-'enabled' AS snapshot FROM dcl_product_versions v WHERE approval_entry_id IN (${entry1},${entry2}) ORDER BY approval_entry_id`.execute(
        tx,
      )
      await new ProductMigrationService(db).migrateInTransaction(tx, catalog)
      const after = await sql<{
        snapshot: unknown
      }>`SELECT to_jsonb(v) AS snapshot FROM bob_product_versions v WHERE approval_entry_id IN (${entry1},${entry2}) ORDER BY approval_entry_id`.execute(
        tx,
      )
      assert.deepEqual(
        after.rows,
        before.rows,
        'every adopted name, exact reference, decimal string and unit precision stays byte-equivalent in JSON',
      )
      const current = await sql<{
        id: string
        code: string
        enabled: boolean
        revision: string
      }>`SELECT id,code,enabled,revision::text AS revision FROM bob_subjects WHERE id=${subjectId}`.execute(
        tx,
      )
      assert.deepEqual(current.rows, [
        { id: subjectId, code, enabled: false, revision: '1' },
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
          '/bob/product/submission-get',
          '/bob/product/submission-query',
          '/bob/product/submit-change',
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
      }>`SELECT to_regclass('bob_product_versions')::text AS name`.execute(db)
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
    new ProductMigrationService(db).migrate([]),
    /target is absent/,
  )
  assert.equal(
    (
      await sql<{
        name: string | null
      }>`SELECT to_regclass('bob_product_versions')::text AS name`.execute(db)
    ).rows[0]?.name,
    null,
  )
})
