import { customerPermissionMappings } from './customer-permissions.ts'
import { preserveLegacyMappedPermissions } from './product-permissions.ts'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { TargetBootstrapService } from '../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import { productPermissionMappings } from './product-permissions.ts'

export class ProductMigrationError extends Error {
  readonly blockers: Array<{ subjectId: string; reason: string }>
  constructor(blockers: Array<{ subjectId: string; reason: string }>) {
    super('Product migration blocked')
    this.blockers = blockers
  }
}

/** One-time conversion after #396. No transaction, quantity or reference is rebuilt. */
export class ProductMigrationService {
  private readonly db: Kysely<DB>
  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async migrate(catalog: readonly TargetPermissionCatalogEntry[]) {
    return this.db
      .transaction()
      .execute((tx) => this.migrateInTransaction(tx, catalog))
  }

  async migrateInTransaction(
    tx: Transaction<DB>,
    catalog: readonly TargetPermissionCatalogEntry[],
  ) {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('bob:product:migration',0))`.execute(
      tx,
    )
    const state = await sql<{
      source: string | null
      target: string | null
      subjects: string | null
    }>`SELECT to_regclass('dcl_product_versions')::text AS source,to_regclass('bob_product_versions')::text AS target,to_regclass('bob_subjects')::text AS subjects`.execute(
      tx,
    )
    if (
      !state.rows[0]?.source ||
      state.rows[0].target ||
      !state.rows[0].subjects
    )
      throw new ProductMigrationError([
        { subjectId: '', reason: 'SOURCE_MISSING_OR_TARGET_ALREADY_EXISTS' },
      ])
    await sql`LOCK TABLE dcl_subjects,bob_subjects,dcl_product_versions,approval_entries,approval_events,archive_idempotency,archive_code_counters,app_permissions,app_role_permissions,aux_reference_facts IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const invalid = await sql<{ subject_id: string }>`
      SELECT s.id AS subject_id FROM dcl_subjects s WHERE s.entity='product' AND (
        s.code IS NULL OR EXISTS(SELECT 1 FROM bob_subjects target WHERE target.id=s.id OR (target.entity='product' AND target.code=s.code))
        OR NOT EXISTS(SELECT 1 FROM approval_entries e WHERE e.domain='dcl' AND e.entity='product' AND e.subject_id=s.id)
        OR EXISTS(SELECT 1 FROM approval_entries e WHERE e.domain='dcl' AND e.entity='product' AND e.subject_id=s.id AND (e.version_no IS NULL OR NOT EXISTS(SELECT 1 FROM dcl_product_versions v WHERE v.approval_entry_id=e.id)))
      )
      UNION SELECT e.subject_id FROM approval_entries e WHERE e.domain='dcl' AND e.entity='product' AND NOT EXISTS(SELECT 1 FROM dcl_subjects s WHERE s.id=e.subject_id AND s.entity='product')
      UNION SELECT subject_id FROM approval_entries WHERE domain='dcl' AND entity='product' GROUP BY subject_id HAVING count(*) FILTER (WHERE status='APPROVED')=0 AND NOT(count(*)=1 AND max(version_no)=1 AND max(status) IN ('PENDING','REJECTED'))
      UNION SELECT e.subject_id FROM dcl_product_versions v JOIN approval_entries e ON e.id=v.approval_entry_id WHERE e.domain<>'dcl' OR e.entity<>'product'
    `.execute(tx)
    if (invalid.rows.length)
      throw new ProductMigrationError(
        invalid.rows.map((row) => ({
          subjectId: row.subject_id,
          reason: 'INVALID_HISTORY',
        })),
      )
    const duplicate = await sql<{ subject_id: string }>`
      WITH active AS (
        SELECT e.subject_id,upper(trim(v.barcode)) AS barcode FROM dcl_product_versions v JOIN approval_entries e ON e.id=v.approval_entry_id
        WHERE e.domain='dcl' AND e.entity='product' AND NULLIF(trim(v.barcode),'') IS NOT NULL
          AND (e.status IN ('PENDING','REJECTED') OR (e.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM approval_entries n WHERE n.domain=e.domain AND n.entity=e.entity AND n.subject_id=e.subject_id AND n.status='APPROVED' AND n.version_no>e.version_no)))
      ) SELECT DISTINCT subject_id FROM active WHERE barcode IN (SELECT barcode FROM active GROUP BY barcode HAVING count(DISTINCT subject_id)>1)
    `.execute(tx)
    if (duplicate.rows.length)
      throw new ProductMigrationError(
        duplicate.rows.map((row) => ({
          subjectId: row.subject_id,
          reason: 'DUPLICATE_BARCODE',
        })),
      )
    // Keep historical enabled values as audit evidence; only the chosen current value becomes object state.
    await sql`INSERT INTO bob_legacy_enablement_evidence(approval_entry_id,enabled) SELECT approval_entry_id,enabled FROM dcl_product_versions`.execute(
      tx,
    )
    await sql`ALTER TABLE bob_subjects DROP CONSTRAINT bob_subjects_entity_check`.execute(
      tx,
    )
    await sql`ALTER TABLE bob_subjects ADD CONSTRAINT bob_subjects_entity_check CHECK(entity IN ('supplier','other-unit','sales-partner','product'))`.execute(
      tx,
    )
    await sql`INSERT INTO bob_subjects(id,entity,code,enabled,revision,created_at,created_by)
      SELECT s.id,s.entity,s.code,v.enabled,1,s.created_at,s.created_by FROM dcl_subjects s
      JOIN LATERAL(SELECT id FROM approval_entries e WHERE e.domain='dcl' AND e.entity='product' AND e.subject_id=s.id ORDER BY (status='APPROVED') DESC,version_no DESC LIMIT 1) chosen ON true
      JOIN dcl_product_versions v ON v.approval_entry_id=chosen.id WHERE s.entity='product'`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_product_versions RENAME TO bob_product_versions`.execute(
      tx,
    )
    await sql`ALTER TABLE bob_product_versions DROP COLUMN enabled`.execute(tx)
    await sql`UPDATE approval_entries SET domain='bob' WHERE domain='dcl' AND entity='product'`.execute(
      tx,
    )
    await sql`UPDATE approval_events SET domain='bob' WHERE domain='dcl' AND entity='product'`.execute(
      tx,
    )
    await sql`UPDATE archive_idempotency SET response=jsonb_set(response,'{snapshot}',(response->'snapshot')-'enabled') WHERE entity='product'`.execute(
      tx,
    )
    await sql`UPDATE aux_reference_facts SET source=CASE WHEN source='dcl_product_versions' THEN 'bob_product_versions' ELSE regexp_replace(source,'^dcl:product:','bob:product:') END WHERE source='dcl_product_versions' OR source LIKE 'dcl:product:%'`.execute(
      tx,
    )
    await sql`DELETE FROM dcl_subjects WHERE entity='product'`.execute(tx)
    await sql`ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check CHECK (entity IN (
        'customer', 'supplier', 'other-unit', 'employee', 'sales-partner',
        'warehouse', 'vehicle', 'fund-account', 'operating-entity',
        'acc-mapping', 'rpt-definition', 'wfl-process-definition'
    ))`.execute(tx)
    await sql`ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_code_ck`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_code_ck CHECK (
        (entity = 'customer' AND code ~ '^CUS-[0-9]{4}$')
        OR (entity = 'supplier' AND code ~ '^SUP-[0-9]{4}$')
        OR (entity = 'other-unit' AND code ~ '^OTU-[0-9]{4}$')
        OR (entity = 'employee' AND code ~ '^EMP-[0-9]{4}$')
        OR (entity = 'sales-partner' AND code ~ '^SLP-[0-9]{4}$')
        OR (entity = 'warehouse' AND code ~ '^WHS-[0-9]{4}$')
        OR (entity = 'vehicle' AND code ~ '^VEH-[0-9]{4}$')
        OR (entity = 'fund-account' AND code ~ '^FAC-[0-9]{4}$')
        OR (entity = 'operating-entity' AND code ~ '^OPE-[0-9]{4}$')
        OR (entity = 'acc-mapping' AND code IS NULL)
        OR (entity = 'rpt-definition' AND code ~ '^rpt-[0-9]{6}$')
        OR (entity = 'wfl-process-definition' AND code ~ '^wfl-[0-9]{6}$')
    )`.execute(tx)
    const permissions = await new TargetBootstrapService(
      this.db,
    ).migratePermissionCatalogInTransaction(
      tx,
      preserveLegacyMappedPermissions(
        catalog,
        await tx
          .selectFrom('app_permissions')
          .select(['id', 'path', 'domain', 'entity', 'action', 'description'])
          .execute(),
        customerPermissionMappings,
      ),
      productPermissionMappings,
    )
    const count = await sql<{
      total: string
    }>`SELECT count(*)::text AS total FROM bob_subjects WHERE entity='product'`.execute(
      tx,
    )
    return { objects: Number(count.rows[0]!.total), permissions }
  }
}
