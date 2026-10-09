import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
type Executor = Kysely<DB> | Transaction<DB>
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
// The supported procurement maintenance path preserved three existing
// constraint names. Both full layouts are sealed; no constraint is ignored.
const supportedLayouts = new Map([
  [
    '467cfa0863c6161627208616ecbd4f05e6949840c9c3e5a5e5e0897ef252f04b',
    '2e0bd08165dc64fd3541857c7af2ce2dacd5379ca3e2d437e57071bdc02c7ba7',
  ],
  [
    '3867e2ae6c17b3795b352076a71779c812a3e4bd4d062545dd65083c3f0ac5cf',
    '15785682339f2a58b8704a48c3565caf3c1fa58be9a744a0f5d7f849793c6e9e',
  ],
  [
    '1c51b752ff13d2e23031c904f8079f9aed126000ae6cb5dc4d270372e2091ee0',
    '2e0bd08165dc64fd3541857c7af2ce2dacd5379ca3e2d437e57071bdc02c7ba7',
  ],
  [
    '5dddf7dcceaca78608ba2b84c2fe27c923fda8b9d28e0392f9ed650f8cb7b05c',
    '15785682339f2a58b8704a48c3565caf3c1fa58be9a744a0f5d7f849793c6e9e',
  ],
])
const added = ['vou_service_line_snapshots', 'vou_prior_service_line_origins']
async function layout(db: Executor, tables: readonly string[]) {
  const columns =
    await sql`SELECT cls.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,
    CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,pg_get_expr(d.adbin,d.adrelid) AS column_default,
    a.attidentity::text AS identity_generation,a.attgenerated::text AS generated
    FROM pg_attribute a JOIN pg_class cls ON cls.oid=a.attrelid JOIN pg_namespace ns ON ns.oid=cls.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE ns.nspname='public' AND cls.relname IN (${sql.join(tables)}) AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY table_name,column_name`.execute(db)
  const constraints =
    await sql`SELECT cls.relname AS table_name,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class cls ON cls.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=cls.relnamespace
    WHERE ns.nspname='public' AND cls.relname IN (${sql.join(tables)}) ORDER BY cls.relname,c.conname`.execute(
      db,
    )
  const indexes =
    await sql`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN (${sql.join(tables)}) ORDER BY tablename,indexname`.execute(
      db,
    )
  const value = {
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
  }
  return value
}

