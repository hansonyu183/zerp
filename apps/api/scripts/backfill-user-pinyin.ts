import { UserPinyinMaintenanceService } from '../src/app/user-pinyin.ts'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function expectedCount(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error(
      'USER_PY_BACKFILL_EXPECTED_USER_COUNT must be a nonnegative integer',
    )
  return parsed
}

function print(
  mode: 'dry-run' | 'applied',
  report: Awaited<ReturnType<UserPinyinMaintenanceService['inspect']>>,
) {
  process.stdout.write(
    `user pinyin backfill ${mode}: columnPresent=${report.columnPresent}; columnRequired=${report.columnRequired}; constraintPresent=${report.constraintPresent}; users=${report.userCount}; changed=${report.changedUsers}; factsSha256=${report.factsSha256}\n`,
  )
}

async function main(): Promise<void> {
  const databaseUrl = required('TARGET_DATABASE_URL')
  assertTargetDatabaseBoundary(databaseUrl, required('TARGET_DATABASE_SCOPE'))
  const db = createDatabase(databaseUrl)
  try {
    const service = new UserPinyinMaintenanceService(db)
    if (process.env.USER_PY_BACKFILL_APPLY !== 'true') {
      print('dry-run', await service.inspect())
      return
    }
    const baseline = {
      userCount: expectedCount(
        required('USER_PY_BACKFILL_EXPECTED_USER_COUNT'),
      ),
      factsSha256: required('USER_PY_BACKFILL_EXPECTED_FACTS_SHA256'),
    }
    const applied = await service.apply(baseline)
    const terminal = await service.inspect()
    if (
      terminal.factsSha256 !== applied.factsSha256 ||
      terminal.userCount !== applied.userCount ||
      terminal.changedUsers !== 0 ||
      !terminal.columnRequired ||
      !terminal.constraintPresent
    )
      throw new Error(
        'terminal user pinyin readback drifted; no retry was attempted',
      )
    print('applied', applied)
  } finally {
    await db.destroy()
  }
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`user pinyin backfill failed: ${message}\n`)
  process.exitCode = 1
}
