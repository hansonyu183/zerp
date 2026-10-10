import { sql, type Kysely } from 'kysely'
import type { DB } from '../../src/db/generated.ts'

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
