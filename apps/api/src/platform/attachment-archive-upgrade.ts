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
const currentLayouts = new Set([
  ...supportedLayouts.values(),
  '51e064dde203f60c83c9591f87438abac34ccd04cd2061c2c6e60533ab41d8a3',
  '21dad8f0614ad17645fdc7f72aaf61a72ec66d6a68a48ebf68bd97d8ff138045',
])

async function snapshot(db: Executor) {
  const tables = await publicTableNames(db)
  const shape = await publicSchemaLayout(db, tables)
  const shapeDigest = digest(shape)
  const layout = supportedLayouts.has(shapeDigest)
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
    await expandAttachmentArchiveConstraints(tx)
    const after = await snapshot(tx)
    if (
      after.layout !== 'CURRENT' ||
      after.shapeDigest !== supportedLayouts.get(before.shapeDigest)
    )
      throw new Error('attachment_archive_upgrade_layout_mismatch')
    if (digest(after.facts) !== digest(before.facts))
      throw new Error('attachment_archive_upgrade_fact_mismatch')
    return {
      upgraded: true,
      baseline: input.baseline,
      afterBaseline: digest(after),
      originalFactsDigest: digest(before.facts),
      originalPublicTables: Object.keys(before.facts).length,
      sourceReleaseSha: input.sourceReleaseSha,
      targetReleaseSha: input.targetReleaseSha,
    }
  })
}
