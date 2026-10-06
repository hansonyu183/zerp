import { createHash } from 'node:crypto'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'

type Executor = Kysely<DB> | Transaction<DB>
const productTable = 'vou_product_line_snapshots'
const sourceTable = 'vou_intermediary_source_line_snapshots'
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

type Column = {
  table_name: string
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
  identity_generation: string
  generated: string
}
// Frozen layouts of these two tables at 52e495d0; names, physical types,
// nullability, defaults and generation are all part of the supported conversion.
const currentColumnDigest =
  '348bb827810aaf4b21f3a49b8ec1882b9020d7243e72c8fadebc96bfe3d93290'
const legacyColumnDigest =
  'ee0607e1da1e42f39db917d81e9e2a7dd68b6025877beefedb92c68d83094b52'
type Constraint = {
  table_name: string
  conname: string
  contype: string
  convalidated: boolean
  definition: string
}
const pricingCheck =
  'CHECK ((((agreed_amount_minor IS NULL) AND (unit_price_minor IS NOT NULL) AND (quoted_unit_price_micros IS NULL)) OR ((agreed_amount_minor IS NOT NULL) AND (unit_price_minor IS NULL) AND (quoted_unit_price_micros IS NOT NULL))))'
const compact = (value: string) => value.replace(/\s+/g, '')
function layout(
  columns: readonly Column[],
  constraints: readonly Constraint[],
) {
  const priceChecks = constraints.filter(
    (c) =>
      c.contype === 'c' &&
      /(?:unit_price_minor|quoted_unit_price_micros|agreed_amount_minor|unit_price_micros)/.test(
        c.definition,
      ),
  )
  const has = (table: string, column: string, nullable: string) =>
    columns.some(
      (c) =>
        c.table_name === table &&
        c.column_name === column &&
        c.data_type === 'bigint' &&
        c.is_nullable === nullable,
    )
  const absent = (table: string, column: string) =>
    !columns.some((c) => c.table_name === table && c.column_name === column)
  if (
    has(productTable, 'unit_price_minor', 'NO') &&
    absent(productTable, 'quoted_unit_price_micros') &&
    absent(productTable, 'agreed_amount_minor') &&
    has(sourceTable, 'unit_price_minor', 'NO') &&
    absent(sourceTable, 'unit_price_micros') &&
    priceChecks.length === 0 &&
    !constraints.some((c) => c.conname === 'vou_product_line_pricing_shape') &&
    hash(columns) === legacyColumnDigest
  )
    return 'LEGACY' as const
  if (
    has(productTable, 'unit_price_minor', 'YES') &&
    has(productTable, 'quoted_unit_price_micros', 'YES') &&
    has(productTable, 'agreed_amount_minor', 'YES') &&
    has(sourceTable, 'unit_price_micros', 'NO') &&
    absent(sourceTable, 'unit_price_minor') &&
    priceChecks.length === 1 &&
    priceChecks[0]!.table_name === productTable &&
    priceChecks[0]!.convalidated &&
    compact(priceChecks[0]!.definition) === compact(pricingCheck) &&
    hash(columns) === currentColumnDigest
  )
    return 'CURRENT' as const
  return 'UNSUPPORTED' as const
}

async function rows(
  db: Executor,
  table: string,
  projection = sql`to_jsonb(fact)`,
) {
  const result = await sql<{
    fact: string
  }>`SELECT (${projection})::text AS fact FROM ${sql.table(table)} fact ORDER BY approval_entry_id,line_no`.execute(
    db,
  )
  // Keep PostgreSQL JSON as text: bigint and exact decimals never pass through JS numbers.
  return result.rows.map((row) => row.fact)
}

async function snapshot(db: Executor) {
  const columns =
    await sql<Column>`SELECT cls.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,pg_get_expr(d.adbin,d.adrelid) AS column_default,
    a.attidentity::text AS identity_generation,a.attgenerated::text AS generated
    FROM pg_attribute a JOIN pg_class cls ON cls.oid=a.attrelid JOIN pg_namespace ns ON ns.oid=cls.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE ns.nspname='public' AND cls.relname IN (${productTable},${sourceTable}) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY table_name,column_name`.execute(db)
  const constraints =
    await sql<Constraint>`SELECT cls.relname AS table_name,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class cls ON cls.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cls.relnamespace
    WHERE ns.nspname='public' AND cls.relname IN (${productTable},${sourceTable}) ORDER BY cls.relname,c.conname`.execute(
      db,
    )
  const indexes =
    await sql`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN (${productTable},${sourceTable}) ORDER BY tablename,indexname`.execute(
      db,
    )
  const state = layout(columns.rows, constraints.rows)
  const installation = await sql<{
    id: string
  }>`SELECT id::text FROM app_installation ORDER BY id`.execute(db)
  const product = state === 'UNSUPPORTED' ? [] : await rows(db, productTable)
  const source = state === 'UNSUPPORTED' ? [] : await rows(db, sourceTable)
  return {
    layout: state,
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    installation: installation.rows,
    product,
    source,
  }
}

