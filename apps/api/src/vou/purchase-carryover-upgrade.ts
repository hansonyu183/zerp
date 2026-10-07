import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'

type Executor = Kysely<DB> | Transaction<DB>
const changed = [
  'vou_source_line_snapshots',
  'vou_return_line_snapshots',
  'vou_prior_facts',
  'vou_return_allocation_counters',
]
const added = ['vou_prior_facts', 'vou_return_allocation_counters']
const oldLayout =
  '5c9ff5ebb314cdcd166e7a251aba9e6cb19fec57ec42fd7996c55370cf57829f'
const newLayout =
  'fbb0d546558d244fb2caf1d5fc08568623f7e1cb851d834b75e1fbd58d67e610'
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

async function layout(db: Executor) {
  const columns =
    await sql`SELECT cls.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,pg_get_expr(d.adbin,d.adrelid) AS column_default,
    a.attidentity::text AS identity_generation,a.attgenerated::text AS generated
    FROM pg_attribute a JOIN pg_class cls ON cls.oid=a.attrelid JOIN pg_namespace ns ON ns.oid=cls.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE ns.nspname='public' AND cls.relname IN (${sql.join(changed)}) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY table_name,column_name`.execute(db)
  const constraints =
    await sql`SELECT cls.relname AS table_name,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class cls ON cls.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cls.relnamespace
    WHERE ns.nspname='public' AND cls.relname IN (${sql.join(changed)}) ORDER BY cls.relname,c.conname`.execute(
      db,
    )
  const indexes =
    await sql`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN (${sql.join(changed)}) ORDER BY tablename,indexname`.execute(
      db,
    )
  const value = {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  }
  const hash = digest(value)
  return {
    layout:
      hash === oldLayout
        ? ('LEGACY' as const)
        : hash === newLayout
          ? ('CURRENT' as const)
          : ('UNSUPPORTED' as const),
    value,
  }
}

