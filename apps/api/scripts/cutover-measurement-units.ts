import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import {
  inspectUnitCutover,
  migrateMeasurementUnits,
  UnitCutoverError,
} from '../src/aux/unit-cutover.ts'

async function main() {
  const { values } = parseArgs({
    options: {
      units: { type: 'string' },
      apply: { type: 'boolean' },
      baseline: { type: 'string' },
      backup: { type: 'string' },
      'actor-id': { type: 'string' },
      'writers-frozen': { type: 'boolean' },
    },
  })
  const url = process.env.TARGET_DATABASE_URL
  if (!url) throw new Error('TARGET_DATABASE_URL is required')
  assertTargetDatabaseBoundary(url, process.env.TARGET_DATABASE_SCOPE)
  const decisions = values.units
    ? z
        .array(
          z
            .object({
              id: z.string().length(26),
              fixedFactor: z.string().nullable(),
            })
            .strict(),
        )
        .parse(JSON.parse(await readFile(values.units, 'utf8')))
    : []
  const db = createDatabase(url)
  try {
    if (!values.apply) {
      console.log(
        JSON.stringify(
          await db
            .transaction()
            .setIsolationLevel('repeatable read')
            .execute((tx) => inspectUnitCutover(tx, decisions)),
          null,
          2,
        ),
      )
      return
    }
    if (
      !values.units ||
      !values.baseline ||
      !values.backup ||
      !values['actor-id'] ||
      !values['writers-frozen']
    )
      throw new Error(
        'apply requires reviewed units, baseline, backup, actor-id and writers-frozen',
      )
    const file = z
      .object({
        path: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
    const manifest = z
      .object({
        sourceReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
        targetReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
        database: file,
        attachments: file,
      })
      .strict()
      .parse(JSON.parse(await readFile(values.backup, 'utf8')))
    if (process.env.ZERP_RELEASE_SHA !== manifest.targetReleaseSha)
      throw new Error('unit_cutover_release_mismatch')
    for (const backup of [manifest.database, manifest.attachments]) {
      const hash = createHash('sha256')
      for await (const part of createReadStream(backup.path)) hash.update(part)
      if (hash.digest('hex') !== backup.sha256)
        throw new Error('unit_cutover_backup_digest_mismatch')
    }
    const baseline = z
      .object({ baseline: z.string().regex(/^[a-f0-9]{64}$/) })
      .passthrough()
      .parse(JSON.parse(await readFile(values.baseline, 'utf8')))
    console.log(
      JSON.stringify(
        await migrateMeasurementUnits(db, {
          baseline: baseline.baseline,
          decisions,
          actorId: values['actor-id'],
          sourceReleaseSha: manifest.sourceReleaseSha,
          targetReleaseSha: manifest.targetReleaseSha,
        }),
        null,
        2,
      ),
    )
  } finally {
    await db.destroy()
  }
}
try {
  await main()
} catch (error) {
  process.stderr.write(
    JSON.stringify(
      error instanceof UnitCutoverError
        ? { error: error.reason, blockers: error.blockers }
        : { error: 'unit_cutover_failed' },
    ) + '\n',
  )
  process.exitCode = 1
}
