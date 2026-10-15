import { createHash } from 'node:crypto'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import {
  publicSchemaLayout,
  publicTableNames,
} from '../platform/maintenance-layout.ts'

type Executor = Kysely<DB> | Transaction<DB>
const tables = [
  'vou_prior_facts',
  'vou_source_line_snapshots',
  'vou_signoff_line_snapshots',
]
// Measured from committed 7353ef2e and 1f26c4c5 schemas on an owned PG18 fixture.
const sourceLayout =
  '60178b9ff5a5bdb7fe0c4fe4747d6fe1de988df420147dd8284fbd01145946bd'
const currentLayout =
  'ce3a91c56385c82e37b6f0909a48cf30592c47f39f7ff70e2d811d670ea6a413'
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const addedColumns = new Set([
  'vou_source_line_snapshots/prior_stock_lines',
  'vou_signoff_line_snapshots/prior_lost_quantity_micros',
  'vou_signoff_line_snapshots/prior_amount_minor',
])
const changedConstraints = new Set([
  'vou_prior_facts/vou_prior_facts_source_document_type_check',
  'vou_prior_facts/vou_prior_facts_source_component_check',
  'vou_signoff_line_snapshots/vou_signoff_line_snapshots_prior_lost_quantity_micros_check',
])

async function snapshot(db: Executor) {
  const shape = await publicSchemaLayout(db, tables),
    hash = digest(shape),
    layout =
      hash === sourceLayout
        ? 'SOURCE'
        : hash === currentLayout
          ? 'CURRENT'
          : 'UNSUPPORTED'
  if (layout === 'UNSUPPORTED')
    return { layout, shape, facts: null, unchangedSchema: null }
  const names = await publicTableNames(db),
    schema = await publicSchemaLayout(db, names)
  const unchangedSchema = {
    ...schema,
    columns: schema.columns.filter((row) => {
      const r = row as { table_name: string; column_name: string }
      return !addedColumns.has(`${r.table_name}/${r.column_name}`)
    }),
    constraints: schema.constraints.filter((row) => {
      const r = row as { table_name: string; conname: string }
      return !changedConstraints.has(`${r.table_name}/${r.conname}`)
    }),
  }
  const facts: Record<string, string[]> = {}
  for (const table of names) {
    const projection =
      layout === 'CURRENT' && table === 'vou_source_line_snapshots'
        ? sql`to_jsonb(fact)-'prior_stock_lines'`
        : layout === 'CURRENT' && table === 'vou_signoff_line_snapshots'
          ? sql`to_jsonb(fact)-'prior_lost_quantity_micros'-'prior_amount_minor'`
          : sql`to_jsonb(fact)`
    facts[table] = (
      await sql<{
        fact: string
      }>`SELECT (${projection})::text AS fact FROM ${sql.table(table)} fact ORDER BY (${projection})::text`.execute(
        db,
      )
    ).rows.map((row) => row.fact)
  }
  if (facts.app_installation?.length !== 1)
    return { layout: 'UNSUPPORTED', shape, facts: null, unchangedSchema: null }
  return { layout, shape, facts, unchangedSchema }
}

export async function inspectSaleCarryoverUpgrade(db: Executor) {
  const current = await snapshot(db)
  return {
    layout: current.layout,
    baseline: digest(current),
    publicTables: current.facts ? Object.keys(current.facts).length : null,
    priorFacts: current.facts?.vou_prior_facts?.length ?? null,
    sourceLines: current.facts?.vou_source_line_snapshots?.length ?? null,
    signoffLines: current.facts?.vou_signoff_line_snapshots?.length ?? null,
  }
}

export async function upgradeSaleCarryover(
  db: Kysely<DB>,
  input: {
    baseline: string
    actorId: string
    sourceReleaseSha: string
    targetReleaseSha: string
  },
) {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(74155001)`.execute(tx)
    await sql`LOCK TABLE ${sql.join((await publicTableNames(tx)).map((table) => sql.table(table)))} IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const before = await snapshot(tx)
    if (before.layout !== 'SOURCE')
      throw new Error('sale_carryover_upgrade_source_layout_required')
    if (digest(before) !== input.baseline)
      throw new Error('sale_carryover_upgrade_baseline_changed')
    const operator =
      await sql`SELECT 1 FROM app_users user_record JOIN app_user_roles membership ON membership.user_id=user_record.id JOIN app_roles role ON role.id=membership.role_id WHERE user_record.id=${input.actorId} AND user_record.status='ENABLED' AND role.status='ENABLED' AND role.code='superadmin'`.execute(
        tx,
      )
    if (!operator.rows.length)
      throw new Error('sale_carryover_upgrade_operator_required')
    await sql`ALTER TABLE vou_prior_facts
      DROP CONSTRAINT vou_prior_facts_source_document_type_check,
      ADD CONSTRAINT vou_prior_facts_source_document_type_check CHECK (source_document_type IN ('AA','AD','AB','AE','AF','AH','BB','BA')),
      DROP CONSTRAINT vou_prior_facts_source_component_check,
      ADD CONSTRAINT vou_prior_facts_source_component_check CHECK (source_component IN ('PROCUREMENT','SERVICE','SALE_ORDER','SALE_OUTBOUND','SALE_SIGNOFF'))`.execute(
      tx,
    )
    await sql`ALTER TABLE vou_source_line_snapshots ADD COLUMN prior_stock_lines jsonb`.execute(
      tx,
    )
    await sql`ALTER TABLE vou_signoff_line_snapshots ADD COLUMN prior_lost_quantity_micros bigint CHECK (prior_lost_quantity_micros>=0), ADD COLUMN prior_amount_minor bigint`.execute(
      tx,
    )
    const after = await snapshot(tx)
    if (
      after.layout !== 'CURRENT' ||
      digest(after.unchangedSchema) !== digest(before.unchangedSchema)
    )
      throw new Error('sale_carryover_upgrade_layout_mismatch')
    if (digest(after.facts) !== digest(before.facts))
      throw new Error('sale_carryover_upgrade_fact_mismatch')
    return {
      upgraded: true,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
      baseline: input.baseline,
      afterBaseline: digest(after),
      publicTables: Object.keys(after.facts!).length,
      originalFactsDigest: digest(before.facts),
      priorFactsPreserved: after.facts!.vou_prior_facts!.length,
      originalSalesBackfilled: false,
    }
  })
}
