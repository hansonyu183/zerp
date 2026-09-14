import { createHash } from 'node:crypto'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { TargetBootstrapService } from '../app/bootstrap.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'

const entities = [
  'customer',
  'product',
  'supplier',
  'other-unit',
  'sales-partner',
]
const contentTables = [
  'customer_versions',
  'customer_subunit_roots',
  'customer_version_subunits',
  'supplier_versions',
  'supplier_version_operating_entities',
  'other_unit_versions',
  'other_unit_version_operating_entities',
  'sales_partner_versions',
  'sales_partner_version_operating_entities',
  'product_versions',
  'customer_attachment_staging',
  'customer_attachments',
] as const
const maintenance = new Set([
  'submission-query',
  'submission-get',
  'submit-new',
  'submit-change',
  'approve',
  'reject',
  'unreject',
  'unapprove',
  'delete',
  'attachment-stage',
  'attachment-cleanup',
  'save-subunits',
])
type Executor = Kysely<DB> | Transaction<DB>

function migratedPaths(path: string): string[] {
  const [, domain, entity, action] = path.split('/')
  if (domain !== 'bob' || !entities.includes(entity!)) return [path]
  if (maintenance.has(action!)) return [path.replace('/bob/', '/dcl/')]
  if (entity === 'customer' && action === 'attachment-read')
    return [path, '/dcl/customer/attachment-read']
  return [path]
}
async function fingerprint(tx: Executor, query: ReturnType<typeof sql>) {
  const result = await sql<{
    count: string
    digest: string
  }>`SELECT count(*)::text AS count, md5(COALESCE(string_agg(row::text, E'\n' ORDER BY row::text), '')) AS digest FROM (${query}) facts`.execute(
    tx,
  )
  return result.rows[0]!
}
async function archiveFacts(
  tx: Executor,
  phase: 'before' | 'after',
  migrated: Record<string, string[]> = {},
) {
  const facts: Record<string, { count: string; digest: string }> = {}
  const prefix = phase === 'before' ? 'bob' : 'dcl'
  for (const suffix of contentTables)
    facts[suffix] = await fingerprint(
      tx,
      sql`SELECT to_jsonb(t) AS row FROM ${sql.table(`${prefix}_${suffix}`)} t`,
    )
  facts.objects = await fingerprint(
    tx,
    sql`SELECT to_jsonb(t) AS row FROM ${sql.table(phase === 'before' ? 'bob_subjects' : 'bob_archive_objects')} t`,
  )
  for (const table of ['approval_entries', 'approval_events']) {
    facts[table] = await fingerprint(
      tx,
      phase === 'before'
        ? sql`SELECT to_jsonb(t) AS row FROM ${sql.table(table)} t`
        : sql`SELECT to_jsonb(t) || CASE WHEN id = ANY(${migrated[table] ?? []}::text[]) THEN jsonb_build_object('domain', 'bob') ELSE '{}'::jsonb END AS row FROM ${sql.table(table)} t`,
    )
  }
  facts.aux_reference_facts = await fingerprint(
    tx,
    phase === 'before'
      ? sql`SELECT to_jsonb(t) AS row FROM aux_reference_facts t`
      : sql`SELECT to_jsonb(t) || CASE WHEN id = ANY(${migrated.aux_reference_facts ?? []}::text[]) THEN jsonb_build_object('source', 'bob:' || substring(source from 5)) ELSE '{}'::jsonb END AS row FROM aux_reference_facts t`,
  )
  for (const table of [
    'archive_code_counters',
    'archive_idempotency',
    'bob_legacy_enablement_evidence',
  ])
    facts[table] = await fingerprint(
      tx,
      sql`SELECT to_jsonb(t) AS row FROM ${sql.table(table)} t`,
    )
  return facts
}
async function grants(tx: Executor) {
  const result = await sql<{
    role: string
    path: string
    status: string
  }>`SELECT rp.role_id AS role, p.path, p.status FROM app_role_permissions rp JOIN app_permissions p ON p.id=rp.permission_id ORDER BY rp.role_id,p.path`.execute(
    tx,
  )
  return result.rows
}
function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Read-only baseline. The caller freezes writers and saves the matching database and attachment backup. */
export async function inspectArchiveCutover(db: Executor) {
  const facts = await archiveFacts(db, 'before')
  const authority = await grants(db)
  const permissions = await db
    .selectFrom('app_permissions')
    .selectAll()
    .orderBy('path')
    .execute()
  const existingIdentities = await fingerprint(
    db,
    sql`SELECT to_jsonb(t) AS row FROM dcl_subjects t`,
  )
  return {
    baseline: digest({ facts, authority, permissions, existingIdentities }),
    facts,
  }
}

