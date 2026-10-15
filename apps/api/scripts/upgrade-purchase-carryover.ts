import { readVerifiedUpgradeInput } from '../src/platform/upgrade-input.ts'
import { parseArgs } from 'node:util'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import {
  inspectPurchaseCarryoverUpgrade,
  upgradePurchaseCarryover,
  inspectPurchaseSourceClosureUpgrade,
  upgradePurchaseSourceClosure,
  inspectStandaloneReceiptUpgrade,
  upgradeStandaloneReceipts,
} from '../src/vou/purchase-carryover-upgrade.ts'

async function main() {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean' },
      'source-closure': { type: 'boolean' },
      'standalone-receipts': { type: 'boolean' },
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
  if (values['source-closure'] && values['standalone-receipts'])
    throw new Error('purchase_carryover_upgrade_inputs_required')
  const inspect = values['standalone-receipts']
    ? inspectStandaloneReceiptUpgrade
    : values['source-closure']
      ? inspectPurchaseSourceClosureUpgrade
      : inspectPurchaseCarryoverUpgrade
  const apply = values['standalone-receipts']
    ? upgradeStandaloneReceipts
    : values['source-closure']
      ? upgradePurchaseSourceClosure
      : upgradePurchaseCarryover
  try {
    if (!values.apply)
      console.log(
        JSON.stringify(
          await db
            .transaction()
            .setIsolationLevel('repeatable read')
            .execute(async (tx) => inspect(tx)),
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
      const verified = await readVerifiedUpgradeInput({
        backupPath: values.backup,
        baselinePath: values.baseline,
        targetReleaseSha: process.env.ZERP_RELEASE_SHA,
        errorPrefix: 'purchase_carryover_upgrade',
      })
      console.log(
        JSON.stringify(
          await apply(db, {
            baseline: verified.baseline,
            actorId: values['actor-id'],
            sourceReleaseSha: verified.sourceReleaseSha,
            targetReleaseSha: verified.targetReleaseSha,
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
