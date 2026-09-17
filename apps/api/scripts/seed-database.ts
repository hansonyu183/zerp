import { AccService } from '../src/acc/service.ts'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main(): Promise<void> {
  const url = required('TARGET_DATABASE_URL')
  assertTargetDatabaseBoundary(url, required('TARGET_DATABASE_SCOPE'))
  const usernames = [
    required('APP_ADMIN_1_USERNAME'),
    required('APP_ADMIN_2_USERNAME'),
  ]
  const db = createDatabase(url)
  try {
    const result = await new AccService(db).initializeInternalBook(usernames)
    process.stdout.write(`database seed: internal book ${result}\n`)
  } finally {
    await db.destroy()
  }
}

try {
  await main()
} catch {
  // Do not expose connection strings or driver diagnostics in initialization logs.
  process.stderr.write(
    'database seed failed; verify database boundary, book baseline and configured administrators\n',
  )
  process.exitCode = 1
}