/** One-shot ownership conversion; all DDL, grants and facts commit together. */
export async function migrateArchiveOwnership(
  db: Kysely<DB>,
  expectedBaseline: string,
  catalog: readonly TargetPermissionCatalogEntry[],
) {
  return db.transaction().execute(async (tx) => {
    // Lock before reading the baseline. This also protects against a stale freeze or a late writer.
    const tables = await sql<{
      name: string
    }>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
      tx,
    )
    await sql`LOCK TABLE ${sql.join(tables.rows.map((row) => sql.table(row.name)))} IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const before = await inspectArchiveCutover(tx)
    if (before.baseline !== expectedBaseline)
      throw new Error('archive_cutover_baseline_changed')
    const collision =
      await sql`SELECT 1 FROM bob_subjects b JOIN dcl_subjects d ON d.id=b.id OR (d.entity=b.entity AND upper(d.code)=upper(b.code)) LIMIT 1`.execute(
        tx,
      )
    if (collision.rows.length)
      throw new Error('archive_cutover_identity_conflict')
    const migrated: Record<string, string[]> = {}
    for (const table of ['approval_entries', 'approval_events']) {
      const rows = await sql<{
        id: string
      }>`SELECT id FROM ${sql.table(table)} WHERE domain='bob' AND entity IN (${sql.join(entities)})`.execute(
        tx,
      )
      migrated[table] = rows.rows.map((row) => row.id)
    }
    const referencesToMove = await sql<{
      id: string
    }>`SELECT id FROM aux_reference_facts WHERE split_part(source, ':', 1)='bob' AND split_part(source, ':', 2) IN (${sql.join(entities)})`.execute(
      tx,
    )
    migrated.aux_reference_facts = referencesToMove.rows.map((row) => row.id)
    const oldGrants = await grants(tx)
    const expectedGrants = oldGrants
      .flatMap((row) =>
        migratedPaths(row.path).map((path) => ({ ...row, path })),
      )
      .sort(
        (a, b) => a.role.localeCompare(b.role) || a.path.localeCompare(b.path),
      )
    const oldPermissions = await tx
      .selectFrom('app_permissions')
      .selectAll()
      .execute()
    for (const permission of oldPermissions) {
      const paths = migratedPaths(permission.path)
      if (paths[0] !== permission.path) {
        if (oldPermissions.some((row) => row.path === paths[0]))
          throw new Error('archive_cutover_permission_conflict')
        await tx
          .updateTable('app_permissions')
          .set({ path: paths[0]!, domain: 'dcl' })
          .where('id', '=', permission.id)
          .execute()
      }
      if (paths.length === 2) {
        const target = catalog.find((row) => row.path === paths[1])
        if (!target || oldPermissions.some((row) => row.path === target.path))
          throw new Error('archive_cutover_permission_conflict')
        await tx
          .insertInto('app_permissions')
          .values({
            id: target.id,
            path: target.path,
            domain: target.domain,
            entity: target.entity,
            action: target.action,
            description: target.title,
            status: permission.status,
          })
          .execute()
        await sql`INSERT INTO app_role_permissions(role_id,permission_id,created_at,created_by) SELECT role_id,${target.id},created_at,created_by FROM app_role_permissions WHERE permission_id=${permission.id}`.execute(
          tx,
        )
      }
    }
    await sql`ALTER TABLE dcl_subjects DROP CONSTRAINT dcl_subjects_entity_check, DROP CONSTRAINT dcl_subjects_entity_code_ck`.execute(
      tx,
    )
    await sql`ALTER TABLE dcl_subjects ADD CHECK (entity IN ('customer','product','supplier','other-unit','employee','sales-partner','warehouse','vehicle','fund-account','operating-entity','acc-mapping','rpt-definition','wfl-process-definition')), ADD CONSTRAINT dcl_subjects_entity_code_ck CHECK ((entity='customer' AND code ~ '^CUS-[0-9]{4}$') OR (entity IN ('product','supplier','other-unit','sales-partner') AND code IS NOT NULL) OR (entity='employee' AND code ~ '^EMP-[0-9]{4}$') OR (entity='warehouse' AND code ~ '^WHS-[0-9]{4}$') OR (entity='vehicle' AND code ~ '^VEH-[0-9]{4}$') OR (entity='fund-account' AND code ~ '^FAC-[0-9]{4}$') OR (entity='operating-entity' AND code ~ '^OPE-[0-9]{4}$') OR (entity='acc-mapping' AND code IS NULL) OR (entity='rpt-definition' AND code ~ '^rpt-[0-9]{6}$') OR (entity='wfl-process-definition' AND code ~ '^wfl-[0-9]{6}$'))`.execute(
      tx,
    )
    await sql`INSERT INTO dcl_subjects(id,entity,code,created_at,created_by) SELECT id,entity,code,created_at,created_by FROM bob_subjects`.execute(
      tx,
    )
    await sql`CREATE TABLE bob_objects (id varchar(26) PRIMARY KEY REFERENCES dcl_subjects(id) ON DELETE CASCADE, enabled boolean NOT NULL DEFAULT true, revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0))`.execute(
      tx,
    )
    await sql`INSERT INTO bob_objects SELECT id,enabled,revision FROM bob_subjects`.execute(
      tx,
    )
    const references = await sql<{
      table: string
      name: string
      definition: string
    }>`SELECT conrelid::regclass::text AS table,conname AS name,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE contype='f' AND confrelid='bob_subjects'::regclass`.execute(
      tx,
    )
    for (const ref of references.rows) {
      await sql`ALTER TABLE ${sql.table(ref.table)} DROP CONSTRAINT ${sql.id(ref.name)}`.execute(
        tx,
      )
      // Constraint text comes solely from PostgreSQL's catalog under the same lock.
      await sql`ALTER TABLE ${sql.table(ref.table)} ADD CONSTRAINT ${sql.id(ref.name)} ${sql.raw(ref.definition.replace('REFERENCES bob_subjects(', 'REFERENCES dcl_subjects('))}`.execute(
        tx,
      )
    }
    for (const suffix of contentTables)
      await sql`ALTER TABLE ${sql.table(`bob_${suffix}`)} RENAME TO ${sql.id(`dcl_${suffix}`)}`.execute(
        tx,
      )
    for (const table of ['approval_entries', 'approval_events'])
      await sql`UPDATE ${sql.table(table)} SET domain='dcl' WHERE domain='bob' AND entity IN (${sql.join(entities)})`.execute(
        tx,
      )
    await sql`UPDATE aux_reference_facts SET source='dcl:' || substring(source from 5) WHERE id=ANY(${migrated.aux_reference_facts}::text[])`.execute(
      tx,
    )
    await sql`DROP TABLE bob_subjects`.execute(tx)
    await sql`CREATE VIEW bob_archive_objects AS SELECT s.id,s.entity,s.code,s.created_at,s.created_by,b.enabled,b.revision FROM dcl_subjects s JOIN bob_objects b ON b.id=s.id`.execute(
      tx,
    )
    await new TargetBootstrapService(db).syncPermissionCatalogInTransaction(
      tx,
      catalog,
    )
    const actualGrants = (await grants(tx)).sort(
      (a, b) => a.role.localeCompare(b.role) || a.path.localeCompare(b.path),
    )
    if (digest(actualGrants) !== digest(expectedGrants))
      throw new Error('archive_cutover_authority_mismatch')
    const after = await archiveFacts(tx, 'after', migrated)
    if (digest(after) !== digest(before.facts))
      throw new Error('archive_cutover_facts_mismatch')
    await tx
      .updateTable('app_sessions')
      .set({
        revoked_at: new Date(),
        revoked_reason: 'archive_ownership_cutover',
      })
      .where('revoked_at', 'is', null)
      .execute()
    return {
      baseline: before.baseline,
      facts: after,
      preserved: true as const,
      grants: actualGrants.length,
    }
  })
}
