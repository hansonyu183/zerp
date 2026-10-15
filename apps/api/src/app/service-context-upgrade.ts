import { createHash } from 'node:crypto'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { purchaseInboundGrantLayout as roleGrantLayout } from './purchase-inbound-scope-upgrade.ts'
import {
  publicSchemaLayout,
  publicTableNames,
} from '../platform/maintenance-layout.ts'
type Executor = Kysely<DB> | Transaction<DB>
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
// Complete role-grant layouts measured from the committed nine-context source
// and current thirteen-context baseline. This changes no grant or business row.
const sourceLayout =
  '104eae9ad05b43ebbf23052507e8c9143e37781f6b3605444c4c24ed6f12ff7d'
const currentLayout =
  'a7e0ae9eded551e12a60438ae80e153c6b276976b0f6b9f770c2baeaacf11b64'
const constraint = 'app_role_permissions_service_contexts_check'
async function snapshot(db: Executor) {
  const shape = await roleGrantLayout(db),
    hash = digest(shape)
  const layout =
    hash === sourceLayout
      ? 'SOURCE'
      : hash === currentLayout
        ? 'CURRENT'
        : 'UNSUPPORTED'
  if (layout === 'UNSUPPORTED')
    return { layout, shape, facts: null, unchangedSchema: null }
  const tables = await publicTableNames(db),
    schema = await publicSchemaLayout(db, tables)
  const unchangedSchema = {
    ...schema,
    constraints: schema.constraints.filter((row) => {
      const value = row as { table_name: string; conname: string }
      return (
        value.table_name !== 'app_role_permissions' ||
        value.conname !== constraint
      )
    }),
  }
  const facts: Record<string, string[]> = {}
  for (const table of tables)
    facts[table] = (
      await sql<{
        fact: string
      }>`SELECT to_jsonb(fact)::text AS fact FROM ${sql.table(table)} fact ORDER BY to_jsonb(fact)::text`.execute(
        db,
      )
    ).rows.map((row) => row.fact)
  return { layout, shape, facts, unchangedSchema }
}
export async function inspectServiceContextUpgrade(db: Executor) {
  const current = await snapshot(db)
  return {
    layout: current.layout,
    baseline: digest(current),
    publicTables: current.facts ? Object.keys(current.facts).length : null,
    grants: current.facts?.app_role_permissions?.length ?? null,
  }
}
export async function upgradeServiceContexts(
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
      throw new Error('service_context_upgrade_source_layout_required')
    if (digest(before) !== input.baseline)
      throw new Error('service_context_upgrade_baseline_changed')
    const operator =
      await sql`SELECT 1 FROM app_users user_record JOIN app_user_roles membership ON membership.user_id=user_record.id JOIN app_roles role ON role.id=membership.role_id WHERE user_record.id=${input.actorId} AND user_record.status='ENABLED' AND role.status='ENABLED' AND role.code='superadmin'`.execute(
        tx,
      )
    if (!operator.rows.length)
      throw new Error('service_context_upgrade_operator_required')
    await sql`ALTER TABLE app_role_permissions DROP CONSTRAINT app_role_permissions_service_contexts_check, ADD CONSTRAINT app_role_permissions_service_contexts_check CHECK (service_contexts <@ ARRAY['OTHER_UNIT','SUPPLIER','SALES_PARTNER','PRIOR_AA','PRIOR_AD','CONTRACT','PRIOR_AB','PRIOR_AE','PRIOR_AH','CUSTOMER','PRIOR_BB','PRIOR_BA','CUSTOMER_CONTRACT']::text[])`.execute(
      tx,
    )
    const after = await snapshot(tx)
    if (
      after.layout !== 'CURRENT' ||
      digest(after.unchangedSchema) !== digest(before.unchangedSchema)
    )
      throw new Error('service_context_upgrade_layout_mismatch')
    if (digest(after.facts) !== digest(before.facts))
      throw new Error('service_context_upgrade_fact_mismatch')
    return {
      upgraded: true,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
      baseline: input.baseline,
      afterBaseline: digest(after),
      publicTables: Object.keys(after.facts!).length,
      originalFactsDigest: digest(before.facts),
      existingServiceContexts: 'PRESERVED',
      grants: after.facts!.app_role_permissions!.length,
    }
  })
}
