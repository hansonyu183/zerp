import { sql, type Kysely } from 'kysely'
import type { DB } from '../../src/db/generated.ts'

/** Reconstructs the exact prior schema in an exclusive synthetic fixture only. */
export async function precedingCustomerArchiveLayout(db: Kysely<DB>) {
  for (const table of ['dcl_product_versions', 'dcl_supplier_versions']) {
    const files = await sql<{
      count: string
    }>`SELECT count(*)::text AS count FROM ${sql.table(table)} WHERE attachments <> '[]'::jsonb`.execute(
      db,
    )
    if (files.rows[0]!.count !== '0')
      throw new Error('fixture cannot discard archive files')
    await sql`ALTER TABLE ${sql.table(table)} DROP COLUMN attachments`.execute(
      db,
    )
  }
  const staged = await sql<{
    count: string
  }>`SELECT count(*)::text AS count FROM dcl_archive_attachment_staging`.execute(
    db,
  )
  if (staged.rows[0]!.count !== '0')
    throw new Error('fixture cannot discard staged binding')
  await sql`ALTER TABLE dcl_archive_attachment_staging DROP COLUMN entity, DROP COLUMN subject_id`.execute(
    db,
  )
  for (const [current, prior] of [
    ['dcl_archive_attachment_staging', 'dcl_customer_attachment_staging'],
    ['dcl_archive_attachments', 'dcl_customer_attachments'],
  ] as const) {
    const names = await sql<{
      name: string
    }>`SELECT conname AS name FROM pg_constraint WHERE conrelid=${current}::regclass ORDER BY conname`.execute(
      db,
    )
    await sql`ALTER TABLE ${sql.table(current)} RENAME TO ${sql.id(prior)}`.execute(
      db,
    )
    for (const { name } of names.rows) {
      if (!name.startsWith(current + '_'))
        throw new Error('unexpected fixture constraint')
      await sql`ALTER TABLE ${sql.table(prior)} RENAME CONSTRAINT ${sql.id(name)} TO ${sql.id(prior + name.slice(current.length))}`.execute(
        db,
      )
    }
  }
}

/** Exact attachment checks in the release preceding ordinary opaque archives. */
export async function precedingAttachmentArchiveChecks(db: Kysely<DB>) {
  for (const table of [
    'dcl_customer_attachment_staging',
    'dcl_customer_attachments',
    'vou_attachment_staging',
    'vou_attachments',
  ]) {
    await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT ${sql.id(table + '_size_bytes_check')}, ADD CONSTRAINT ${sql.id(table + '_size_bytes_check')} CHECK (size_bytes BETWEEN 1 AND 10485760)`.execute(
      db,
    )
  }
  await sql`ALTER TABLE vou_attachment_staging DROP CONSTRAINT vou_attachment_staging_mime_type_check, ADD CONSTRAINT vou_attachment_staging_mime_type_check CHECK (mime_type IN ('application/pdf','image/jpeg','image/png'))`.execute(
    db,
  )
}

export async function precedingMaintainedConstraintNames(db: Kysely<DB>) {
  await sql`ALTER TABLE vou_intermediary_source_line_snapshots RENAME CONSTRAINT vou_intermediary_source_line_snapsho_unit_price_micros_not_null TO vou_intermediary_source_line_snapshot_unit_price_minor_not_null`.execute(
    db,
  )
  await sql`ALTER TABLE vou_product_line_snapshots RENAME CONSTRAINT vou_product_line_snapshots_check TO vou_product_line_pricing_shape`.execute(
    db,
  )
  await sql`ALTER TABLE vou_product_line_snapshots RENAME CONSTRAINT vou_product_line_snapshots_check1 TO vou_product_line_snapshots_check`.execute(
    db,
  )
}
