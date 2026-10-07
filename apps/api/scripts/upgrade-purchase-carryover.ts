import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import {
  inspectPurchaseCarryoverUpgrade,
  upgradePurchaseCarryover,
} from '../src/vou/purchase-carryover-upgrade.ts'

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean' },
      baseline: { type: 'string' },
      backup: { type: 'string' },
      'actor-id': { type: 'string' },
      'writers-frozen': { type: 'boolean' },
    },
  })
  const url = process.env.TARGET_DATABASE_URL
  if (!url) throw new Error('purchase_carryover_upgrade_database_required')
  assertTargetDatabaseBoundary(url, process.env.TARGET_DATABASE_SCOPE)
  const db = createDatabase(url)
  try {
    if (!values.apply)
      console.log(
        JSON.stringify(
          await db
            .transaction()
            .setIsolationLevel('repeatable read')
            .execute(inspectPurchaseCarryoverUpgrade),
        ),
      )
    else {
      if (
        !values.baseline ||
        !values.backup ||
        !values['actor-id'] ||
        !values['writers-frozen']
      )
        throw new Error('purchase_carryover_upgrade_inputs_required')
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
        throw new Error('purchase_carryover_upgrade_release_mismatch')
      for (const artifact of [backup.database, backup.attachments]) {
        const digest = createHash('sha256')
        for await (const part of createReadStream(artifact.path))
          digest.update(part)
        if (digest.digest('hex') !== artifact.sha256)
          throw new Error('purchase_carryover_upgrade_backup_digest_mismatch')
      }
      const baseline = z
        .object({ baseline: z.string().regex(/^[a-f0-9]{64}$/) })
        .passthrough()
        .parse(JSON.parse(await readFile(values.baseline, 'utf8')))
      console.log(
        JSON.stringify(
          await upgradePurchaseCarryover(db, {
            baseline: baseline.baseline,
            actorId: values['actor-id'],
            sourceReleaseSha: backup.sourceReleaseSha,
            targetReleaseSha: backup.targetReleaseSha,
          }),
        ),
      )
    }
  } finally {
    await db.destroy()
  }
}
main().catch((error: unknown) => {
  const message =
    error instanceof Error &&
    /^purchase_carryover_upgrade_[a-z_]+$/.test(error.message)
      ? error.message
      : 'purchase_carryover_upgrade_failed'
  process.stderr.write(message + '\n')
  process.exitCode = 1
})
