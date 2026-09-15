import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import {
  inspectArchiveCutover,
  migrateArchiveOwnership,
} from '../src/dcl/cutover.ts'
import { readTargetPermissionCatalog } from './target-artifacts.ts'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean' },
      baseline: { type: 'string' },
      backup: { type: 'string' },
      'writers-frozen': { type: 'boolean' },
    },
  })
  const url = process.env.TARGET_DATABASE_URL
  if (!url) throw new Error('TARGET_DATABASE_URL is required')
  assertTargetDatabaseBoundary(url, process.env.TARGET_DATABASE_SCOPE)
  const db = createDatabase(url)
  try {
    if (!values.apply) {
      console.log(
        JSON.stringify(
          await db
            .transaction()
            .setIsolationLevel('repeatable read')
            .execute(inspectArchiveCutover),
          null,
          2,
        ),
      )
    } else {
      if (!values.baseline || !values.backup || !values['writers-frozen'])
        throw new Error(
          'apply requires --baseline, --backup and --writers-frozen',
        )
      const backupFile = z
        .object({
          path: z.string().min(1),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
      const manifest = z
        .object({
          sourceReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
          targetReleaseSha: z.string().regex(/^[a-f0-9]{40}$/),
          database: backupFile,
          attachments: backupFile,
        })
        .strict()
        .parse(JSON.parse(await readFile(values.backup, 'utf8')))
      for (const file of [manifest.database, manifest.attachments]) {
        const hash = createHash('sha256')
        for await (const part of createReadStream(file.path)) hash.update(part)
        if (hash.digest('hex') !== file.sha256)
          throw new Error('archive_cutover_backup_digest_mismatch')
      }
      const baseline = z
        .object({ baseline: z.string().regex(/^[a-f0-9]{64}$/) })
        .passthrough()
        .parse(JSON.parse(await readFile(values.baseline, 'utf8')))
      const report = await migrateArchiveOwnership(
        db,
        baseline.baseline,
        await readTargetPermissionCatalog(),
      )
      console.log(
        JSON.stringify(
          {
            ...report,
            sourceReleaseSha: manifest.sourceReleaseSha,
            targetReleaseSha: manifest.targetReleaseSha,
          },
          null,
          2,
        ),
      )
    }
  } finally {
    await db.destroy()
  }
}

try {
  await main()
} catch {
  process.stderr.write('archive_cutover_failed\n')
  process.exitCode = 1
}
