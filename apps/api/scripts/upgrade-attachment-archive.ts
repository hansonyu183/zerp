import { parseArgs } from 'node:util'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import { readVerifiedUpgradeInput } from '../src/platform/upgrade-input.ts'
import {
  inspectAttachmentArchiveUpgrade,
  upgradeAttachmentArchive,
} from '../src/platform/attachment-archive-upgrade.ts'

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
  if (!url) throw new Error('attachment_archive_upgrade_database_required')
  assertTargetDatabaseBoundary(url, process.env.TARGET_DATABASE_SCOPE)
  const db = createDatabase(url)
  try {
    if (!values.apply)
      console.log(
        JSON.stringify(
          await db
            .transaction()
            .setIsolationLevel('repeatable read')
            .execute(inspectAttachmentArchiveUpgrade),
        ),
      )
    else {
      if (
        !values.baseline ||
        !values.backup ||
        !values['actor-id'] ||
        !values['writers-frozen']
      )
        throw new Error('attachment_archive_upgrade_inputs_required')
      const verified = await readVerifiedUpgradeInput({
        baselinePath: values.baseline,
        backupPath: values.backup,
        targetReleaseSha: process.env.ZERP_RELEASE_SHA,
        errorPrefix: 'attachment_archive_upgrade',
      })
      console.log(
        JSON.stringify(
          await upgradeAttachmentArchive(db, {
            ...verified,
            actorId: values['actor-id'],
            writersFrozen: true,
          }),
        ),
      )
    }
  } finally {
    await db.destroy()
  }
}
main().catch((error: unknown) => {
  process.stderr.write(
    (error instanceof Error &&
    /^attachment_archive_upgrade_[a-z_]+$/.test(error.message)
      ? error.message
      : 'attachment_archive_upgrade_failed') + '\n',
  )
  process.exitCode = 1
})
