import { createHash } from 'node:crypto'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'
import { publicSchemaLayout, publicTableNames } from './maintenance-layout.ts'

type Executor = Kysely<DB> | Transaction<DB>
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
// Complete reviewed layouts, including every constraint and preserved name.
const supportedLayouts = new Map([
  [
    '2e0bd08165dc64fd3541857c7af2ce2dacd5379ca3e2d437e57071bdc02c7ba7',
    '6cbfc88982400254d25760245de2057c9914cf687f283744d54ec032e9c04675',
  ],
  [
    '15785682339f2a58b8704a48c3565caf3c1fa58be9a744a0f5d7f849793c6e9e',
    'eb39bed0e79cda23529d6952bcc8eef89743c4e5c5f482ada824bf878d316c0f',
  ],
  // Reviewed pg_dump/pg_restore layouts render varchar-array casts elementwise.
  // All columns, constraint identities and data remain bound to complete hashes.
  [
    '1cba4f26c1eebc3549b64e2746bc5700883ce67451af7121ac6f339139ef2c81',
    '9702814764073e422aa37fcbb1a60c2108f6a75a6a23e861fb274cd8b0e778c3',
  ],
  [
    'f59a7a698011806c4157245681b11889f42c7fa0f2adafc9be81c49f52ed95a1',
    '31d4b78de026505f0f82ee084111eb6e2efae90da766fba78464da1df5886a9c',
  ],
])
const expandedLayouts = new Set([
  ...supportedLayouts.values(),
  '51e064dde203f60c83c9591f87438abac34ccd04cd2061c2c6e60533ab41d8a3',
  '21dad8f0614ad17645fdc7f72aaf61a72ec66d6a68a48ebf68bd97d8ff138045',
])

const precedingThreeEntityLayouts = new Set([
  '20cbb5abae595e39cd0ad0ec39f7bdf969e78f53bed00962592c50f0be38c248',
  // Proven complete layout after pg_dump/pg_restore of the prior release.
  '1c5f1670cccde8b7b15623c4e6fe6465d97359783d7d7822ae4d26e4934948f7',
  // Proven paired recovery of that upgraded layout, including the entity check.
  '858896f5e09713a94b60a7c74814800e55040eda89b83528e40c1d6de1f9d2c1',
])

const currentLayouts = new Set([
  // Complete fresh baseline, verified in an exclusive native fixture.
  'cddbdbe80a2c327ea4b15e3b4412a3881975ca3dc4f71c5bfee5631e9834a290',
  // Complete pg_dump/pg_restore of the five-entity baseline.
  '6bdedfe2ab7cac5fe850955b8c4ac80f8a17331370939db84d960f377f0b14c9',
  // Reviewed restored three-entity and Customer layouts after this upgrade.
  '56048a396f5e542adb4eb907de8ababe7b906bdb9384edd3395f89814e99ff38',
])

async function snapshot(db: Executor) {
  const tables = await publicTableNames(db)
  const shape = await publicSchemaLayout(db, tables)
  const shapeDigest = digest(shape)
  const layout =
    supportedLayouts.has(shapeDigest) ||
    expandedLayouts.has(shapeDigest) ||
    precedingThreeEntityLayouts.has(shapeDigest)
      ? 'SOURCE'
      : currentLayouts.has(shapeDigest)
        ? 'CURRENT'
        : 'UNSUPPORTED'
  const facts: Record<string, string[]> = {}
  if (layout !== 'UNSUPPORTED') {
    for (const table of tables) {
      facts[table] = (
        await sql<{
          fact: string
        }>`SELECT to_jsonb(fact)::text AS fact FROM ${sql.table(table)} fact ORDER BY to_jsonb(fact)::text`.execute(
          db,
        )
      ).rows.map((row) => row.fact)
    }
  }
  return { layout, shapeDigest, shape, facts }
}

export async function inspectAttachmentArchiveUpgrade(db: Executor) {
  const current = await snapshot(db)
  return {
    layout: current.layout,
    shapeDigest: current.shapeDigest,
    baseline: digest(current),
    factsDigest: digest(current.facts),
    publicTables: Object.keys(current.facts).length,
  }
}