/** Read-only source fingerprint for an explicitly frozen, backed-up one-time upgrade. */
export async function inspectOrderAmountUpgrade(db: Executor) {
  const facts = await snapshot(db)
  return {
    layout: facts.layout,
    baseline: hash(facts),
    productLines: facts.layout === 'UNSUPPORTED' ? null : facts.product.length,
    intermediaryLines:
      facts.layout === 'UNSUPPORTED' ? null : facts.source.length,
  }
}

/** Representation conversion only. No VOU approval, stock movement or ACC posting is replayed. */
export async function upgradeOrderAmounts(
  db: Kysely<DB>,
  input: {
    baseline: string
    actorId: string
    sourceReleaseSha: string
    targetReleaseSha: string
  },
) {
  return db.transaction().execute(async (tx) => {
    if ((await inspectOrderAmountUpgrade(tx)).layout !== 'LEGACY')
      throw new Error('order_amount_upgrade_legacy_layout_required')
    await sql`LOCK TABLE vou_product_line_snapshots,vou_intermediary_source_line_snapshots IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const before = await snapshot(tx)
    if (before.layout !== 'LEGACY' || hash(before) !== input.baseline)
      throw new Error('order_amount_upgrade_baseline_changed')
    const operator =
      await sql`SELECT 1 FROM app_users u JOIN app_user_roles membership ON membership.user_id=u.id
      JOIN app_roles r ON r.id=membership.role_id WHERE u.id=${input.actorId} AND u.status='ENABLED' AND r.code='superadmin' AND r.status='ENABLED' FOR SHARE OF u,membership,r`.execute(
        tx,
      )
    if (!operator.rows.length)
      throw new Error('order_amount_upgrade_operator_required')
    const overflow =
      await sql`SELECT 1 FROM vou_intermediary_source_line_snapshots
      WHERE unit_price_minor::numeric * 10000 NOT BETWEEN -9223372036854775808 AND 9223372036854775807 LIMIT 1`.execute(
        tx,
      )
    if (overflow.rows.length)
      throw new Error('order_amount_upgrade_quote_overflow')
    await sql`ALTER TABLE vou_product_line_snapshots
      ALTER COLUMN unit_price_minor DROP NOT NULL,
      ADD COLUMN quoted_unit_price_micros bigint,
      ADD COLUMN agreed_amount_minor bigint,
      ADD CONSTRAINT vou_product_line_pricing_shape CHECK (
        (agreed_amount_minor IS NULL AND unit_price_minor IS NOT NULL AND quoted_unit_price_micros IS NULL)
        OR (agreed_amount_minor IS NOT NULL AND unit_price_minor IS NULL AND quoted_unit_price_micros IS NOT NULL))`.execute(
      tx,
    )
    await sql`ALTER TABLE vou_intermediary_source_line_snapshots RENAME COLUMN unit_price_minor TO unit_price_micros`.execute(
      tx,
    )
    await sql`UPDATE vou_intermediary_source_line_snapshots SET unit_price_micros=unit_price_micros * 10000`.execute(
      tx,
    )
    const product = await rows(
      tx,
      productTable,
      sql`to_jsonb(fact) - 'quoted_unit_price_micros' - 'agreed_amount_minor'`,
    )
    const source = await rows(
      tx,
      sourceTable,
      sql`jsonb_set(to_jsonb(fact) - 'unit_price_micros', '{unit_price_minor}', to_jsonb(fact.unit_price_micros / 10000))`,
    )
    if (
      hash(product) !== hash(before.product) ||
      hash(source) !== hash(before.source)
    )
      throw new Error('order_amount_upgrade_fact_mismatch')
    const after = await inspectOrderAmountUpgrade(tx)
    if (after.layout !== 'CURRENT')
      throw new Error('order_amount_upgrade_layout_mismatch')
    return {
      upgraded: true,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
      baseline: input.baseline,
      afterBaseline: after.baseline,
      productLines: product.length,
      intermediaryLines: source.length,
      originalProductFactsDigest: hash(product),
      originalIntermediaryFactsDigest: hash(source),
    }
  })
}
