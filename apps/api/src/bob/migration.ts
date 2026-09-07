import { preserveLegacyProductPermissions } from './product-permissions.ts'
import { sql, type Kysely, type Transaction } from 'kysely'

import type { DB } from '../db/generated.ts'
import {
  TargetBootstrapService,
  type PermissionPathMapping,
} from '../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'

const entities = ['supplier', 'other-unit', 'sales-partner'] as const
const actions = [
  'query',
  'get',
  'versions',
  'audit-history',
  'submit-new',
  'submit-change',
  'approve',
  'reject',
  'unreject',
  'unapprove',
  'delete',
] as const
export const bobArchivePermissionMappings: readonly PermissionPathMapping[] =
  entities.flatMap((entity) =>
    actions.map((action) => ({
      from: `/dcl/${entity}/${action}`,
      to: [
        `/bob/${entity}/${action === 'query' ? 'submission-query' : action === 'get' ? 'submission-get' : action}`,
      ],
    })),
  )

export class BobArchiveMigrationError extends Error {
  readonly blockers: Array<{
    entity: string
    subjectId: string
    reason: string
  }>
  constructor(blockers: BobArchiveMigrationError['blockers']) {
    super('BOB archive migration blocked')
    this.blockers = blockers
  }
}

/** One-time identity, history and exact-authority conversion in one transaction. */
export class BobArchiveMigrationService {
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
    await sql`SELECT pg_advisory_xact_lock(hashtextextended('bob:archive:migration', 0))`.execute(
      tx,
    )
    const state = await sql<{
      target: string | null
      source: string | null
    }>`SELECT to_regclass('bob_subjects')::text AS target, to_regclass('dcl_supplier_versions')::text AS source`.execute(
      tx,
    )
    if (state.rows[0]?.target || !state.rows[0]?.source)
      throw new BobArchiveMigrationError([
        {
          entity: 'supplier',
          subjectId: '',
          reason: 'TARGET_ALREADY_EXISTS_OR_SOURCE_MISSING',
        },
      ])
    await sql`LOCK TABLE dcl_subjects, approval_entries, approval_events, dcl_supplier_versions, dcl_other_unit_versions, dcl_sales_partner_versions, dcl_archive_idempotency, dcl_code_counters, app_permissions, app_role_permissions IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const invalid = await sql<{ entity: string; subject_id: string }>`
      SELECT subject.entity, subject.id AS subject_id FROM dcl_subjects subject
      WHERE subject.entity IN ('supplier','other-unit','sales-partner') AND (
        NOT EXISTS (SELECT 1 FROM approval_entries e WHERE e.domain='dcl' AND e.entity=subject.entity AND e.subject_id=subject.id)
        OR EXISTS (SELECT 1 FROM approval_entries e WHERE e.domain='dcl' AND e.entity=subject.entity AND e.subject_id=subject.id AND (
          e.version_no IS NULL OR
          (e.entity='supplier' AND NOT EXISTS (SELECT 1 FROM dcl_supplier_versions v WHERE v.approval_entry_id=e.id)) OR
          (e.entity='other-unit' AND NOT EXISTS (SELECT 1 FROM dcl_other_unit_versions v WHERE v.approval_entry_id=e.id)) OR
          (e.entity='sales-partner' AND NOT EXISTS (SELECT 1 FROM dcl_sales_partner_versions v WHERE v.approval_entry_id=e.id))
        ))
      )`.execute(tx)
    const missingApproved = await sql<{ entity: string; subject_id: string }>`
      SELECT entity,subject_id FROM approval_entries WHERE domain='dcl' AND entity IN ('supplier','other-unit','sales-partner')
      GROUP BY entity,subject_id HAVING count(*) FILTER (WHERE status='APPROVED')=0
        AND NOT (count(*)=1 AND max(version_no)=1 AND max(status) IN ('PENDING','REJECTED'))`.execute(
      tx,
    )
    invalid.rows.push(...missingApproved.rows)
    const orphaned = await sql<{ entity: string; subject_id: string }>`
      SELECT e.entity,e.subject_id FROM approval_entries e WHERE e.domain='dcl' AND e.entity IN ('supplier','other-unit','sales-partner')
        AND NOT EXISTS (SELECT 1 FROM dcl_subjects s WHERE s.id=e.subject_id AND s.entity=e.entity)`.execute(
      tx,
    )
    invalid.rows.push(...orphaned.rows)
    if (invalid.rows.length)
      throw new BobArchiveMigrationError(
        invalid.rows.map((row) => ({
          entity: row.entity,
          subjectId: row.subject_id,
          reason: 'INVALID_HISTORY',
        })),
      )
    await sql`CREATE TABLE bob_subjects (
      id varchar(26) PRIMARY KEY, entity varchar(64) NOT NULL CHECK (entity IN ('supplier','other-unit','sales-partner')),
      code varchar(64) NOT NULL, enabled boolean NOT NULL DEFAULT true,
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0), created_at timestamptz NOT NULL,
      created_by varchar(26) NOT NULL REFERENCES app_users(id), UNIQUE(entity,code)
    )`.execute(tx)
    await sql`CREATE TABLE bob_legacy_enablement_evidence (
      approval_entry_id varchar(26) PRIMARY KEY REFERENCES approval_entries(id) ON DELETE CASCADE,
      enabled boolean NOT NULL
    )`.execute(tx)
    for (const entity of entities) {
      const sourceTable = `dcl_${entity.replaceAll('-', '_')}_versions`
      const targetTable = `bob_${entity.replaceAll('-', '_')}_versions`
      await sql`INSERT INTO bob_legacy_enablement_evidence(approval_entry_id, enabled) SELECT approval_entry_id, enabled FROM ${sql.table(sourceTable)}`.execute(
        tx,
      )
      await sql`INSERT INTO bob_subjects(id,entity,code,enabled,revision,created_at,created_by)
        SELECT s.id,s.entity,s.code,v.enabled,1,s.created_at,s.created_by
        FROM dcl_subjects s
        JOIN LATERAL (SELECT id FROM approval_entries e WHERE e.domain='dcl' AND e.entity=s.entity AND e.subject_id=s.id
          ORDER BY (status='APPROVED') DESC, version_no DESC LIMIT 1) chosen ON true
        JOIN ${sql.table(sourceTable)} v ON v.approval_entry_id=chosen.id WHERE s.entity=${entity}`.execute(
        tx,
      )
      await sql`ALTER TABLE ${sql.table(sourceTable)} RENAME TO ${sql.ref(targetTable)}`.execute(
        tx,
      )
      await sql`ALTER TABLE ${sql.table(targetTable)} DROP COLUMN enabled`.execute(
        tx,
      )
      await sql`ALTER TABLE ${sql.table(`dcl_${entity.replaceAll('-', '_')}_version_operating_entities`)} RENAME TO ${sql.ref(`bob_${entity.replaceAll('-', '_')}_version_operating_entities`)}`.execute(
        tx,
      )
    }
    await sql`UPDATE approval_entries SET domain='bob' WHERE domain='dcl' AND entity IN ('supplier','other-unit','sales-partner')`.execute(
      tx,
    )
    await sql`UPDATE aux_reference_facts SET source=regexp_replace(source,'^dcl:', 'bob:') WHERE source ~ '^dcl:(supplier|other-unit|sales-partner):'`.execute(
      tx,
    )
    await sql`UPDATE approval_events SET domain='bob' WHERE domain='dcl' AND entity IN ('supplier','other-unit','sales-partner')`.execute(
      tx,
    )
    // Existing idempotent responses keep the original submission identity and content.
    await sql`UPDATE dcl_archive_idempotency SET response=jsonb_set(response,'{snapshot}',(response->'snapshot')-'enabled') WHERE entity IN ('supplier','other-unit','sales-partner')`.execute(
      tx,
    )
    await sql`DELETE FROM dcl_subjects WHERE entity IN ('supplier','other-unit','sales-partner')`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_code_counters RENAME TO archive_code_counters`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_archive_idempotency RENAME TO archive_idempotency`.execute(
      tx,
    )
    const permissionReport = await new TargetBootstrapService(
      this.db,
    ).migratePermissionCatalogInTransaction(
      tx,
      preserveLegacyProductPermissions(
        catalog,
        await tx
          .selectFrom('app_permissions')
          .select(['id', 'path', 'domain', 'entity', 'action', 'description'])
          .execute(),
      ),
      bobArchivePermissionMappings,
    )
    const count = await sql<{
      total: string
    }>`SELECT count(*)::text AS total FROM bob_subjects`.execute(tx)
    return {
      objects: Number(count.rows[0]!.total),
      permissions: permissionReport,
    }
  }
}