/** Called only inside a frozen, locked and exact-baseline maintenance transaction. */
export async function expandAttachmentArchiveConstraints(tx: Transaction<DB>) {
  for (const table of [
    'dcl_customer_attachment_staging',
    'dcl_customer_attachments',
    'vou_attachment_staging',
    'vou_attachments',
  ]) {
    await sql`ALTER TABLE ${sql.table(table)} DROP CONSTRAINT ${sql.id(table + '_size_bytes_check')}, ADD CONSTRAINT ${sql.id(table + '_size_bytes_check')} CHECK (size_bytes BETWEEN 0 AND 20971520)`.execute(
      tx,
    )
  }
  await sql`ALTER TABLE vou_attachment_staging DROP CONSTRAINT vou_attachment_staging_mime_type_check, ADD CONSTRAINT vou_attachment_staging_mime_type_check CHECK (mime_type IN ('application/pdf','image/jpeg','image/png','application/octet-stream'))`.execute(
    tx,
  )
}

/** Preserves permanent Customer storage identities; no unknown staging binding is invented. */
export async function generalizeArchiveAttachments(tx: Transaction<DB>) {
  const pending = await sql<{
    count: string
  }>`SELECT count(*)::text AS count FROM dcl_customer_attachment_staging`.execute(
    tx,
  )
  if (pending.rows[0]!.count !== '0')
    throw new Error('attachment_archive_upgrade_unbound_staging')
  for (const [oldName, newName] of [
    ['dcl_customer_attachment_staging', 'dcl_archive_attachment_staging'],
    ['dcl_customer_attachments', 'dcl_archive_attachments'],
  ] as const) {
    const names = await sql<{
      name: string
    }>`SELECT conname AS name FROM pg_constraint WHERE conrelid=${oldName}::regclass ORDER BY conname`.execute(
      tx,
    )
    await sql`ALTER TABLE ${sql.table(oldName)} RENAME TO ${sql.id(newName)}`.execute(
      tx,
    )
    for (const { name } of names.rows) {
      if (!name.startsWith(oldName + '_'))
        throw new Error('attachment_archive_upgrade_constraint_name_invalid')
      await sql`ALTER TABLE ${sql.table(newName)} RENAME CONSTRAINT ${sql.id(name)} TO ${sql.id(newName + name.slice(oldName.length))}`.execute(
        tx,
      )
    }
  }
  await sql`ALTER TABLE dcl_archive_attachment_staging ADD COLUMN entity varchar(16) NOT NULL CHECK (entity IN ('customer','product','supplier','other-unit','sales-partner')), ADD COLUMN subject_id varchar(26) NOT NULL`.execute(
    tx,
  )
  for (const table of [
    'dcl_product_versions',
    'dcl_supplier_versions',
    'dcl_other_unit_versions',
    'dcl_sales_partner_versions',
  ])
    await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array')`.execute(
      tx,
    )
  // The maintained release used these three reviewed names. Canonicalize the
  // structure only; immutable quantities, prices and references are unchanged.
  const renamed = await sql<{
    present: boolean
  }>`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='vou_product_line_snapshots'::regclass AND conname='vou_product_line_pricing_shape') AS present`.execute(
    tx,
  )
  if (renamed.rows[0]!.present) {
    await sql`ALTER TABLE vou_product_line_snapshots RENAME CONSTRAINT vou_product_line_snapshots_check TO vou_product_line_snapshots_check1`.execute(
      tx,
    )
    await sql`ALTER TABLE vou_product_line_snapshots RENAME CONSTRAINT vou_product_line_pricing_shape TO vou_product_line_snapshots_check`.execute(
      tx,
    )
    await sql`ALTER TABLE vou_intermediary_source_line_snapshots RENAME CONSTRAINT vou_intermediary_source_line_snapshot_unit_price_minor_not_null TO vou_intermediary_source_line_snapsho_unit_price_micros_not_null`.execute(
      tx,
    )
  }
}

