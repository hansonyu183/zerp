import { createHash } from 'node:crypto'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'

type Executor = Kysely<DB> | Transaction<DB>
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const legacyLayout =
  '9bdc94d844cb6f2609312d7f05c72b8705874f7f88bccaaff0fc106881db9b4a'
const serviceLegacyLayout =
  '492838bd111251c1ec17233423946937d7246c0197b7bf9848fd96219c2897ac'
const serviceCurrentLayout =
  '6f5f39958d8c5bb9a3a2e278c3f29634e2856a1bc1f2adf0c823fe8e12b946c6'
const currentLayout =
  'ad84ceb9b0db0324efd4ba1c1eb37497ecc241d2b8d1381740e35f086df3fe7a'

export async function purchaseInboundGrantLayout(db: Executor) {
  const columns =
    await sql`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS required, pg_get_expr(d.adbin,d.adrelid) AS default,
    a.attidentity::text AS identity, a.attgenerated::text AS generated
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname='app_role_permissions' AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname`.execute(
      db,
    )
  const constraints =
    await sql`SELECT conname AS name,contype AS type,convalidated AS validated,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE conrelid='public.app_role_permissions'::regclass ORDER BY conname`.execute(
      db,
    )
  const indexes =
    await sql`SELECT indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='public' AND tablename='app_role_permissions' ORDER BY indexname`.execute(
      db,
    )
  return {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  }
}
async function facts(db: Executor, projectScope = false) {
  const tables = await sql<{
    tablename: string
  }>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
    db,
  )
  const result: Record<string, string[]> = {}
  for (const { tablename } of tables.rows) {
    const projection =
      projectScope && tablename === 'app_role_permissions'
        ? sql`to_jsonb(fact)-'purchase_inbound_scope'`
        : sql`to_jsonb(fact)`
    const rows = await sql<{
      fact: string
    }>`SELECT (${projection})::text AS fact FROM ${sql.table(tablename)} fact ORDER BY (${projection})::text`.execute(
      db,
    )
    result[tablename] = rows.rows.map((row) => row.fact)
  }
  return result
}
async function snapshot(db: Executor) {
  const shape = await purchaseInboundGrantLayout(db),
    hash = digest(shape)
  const layout =
    hash === legacyLayout || hash === serviceLegacyLayout
      ? 'LEGACY'
      : hash === currentLayout || hash === serviceCurrentLayout
        ? 'CURRENT'
        : 'UNSUPPORTED'
  return {
    layout,
    shape,
    facts: layout === 'UNSUPPORTED' ? null : await facts(db),
  }
}
export async function inspectPurchaseInboundScopeUpgrade(db: Executor) {
  const value = await snapshot(db)
  return {
    layout: value.layout,
    baseline: digest(value),
    publicTables: value.facts && Object.keys(value.facts).length,
    grants: value.facts?.app_role_permissions?.length ?? null,
  }
}
export async function upgradePurchaseInboundScopes(
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
    const tables = await sql<{
      tablename: string
    }>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
      tx,
    )
    await sql`LOCK TABLE ${sql.join(tables.rows.map((row) => sql.table(row.tablename)))} IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const before = await snapshot(tx)
    if (before.layout !== 'LEGACY')
      throw new Error('purchase_inbound_scope_upgrade_legacy_layout_required')
    if (digest(before) !== input.baseline)
      throw new Error('purchase_inbound_scope_upgrade_baseline_changed')
    const operator =
      await sql`SELECT 1 FROM app_users u JOIN app_user_roles ur ON ur.user_id=u.id JOIN app_roles r ON r.id=ur.role_id
      WHERE u.id=${input.actorId} AND u.status='ENABLED' AND r.code='superadmin' AND r.status='ENABLED'`.execute(
        tx,
      )
    if (!operator.rows.length)
      throw new Error('purchase_inbound_scope_upgrade_operator_required')
    // Explicit one-time conservation of existing grants. The current runtime has no default.
    await sql`ALTER TABLE app_role_permissions ADD COLUMN purchase_inbound_scope text`.execute(
      tx,
    )
    await sql`UPDATE app_role_permissions SET purchase_inbound_scope='ALL'`.execute(
      tx,
    )
    await sql`ALTER TABLE app_role_permissions ALTER COLUMN purchase_inbound_scope SET NOT NULL,
      ADD CONSTRAINT app_role_permissions_purchase_inbound_scope_check CHECK (purchase_inbound_scope IN ('ORDER_REFERENCE','INDEPENDENT_PRIOR','ALL'))`.execute(
      tx,
    )
    const after = await snapshot(tx)
    if (after.layout !== 'CURRENT')
      throw new Error('purchase_inbound_scope_upgrade_layout_mismatch')
    const original = await facts(tx, true)
    if (digest(before.facts) !== digest(original))
      throw new Error('purchase_inbound_scope_upgrade_fact_mismatch')
    return {
      upgraded: true,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
      baseline: input.baseline,
      afterBaseline: digest(after),
      originalPublicTables: Object.keys(original).length,
      originalFactsDigest: digest(original),
      originalGrantsPreserved: original.app_role_permissions!.length,
      existingGrantScope: 'ALL',
    }
  })
}
