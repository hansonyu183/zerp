import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { sql, type Kysely, type Transaction } from 'kysely'
import type { DB } from '../src/db/generated.ts'
import { z } from 'zod'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import { upgradeDictionaryPurposes } from '../src/aux/dictionary-purpose-upgrade.ts'

// One-shot upgrade for the verified empty customer/calculation baseline.
// Existing customers or scripts need a reviewed conversion, never guessed defaults.
const { values } = parseArgs({
  options: {
    apply: { type: 'boolean' },
    baseline: { type: 'string' },
    backup: { type: 'string' },
    'writers-frozen': { type: 'boolean' },
  },
})
const url = process.env.TARGET_DATABASE_URL
if (!url) throw new Error('TARGET_DATABASE_URL required')
assertTargetDatabaseBoundary(url, process.env.TARGET_DATABASE_SCOPE)
const db = createDatabase(url)
try {
  const inspect = async (tx: Kysely<DB> | Transaction<DB>) => {
    const rows = await sql<{
      customers: string
      calculations: string
      scripts: string
    }>`
      SELECT (SELECT count(*)::text FROM dcl_customer_versions) AS customers,
      (SELECT count(*)::text FROM vou_intermediary_calculation_details) AS calculations,
      (SELECT count(*)::text FROM vou_intermediary_scripts) AS scripts`.execute(
      tx,
    )
    const layout =
      await sql`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('dcl_customer_versions','vou_intermediary_source_line_snapshots') ORDER BY table_name,ordinal_position`.execute(
        tx,
      )
    const dictionaries =
      await sql`SELECT id,revision,data FROM aux_objects WHERE entity='dictionary-type' ORDER BY id`.execute(
        tx,
      )
    const facts = {
      counts: rows.rows[0],
      layout: layout.rows,
      dictionaries: dictionaries.rows,
    }
    return {
      counts: facts.counts,
      baseline: createHash('sha256')
        .update(JSON.stringify(facts))
        .digest('hex'),
    }
  }
  if (!values.apply) console.log(JSON.stringify(await inspect(db)))
  else {
    if (!values.baseline || !values.backup || !values['writers-frozen'])
      throw new Error('baseline, backup and frozen writers required')
    const file = z
      .object({
        path: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
    const backup = z
      .object({
        sourceReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
        targetReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
        database: file,
        attachments: file,
      })
      .strict()
      .parse(JSON.parse(await readFile(values.backup, 'utf8')))
    if (process.env.ZERP_RELEASE_SHA !== backup.targetReleaseSha)
      throw new Error('target release mismatch')
    for (const f of [backup.database, backup.attachments]) {
      const hash = createHash('sha256')
      for await (const part of createReadStream(f.path)) hash.update(part)
      if (hash.digest('hex') !== f.sha256)
        throw new Error('backup digest mismatch')
    }
    const before = JSON.parse(await readFile(values.baseline, 'utf8'))
    const report = await db.transaction().execute(async (tx) => {
      await sql`LOCK TABLE dcl_customer_versions,vou_intermediary_calculation_details,vou_intermediary_source_line_snapshots,vou_intermediary_scripts,aux_objects IN ACCESS EXCLUSIVE MODE`.execute(
        tx,
      )
      const current = await inspect(tx)
      if (current.baseline !== before.baseline)
        throw new Error('baseline changed')
      if (Object.values(current.counts!).some((v) => v !== '0'))
        throw new Error(
          'existing customer or calculation requires explicit conversion',
        )
      await sql`ALTER TABLE dcl_customer_versions DROP COLUMN customer_type_id, DROP COLUMN customer_type_snapshot,
        ADD COLUMN logistics_settlement_group jsonb CHECK(jsonb_typeof(logistics_settlement_group)='object'),
        ADD COLUMN default_special_approval boolean NOT NULL,
        ADD COLUMN default_outbound_warehouse jsonb CHECK(jsonb_typeof(default_outbound_warehouse)='object'),
        ADD COLUMN monthly_closing_day integer`.execute(tx)
      await sql`ALTER TABLE vou_intermediary_source_line_snapshots DROP COLUMN customer_type_code`.execute(
        tx,
      )
      await upgradeDictionaryPurposes(tx)
      return {
        upgraded: true,
        sourceReleaseSha: backup.sourceReleaseSha,
        targetReleaseSha: backup.targetReleaseSha,
      }
    })
    console.log(JSON.stringify(report))
  }
} finally {
  await db.destroy()
}
