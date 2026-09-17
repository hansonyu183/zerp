import pg from 'pg'
import { DepartmentRoleService } from '../src/app/department-roles.ts'
import { RptService, PgRptDefinitionValidator } from '../src/rpt/service.ts'
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
  const validationPool = new pg.Pool({ connectionString: url })
  try {
    const result = await new AccService(db).initializeInternalBook(usernames)
    const administrator = await db
      .selectFrom('app_users as u')
      .innerJoin('app_user_roles as ur', 'ur.user_id', 'u.id')
      .innerJoin('app_roles as r', 'r.id', 'ur.role_id')
      .select('u.id')
      .where('u.status', '=', 'ENABLED')
      .where('r.status', '=', 'ENABLED')
      .where('r.code', '=', 'superadmin')
      .executeTakeFirstOrThrow()
    const reports = await new RptService(
      db,
      new PgRptDefinitionValidator(validationPool, db),
    ).initializeDepartmentReports({
      id: administrator.id,
      permissions: ['/rpt/definition/save'],
    })
    const roles = await new DepartmentRoleService(db).initialize()
    process.stdout.write(
      `database seed: internal book ${result}; department reports ${reports}; department roles ${roles}\n`,
    )
  } finally {
    await validationPool.end()
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
