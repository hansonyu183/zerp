import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { TargetBootstrapService } from '../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import { customerPermissionMappings } from './customer-permissions.ts'

export class CustomerMigrationError extends Error {
  readonly blockers: Array<{ subjectId: string; reason: string }>
  constructor(blockers: Array<{ subjectId: string; reason: string }>) {
    super('Customer migration blocked')
    this.blockers = blockers
  }
}

/** One-time conversion after #396. No transaction, quantity or reference is rebuilt. */
export class CustomerMigrationService {
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
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('bob:customer:migration',0))`.execute(
      tx,
    )
    const state = await sql<{
      source: string | null
      target: string | null
      subjects: string | null
    }>`SELECT to_regclass('dcl_customer_versions')::text AS source,to_regclass('bob_customer_versions')::text AS target,to_regclass('bob_subjects')::text AS subjects`.execute(
      tx,
    )
    if (
      !state.rows[0]?.source ||
      state.rows[0].target ||
      !state.rows[0].subjects
    )
      throw new CustomerMigrationError([
        { subjectId: '', reason: 'SOURCE_MISSING_OR_TARGET_ALREADY_EXISTS' },
      ])
    await sql`LOCK TABLE dcl_subjects,bob_subjects,dcl_customer_versions,dcl_customer_subunit_roots,dcl_customer_version_subunits,dcl_customer_attachments,dcl_customer_attachment_staging,approval_entries,approval_events,archive_idempotency,archive_code_counters,app_permissions,app_role_permissions,aux_reference_facts IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const invalid = await sql<{ subject_id: string }>`
      SELECT s.id AS subject_id FROM dcl_subjects s WHERE s.entity='customer' AND (
        s.code IS NULL OR EXISTS(SELECT 1 FROM bob_subjects target WHERE target.id=s.id OR (target.entity='customer' AND target.code=s.code))
        OR NOT EXISTS(SELECT 1 FROM approval_entries e WHERE e.domain='dcl' AND e.entity='customer' AND e.subject_id=s.id)
        OR EXISTS(SELECT 1 FROM approval_entries e WHERE e.domain='dcl' AND e.entity='customer' AND e.subject_id=s.id AND (e.version_no IS NULL OR NOT EXISTS(SELECT 1 FROM dcl_customer_versions v WHERE v.approval_entry_id=e.id)))
      )
      UNION SELECT e.subject_id FROM approval_entries e WHERE e.domain='dcl' AND e.entity='customer' AND NOT EXISTS(SELECT 1 FROM dcl_subjects s WHERE s.id=e.subject_id AND s.entity='customer')
      UNION SELECT subject_id FROM approval_entries WHERE domain='dcl' AND entity='customer' GROUP BY subject_id HAVING count(*) FILTER (WHERE status='APPROVED')=0 AND NOT(count(*)=1 AND max(version_no)=1 AND max(status) IN ('PENDING','REJECTED'))
      UNION SELECT e.subject_id FROM dcl_customer_versions v JOIN approval_entries e ON e.id=v.approval_entry_id WHERE e.domain<>'dcl' OR e.entity<>'customer'
    `.execute(tx)
    if (invalid.rows.length)
      throw new CustomerMigrationError(
        invalid.rows.map((row) => ({
          subjectId: row.subject_id,
          reason: 'INVALID_HISTORY',
        })),
      )
    await sql`INSERT INTO bob_legacy_enablement_evidence(approval_entry_id,enabled) SELECT approval_entry_id,enabled FROM dcl_customer_versions`.execute(
      tx,
    )
    await sql`ALTER TABLE bob_subjects DROP CONSTRAINT bob_subjects_entity_check`.execute(
      tx,
    )
    await sql`ALTER TABLE bob_subjects ADD CONSTRAINT bob_subjects_entity_check CHECK(entity IN ('supplier','other-unit','sales-partner','product','customer'))`.execute(
      tx,
    )
    await sql`ALTER TABLE bob_subjects ADD CONSTRAINT bob_subjects_customer_code_ck CHECK(entity <> 'customer' OR code ~ '^CUS-[0-9]{4}$')`.execute(
      tx,
    )
    await sql`INSERT INTO bob_subjects(id,entity,code,enabled,revision,created_at,created_by)
      SELECT s.id,s.entity,s.code,v.enabled,1,s.created_at,s.created_by FROM dcl_subjects s
      JOIN LATERAL(SELECT id FROM approval_entries e WHERE e.domain='dcl' AND e.entity='customer' AND e.subject_id=s.id ORDER BY (status='APPROVED') DESC,version_no DESC LIMIT 1) chosen ON true
      JOIN dcl_customer_versions v ON v.approval_entry_id=chosen.id WHERE s.entity='customer'`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_customer_versions RENAME TO bob_customer_versions`.execute(
      tx,
    )
    await sql`ALTER TABLE bob_customer_versions DROP COLUMN enabled`.execute(tx)
    await sql`ALTER TABLE dcl_customer_subunit_roots RENAME TO bob_customer_subunit_roots`.execute(
      tx,
    )
    await sql`ALTER TABLE bob_customer_subunit_roots DROP CONSTRAINT dcl_customer_subunit_roots_customer_id_fkey`.execute(
      tx,
    )
    await sql`ALTER TABLE bob_customer_subunit_roots ADD CONSTRAINT bob_customer_subunit_roots_customer_id_fkey FOREIGN KEY(customer_id) REFERENCES bob_subjects(id) ON DELETE CASCADE`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_customer_version_subunits RENAME TO bob_customer_version_subunits`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_customer_attachments RENAME TO bob_customer_attachments`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_customer_attachment_staging RENAME TO bob_customer_attachment_staging`.execute(
      tx,
    )
    await sql`UPDATE approval_entries SET domain='bob' WHERE domain='dcl' AND entity='customer'`.execute(
      tx,
    )
    await sql`UPDATE approval_events SET domain='bob' WHERE domain='dcl' AND entity='customer'`.execute(
      tx,
    )
    await sql`UPDATE archive_idempotency SET response=jsonb_set(response,'{snapshot}',(response->'snapshot')-'enabled') WHERE entity='customer'`.execute(
      tx,
    )
    await sql`UPDATE aux_reference_facts SET source=CASE WHEN source='dcl_customer_versions' THEN 'bob_customer_versions' ELSE regexp_replace(source,'^dcl:customer:','bob:customer:') END WHERE source='dcl_customer_versions' OR source LIKE 'dcl:customer:%'`.execute(
      tx,
    )
    for (const table of [
      'acc_opening_container_balances',
      'acc_container_entries',
    ] as const) {
      const constraint = `${table}_customer_id_fkey`
      await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT ${sql.id(constraint)}`.execute(
        tx,
      )
      await sql`ALTER TABLE ${sql.table(table)} ADD CONSTRAINT ${sql.id(constraint)} FOREIGN KEY(customer_id) REFERENCES bob_subjects(id) ON DELETE RESTRICT`.execute(
        tx,
      )
    }
    await sql`DELETE FROM dcl_subjects WHERE entity='customer'`.execute(tx)
    await sql`ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_check CHECK (entity IN (
        'supplier', 'other-unit', 'employee', 'sales-partner',
        'warehouse', 'vehicle', 'fund-account', 'operating-entity',
        'acc-mapping', 'rpt-definition', 'wfl-process-definition'
    ))`.execute(tx)
    await sql`ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_code_ck`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_subjects ADD CONSTRAINT dcl_subjects_entity_code_ck CHECK (
        (entity = 'supplier' AND code ~ '^SUP-[0-9]{4}$')
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
    // Runtime report permissions are independent of this archive migration.
    const reportPermissions = await tx
      .selectFrom('app_permissions')
      .select(['id', 'path', 'domain', 'entity', 'action', 'description'])
      .where('domain', '=', 'rpt')
      .execute()
    const completeCatalog = new Map(catalog.map((entry) => [entry.path, entry]))
    for (const permission of reportPermissions) {
      if (/^\/rpt\/rpt-[0-9]{6}\/(query|export)$/.test(permission.path)) {
        const { description, ...entry } = permission
        completeCatalog.set(entry.path, {
          ...entry,
          title: description ?? entry.path,
        })
      }
    }
    const permissions = await new TargetBootstrapService(
      this.db,
    ).migratePermissionCatalogInTransaction(
      tx,
      [...completeCatalog.values()],
      customerPermissionMappings,
    )
    const count = await sql<{
      total: string
    }>`SELECT count(*)::text AS total FROM bob_subjects WHERE entity='customer'`.execute(
      tx,
    )
    return { objects: Number(count.rows[0]!.total), permissions }
  }
}