async function publicTables(db: Executor) {
  return (
    await sql<{
      tablename: string
    }>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`.execute(
      db,
    )
  ).rows.map((row) => row.tablename)
}
async function facts(db: Executor, projectOriginal = false) {
  const result: Record<string, string[]> = {}
  for (const table of await publicTables(db)) {
    if (projectOriginal && added.includes(table)) continue
    const projection =
      projectOriginal && table === 'app_role_permissions'
        ? sql`to_jsonb(fact)-'service_contexts'`
        : projectOriginal && table === 'vou_prior_facts'
          ? sql`to_jsonb(fact)-'source_component'`
          : projectOriginal && table === 'vou_service_contract_details'
            ? sql`to_jsonb(fact)-'requires_prepayment'`
            : sql`to_jsonb(fact)`
    result[table] = (
      await sql<{
        fact: string
      }>`SELECT (${projection})::text AS fact FROM ${sql.table(table)} fact ORDER BY (${projection})::text`.execute(
        db,
      )
    ).rows.map((row) => row.fact)
  }
  return result
}
async function snapshot(db: Executor) {
  const tables = await publicTables(db),
    shape = await layout(db, tables),
    hash = digest(shape),
    source = supportedLayouts.has(hash),
    current = [...supportedLayouts.values()].includes(hash)
  return {
    shapeDigest: hash,
    layout: source ? 'SOURCE' : current ? 'CURRENT' : 'UNSUPPORTED',
    shape,
    facts: source || current ? await facts(db) : null,
  }
}
export async function inspectServiceCarryoverUpgrade(db: Executor) {
  const current = await snapshot(db)
  return {
    layout: current.layout,
    baseline: digest(current),
    publicTables: current.facts ? Object.keys(current.facts).length : null,
    priorFacts: current.facts?.vou_prior_facts?.length ?? null,
    grants: current.facts?.app_role_permissions?.length ?? null,
  }
}
export async function upgradeServiceCarryover(
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
    await sql`LOCK TABLE ${sql.join((await publicTables(tx)).map((table) => sql.table(table)))} IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const before = await snapshot(tx)
    if (before.layout !== 'SOURCE')
      throw new Error('service_carryover_upgrade_source_layout_required')
    if (digest(before) !== input.baseline)
      throw new Error('service_carryover_upgrade_baseline_changed')
    const operator =
      await sql`SELECT 1 FROM app_users user_record JOIN app_user_roles membership ON membership.user_id=user_record.id JOIN app_roles role ON role.id=membership.role_id WHERE user_record.id=${input.actorId} AND user_record.status='ENABLED' AND role.status='ENABLED' AND role.code='superadmin'`.execute(
        tx,
      )
    if (!operator.rows.length)
      throw new Error('service_carryover_upgrade_operator_required')
    const legacy = Object.keys(before.facts!).length === 147
    const unknown =
      await sql`SELECT 1 FROM vou_prior_facts prior JOIN approval_entries entry ON entry.id=prior.approval_entry_id WHERE entry.domain <> 'vou' OR ${legacy ? sql`entry.entity NOT IN ('purchase-order','purchase-inbound','purchase-return')` : sql`(prior.source_component='PROCUREMENT' AND entry.entity NOT IN ('purchase-order','purchase-inbound','purchase-return')) OR (prior.source_component='SERVICE' AND entry.entity NOT IN ('service-contract','service-acceptance'))`} LIMIT 1`.execute(
        tx,
      )
    if (unknown.rows.length)
      throw new Error('service_carryover_upgrade_unknown_prior_component')
    if (legacy) {
      await sql`ALTER TABLE app_role_permissions ADD COLUMN service_contexts text[]`.execute(
        tx,
      )
      await sql`UPDATE app_role_permissions grant_record SET service_contexts=CASE WHEN permission.domain='vou' AND permission.entity='service-contract' OR permission.path='/wfl/process-instance/create-service-contract' THEN ARRAY['OTHER_UNIT','SALES_PARTNER']::text[] WHEN permission.domain='vou' AND permission.entity='service-acceptance' OR permission.path='/wfl/process-instance/create-service-acceptance' THEN ARRAY['CONTRACT']::text[] ELSE ARRAY[]::text[] END FROM app_permissions permission WHERE permission.id=grant_record.permission_id`.execute(
        tx,
      )
      await sql`ALTER TABLE app_role_permissions ALTER COLUMN service_contexts SET NOT NULL, ADD CONSTRAINT app_role_permissions_service_contexts_check CHECK (service_contexts <@ ARRAY['OTHER_UNIT','SUPPLIER','SALES_PARTNER','PRIOR_AA','PRIOR_AD','CONTRACT','PRIOR_AB','PRIOR_AE','PRIOR_AH']::text[])`.execute(
        tx,
      )
      await sql`ALTER TABLE vou_prior_facts ADD COLUMN source_component varchar(16)`.execute(
        tx,
      )
      await sql`UPDATE vou_prior_facts SET source_component='PROCUREMENT'`.execute(
        tx,
      )
      const unique = (
        await sql<{
          conname: string
        }>`SELECT conname FROM pg_constraint WHERE conrelid='public.vou_prior_facts'::regclass AND contype='u'`.execute(
          tx,
        )
      ).rows
      if (unique.length !== 1)
        throw new Error('service_carryover_upgrade_source_layout_required')
      await sql`ALTER TABLE vou_prior_facts DROP CONSTRAINT ${sql.id(unique[0]!.conname)}, ALTER COLUMN source_component SET NOT NULL, ADD CONSTRAINT vou_prior_facts_source_component_check CHECK (source_component IN ('PROCUREMENT','SERVICE')), ADD UNIQUE(source_instance_id,source_schema,source_document_type,source_document_key,source_component), DROP CONSTRAINT vou_prior_facts_source_document_type_check, ADD CONSTRAINT vou_prior_facts_source_document_type_check CHECK (source_document_type IN ('AA','AD','AB','AE','AF','AH'))`.execute(
        tx,
      )
      await sql`ALTER TABLE vou_service_contract_details ADD COLUMN requires_prepayment boolean`.execute(
        tx,
      )
      const schema = await readFile(
        new URL('../../db/target-schema.sql', import.meta.url),
        'utf8',
      )
      for (const table of added) {
        const ddl = schema.match(
          new RegExp(String.raw`CREATE TABLE ${table} \([\s\S]*?\n\);`),
        )?.[0]
        if (!ddl)
          throw new Error('service_carryover_upgrade_target_schema_missing')
        await sql.raw(ddl).execute(tx)
      }
    } else {
      await sql`ALTER TABLE app_role_permissions DROP CONSTRAINT app_role_permissions_service_contexts_check, ADD CONSTRAINT app_role_permissions_service_contexts_check CHECK (service_contexts <@ ARRAY['OTHER_UNIT','SUPPLIER','SALES_PARTNER','PRIOR_AA','PRIOR_AD','CONTRACT','PRIOR_AB','PRIOR_AE','PRIOR_AH']::text[])`.execute(
        tx,
      )
    }
    const after = await snapshot(tx)
    if (
      after.layout !== 'CURRENT' ||
      after.shapeDigest !== supportedLayouts.get(before.shapeDigest)
    )
      throw new Error('service_carryover_upgrade_layout_mismatch')
    const original = await facts(tx, legacy)
    if (digest(original) !== digest(before.facts))
      throw new Error('service_carryover_upgrade_fact_mismatch')
    if (legacy)
      for (const table of added)
        if (after.facts![table]?.length !== 0)
          throw new Error('service_carryover_upgrade_new_facts_not_empty')
    const badContexts = legacy
      ? await sql`SELECT 1 FROM app_role_permissions grant_record JOIN app_permissions permission ON permission.id=grant_record.permission_id WHERE grant_record.service_contexts IS DISTINCT FROM CASE WHEN permission.domain='vou' AND permission.entity='service-contract' OR permission.path='/wfl/process-instance/create-service-contract' THEN ARRAY['OTHER_UNIT','SALES_PARTNER']::text[] WHEN permission.domain='vou' AND permission.entity='service-acceptance' OR permission.path='/wfl/process-instance/create-service-acceptance' THEN ARRAY['CONTRACT']::text[] ELSE ARRAY[]::text[] END LIMIT 1`.execute(
          tx,
        )
      : undefined
    if (badContexts?.rows.length)
      throw new Error('service_carryover_upgrade_grant_mismatch')
    return {
      upgraded: true,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
      baseline: input.baseline,
      afterBaseline: digest(after),
      originalPublicTables: Object.keys(original).length,
      originalFactsDigest: digest(original),
      originalPriorFactsPreserved: original.vou_prior_facts!.length,
      originalGrantsPreserved: original.app_role_permissions!.length,
      newTablesEmpty: legacy ? true : undefined,
      existingServiceContexts: legacy ? 'ORDINARY_ONLY' : 'PRESERVED',
    }
  })
}
