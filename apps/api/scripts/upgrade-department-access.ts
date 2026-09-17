import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import { upgradeDepartmentAccess } from '../src/app/department-upgrade.ts'

const url = process.env.TARGET_DATABASE_URL
const scope = process.env.TARGET_DATABASE_SCOPE
if (!url || !scope) throw new Error('explicit database URL and scope required')
assertTargetDatabaseBoundary(url, scope)
const db = createDatabase(url)
try {
  process.stdout.write(
    `department access schema: ${await upgradeDepartmentAccess(db)}\n`,
  )
} catch {
  process.stderr.write(
    'department access upgrade failed; verify schema and administrator-only role baseline\n',
  )
  process.exitCode = 1
} finally {
  await db.destroy()
}