async function allFacts(db: Executor, projectCurrent = false) {
  const tables = await sql<{
    tablename: string
  }>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
    db,
  )
  const facts: Record<string, string[]> = {}
  for (const { tablename } of tables.rows) {
    if (projectCurrent && added.includes(tablename)) continue
    const projection =
      projectCurrent && tablename === 'vou_source_line_snapshots'
        ? sql`to_jsonb(fact)-'prior_amount_minor'`
        : projectCurrent && tablename === 'vou_return_line_snapshots'
          ? sql`to_jsonb(fact)-'prior_amount_minor'-'allocation_sequence'`
          : sql`to_jsonb(fact)`
    const rows = await sql<{
      fact: string
    }>`SELECT (${projection})::text AS fact FROM ${sql.table(tablename)} fact ORDER BY (${projection})::text`.execute(
      db,
    )
    // JSON stays PostgreSQL text, including exact numeric and bigint values.
    facts[tablename] = rows.rows.map((row) => row.fact)
  }
  return facts
}
async function snapshot(db: Executor) {
  const shape = await layout(db)
  if (shape.layout === 'UNSUPPORTED')
    return {
      layout: shape.layout,
      shape: shape.value,
      facts: null,
      approvedReturns: null,
    }
  const returns = await sql<{
    count: string
  }>`SELECT COUNT(DISTINCT entry.id)::text AS count FROM vou_return_line_snapshots line JOIN approval_entries entry ON entry.id=line.approval_entry_id WHERE entry.entity='purchase-return' AND entry.status='APPROVED'`.execute(
    db,
  )
  return {
    layout: shape.layout,
    shape: shape.value,
    facts: await allFacts(db),
    approvedReturns: returns.rows[0]!.count,
  }
}
export async function inspectPurchaseCarryoverUpgrade(db: Executor) {
  const before = await snapshot(db)
  return {
    layout: before.layout,
    baseline: digest(before),
    publicTables:
      before.facts === null ? null : Object.keys(before.facts).length,
    approvedPurchaseReturns: before.approvedReturns,
  }
}
export async function upgradePurchaseCarryover(
  db: Kysely<DB>,
  input: {
    baseline: string
    actorId: string
    sourceReleaseSha: string
    targetReleaseSha: string
  },
) {
  return db.transaction().execute(async (tx) => {
    if ((await layout(tx)).layout !== 'LEGACY')
      throw new Error('purchase_carryover_upgrade_legacy_layout_required')
    await lockPublicTables(tx)
    const before = await snapshot(tx)
    if (before.layout !== 'LEGACY' || digest(before) !== input.baseline)
      throw new Error('purchase_carryover_upgrade_baseline_changed')
    // Existing approved refunds need a separately evidenced allocation conversion;
    // this structural slice never guesses their order from timestamps or IDs.
    if (before.approvedReturns !== '0')
      throw new Error(
        'purchase_carryover_upgrade_existing_refunds_require_review',
      )
    await requireUpgradeOperator(tx, input.actorId)
    const schema = await readFile(
      new URL('../../db/target-schema.sql', import.meta.url),
      'utf8',
    )
    for (const name of added) {
      const definition = schema.match(
        new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?\\n\\);`),
      )?.[0]
      if (!definition)
        throw new Error('purchase_carryover_upgrade_target_schema_missing')
      await sql.raw(definition).execute(tx)
    }
    await sql`ALTER TABLE vou_source_line_snapshots ADD COLUMN prior_amount_minor bigint CHECK (prior_amount_minor>=0)`.execute(
      tx,
    )
    await sql`ALTER TABLE vou_return_line_snapshots ADD COLUMN prior_amount_minor bigint CHECK (prior_amount_minor>=0),ADD COLUMN allocation_sequence bigint CHECK (allocation_sequence>0)`.execute(
      tx,
    )
    const projected = await allFacts(tx, true)
    if (digest(projected) !== digest(before.facts))
      throw new Error('purchase_carryover_upgrade_fact_mismatch')
    for (const table of added) {
      const count = await sql<{
        count: string
      }>`SELECT COUNT(*)::text AS count FROM ${sql.table(table)}`.execute(tx)
      if (count.rows[0]!.count !== '0')
        throw new Error('purchase_carryover_upgrade_new_facts_not_empty')
    }
    const after = await inspectPurchaseCarryoverUpgrade(tx)
    if (after.layout !== 'CURRENT')
      throw new Error('purchase_carryover_upgrade_layout_mismatch')
    return {
      upgraded: true,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
      baseline: input.baseline,
      afterBaseline: after.baseline,
      originalPublicTables: Object.keys(projected).length,
      originalFactsDigest: digest(projected),
      newTablesEmpty: true,
    }
  })
}

async function lockPublicTables(tx: Transaction<DB>) {
  const tables = await sql<{
    tablename: string
  }>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
    tx,
  )
  await sql`LOCK TABLE ${sql.join(tables.rows.map((row) => sql.table(row.tablename)))} IN ACCESS EXCLUSIVE MODE`.execute(
    tx,
  )
}
async function requireUpgradeOperator(tx: Transaction<DB>, actorId: string) {
  const operator =
    await sql`SELECT 1 FROM app_users u JOIN app_user_roles membership ON membership.user_id=u.id JOIN app_roles r ON r.id=membership.role_id WHERE u.id=${actorId} AND u.status='ENABLED' AND r.code='superadmin' AND r.status='ENABLED' FOR SHARE OF u,membership,r`.execute(
      tx,
    )
  if (!operator.rows.length)
    throw new Error('purchase_carryover_upgrade_operator_required')
}

const beforeClosureLayout =
  '4e542c422b1acb5cb783021c08b46b4af143945100ff220e3986ea97f25388df'
async function closureSnapshot(db: Executor) {
  const shape = (await layout(db)).value
  const hash = digest(shape)
  const state =
    hash === beforeClosureLayout
      ? 'LEGACY'
      : hash === newLayout
        ? 'CURRENT'
        : 'UNSUPPORTED'
  return {
    layout: state,
    shape,
    facts: state === 'UNSUPPORTED' ? null : await allFacts(db),
  }
}
export async function inspectPurchaseSourceClosureUpgrade(db: Executor) {
  const before = await closureSnapshot(db)
  return {
    layout: before.layout,
    baseline: digest(before),
    publicTables:
      before.facts === null ? null : Object.keys(before.facts).length,
    priorFacts: before.facts?.vou_prior_facts?.length ?? null,
  }
}
export async function upgradePurchaseSourceClosure(
  db: Kysely<DB>,
  input: Parameters<typeof upgradePurchaseCarryover>[1],
) {
  return db.transaction().execute(async (tx) => {
    if ((await closureSnapshot(tx)).layout !== 'LEGACY')
      throw new Error('purchase_carryover_upgrade_legacy_layout_required')
    await lockPublicTables(tx)
    const before = await closureSnapshot(tx)
    if (before.layout !== 'LEGACY' || digest(before) !== input.baseline)
      throw new Error('purchase_carryover_upgrade_baseline_changed')
    await requireUpgradeOperator(tx, input.actorId)
    // Existing historical records need authoritative source states, never false defaults.
    if (before.facts!.vou_prior_facts!.length !== 0)
      throw new Error(
        'purchase_carryover_upgrade_existing_prior_state_requires_review',
      )
    await sql`ALTER TABLE vou_prior_facts ADD COLUMN source_closed boolean NOT NULL`.execute(
      tx,
    )
    const after = await closureSnapshot(tx)
    if (after.layout !== 'CURRENT')
      throw new Error('purchase_carryover_upgrade_layout_mismatch')
    if (digest(before.facts) !== digest(after.facts))
      throw new Error('purchase_carryover_upgrade_fact_mismatch')
    return {
      upgraded: true,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
      baseline: input.baseline,
      afterBaseline: digest(after),
      originalPublicTables: Object.keys(before.facts!).length,
      originalFactsDigest: digest(before.facts),
      priorFactsEmpty: true,
    }
  })
}