/** One-time upgrade of the already generalized, exactly reviewed prior layout. */
async function completeIdentityArchiveAttachments(tx: Transaction<DB>) {
  await sql`ALTER TABLE dcl_archive_attachment_staging DROP CONSTRAINT dcl_archive_attachment_staging_entity_check, ADD CONSTRAINT dcl_archive_attachment_staging_entity_check CHECK (entity IN ('customer','product','supplier','other-unit','sales-partner'))`.execute(
    tx,
  )
  for (const table of ['dcl_other_unit_versions', 'dcl_sales_partner_versions'])
    await sql`ALTER TABLE ${sql.table(table)} ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array')`.execute(
      tx,
    )
}

async function expectedArchiveFacts(
  tx: Transaction<DB>,
  before: Awaited<ReturnType<typeof snapshot>>,
) {
  const expected: Record<string, string[]> = {}
  for (const table of Object.keys(before.facts)) {
    const targetName =
      table === 'dcl_customer_attachment_staging'
        ? 'dcl_archive_attachment_staging'
        : table === 'dcl_customer_attachments'
          ? 'dcl_archive_attachments'
          : table
    expected[targetName] =
      table === 'dcl_other_unit_versions' ||
      table === 'dcl_sales_partner_versions' ||
      (!precedingThreeEntityLayouts.has(before.shapeDigest) &&
        (table === 'dcl_product_versions' || table === 'dcl_supplier_versions'))
        ? (
            await sql<{
              fact: string
            }>`SELECT (to_jsonb(fact) || '{"attachments":[]}'::jsonb)::text AS fact FROM ${sql.table(table)} fact ORDER BY (to_jsonb(fact) || '{"attachments":[]}'::jsonb)::text`.execute(
              tx,
            )
          ).rows.map((row) => row.fact)
        : before.facts[table]!
  }
  return Object.fromEntries(
    Object.entries(expected).sort(([a], [b]) => a.localeCompare(b)),
  )
}

export async function upgradeAttachmentArchive(
  db: Kysely<DB>,
  input: {
    baseline: string
    actorId: string
    sourceReleaseSha: string
    targetReleaseSha: string
    writersFrozen: boolean
  },
) {
  if (input.writersFrozen !== true)
    throw new Error('attachment_archive_upgrade_writers_must_be_frozen')
  if (
    !/^[a-f0-9]{40}$/.test(input.sourceReleaseSha) ||
    !/^[a-f0-9]{40}$/.test(input.targetReleaseSha)
  )
    throw new Error('attachment_archive_upgrade_release_invalid')
  return db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(74155001)`.execute(tx)
    await sql`LOCK TABLE ${sql.join((await publicTableNames(tx)).map((table) => sql.table(table)))} IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const before = await snapshot(tx)
    if (before.layout !== 'SOURCE')
      throw new Error('attachment_archive_upgrade_source_layout_required')
    if (digest(before) !== input.baseline)
      throw new Error('attachment_archive_upgrade_baseline_changed')
    const operator =
      await sql`SELECT 1 FROM app_users user_record JOIN app_user_roles membership ON membership.user_id=user_record.id JOIN app_roles role ON role.id=membership.role_id WHERE user_record.id=${input.actorId} AND user_record.status='ENABLED' AND role.status='ENABLED' AND role.code='superadmin'`.execute(
        tx,
      )
    if (!operator.rows.length)
      throw new Error('attachment_archive_upgrade_operator_required')
    const expectedFacts = await expectedArchiveFacts(tx, before)
    if (supportedLayouts.has(before.shapeDigest))
      await expandAttachmentArchiveConstraints(tx)
    if (precedingThreeEntityLayouts.has(before.shapeDigest))
      await completeIdentityArchiveAttachments(tx)
    else await generalizeArchiveAttachments(tx)
    const after = await snapshot(tx)
    if (after.layout !== 'CURRENT')
      throw new Error('attachment_archive_upgrade_layout_mismatch')
    if (digest(after.facts) !== digest(expectedFacts))
      throw new Error('attachment_archive_upgrade_fact_mismatch')
    return {
      upgraded: true,
      baseline: input.baseline,
      afterBaseline: digest(after),
      originalFactsDigest: digest(before.facts),
      expectedFactsDigest: digest(expectedFacts),
      afterFactsDigest: digest(after.facts),
      originalPublicTables: Object.keys(before.facts).length,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
    }
  })
}
