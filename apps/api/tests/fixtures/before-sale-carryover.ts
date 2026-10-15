import { sql, type Kysely } from 'kysely'
import type { DB } from '../../src/db/generated.ts'

/** Exact pre-sales layout for exclusive synthetic maintenance fixtures. */
export async function precedingSaleCarryoverLayout(db: Kysely<DB>) {
  await sql`ALTER TABLE vou_source_line_snapshots DROP COLUMN prior_stock_lines`.execute(
    db,
  )
  await sql`ALTER TABLE vou_signoff_line_snapshots DROP COLUMN prior_lost_quantity_micros, DROP COLUMN prior_amount_minor`.execute(
    db,
  )
  await sql`ALTER TABLE vou_prior_facts DROP CONSTRAINT vou_prior_facts_source_document_type_check, ADD CONSTRAINT vou_prior_facts_source_document_type_check CHECK (source_document_type IN ('AA','AD','AB','AE','AF','AH')), DROP CONSTRAINT vou_prior_facts_source_component_check, ADD CONSTRAINT vou_prior_facts_source_component_check CHECK (source_component IN ('PROCUREMENT','SERVICE'))`.execute(
    db,
  )
  await sql`UPDATE app_role_permissions SET service_contexts=ARRAY(SELECT context FROM unnest(service_contexts) context WHERE context = ANY(ARRAY['OTHER_UNIT','SUPPLIER','SALES_PARTNER','PRIOR_AA','PRIOR_AD','CONTRACT','PRIOR_AB','PRIOR_AE','PRIOR_AH']::text[]))`.execute(
    db,
  )
  await sql`ALTER TABLE app_role_permissions DROP CONSTRAINT app_role_permissions_service_contexts_check, ADD CONSTRAINT app_role_permissions_service_contexts_check CHECK (service_contexts <@ ARRAY['OTHER_UNIT','SUPPLIER','SALES_PARTNER','PRIOR_AA','PRIOR_AD','CONTRACT','PRIOR_AB','PRIOR_AE','PRIOR_AH']::text[])`.execute(
    db,
  )
}
