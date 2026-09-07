import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { AccService } from '../src/acc/service.ts'
import { createDatabase } from '../src/db/database.ts'
import { requiresAuxPeoplePermissionMigration } from '../src/aux/migration.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import { readTargetPermissionCatalog } from './target-artifacts.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl)
  throw new Error('TARGET_DATABASE_URL is required to sync target catalog')
assertTargetDatabaseBoundary(databaseUrl, process.env.TARGET_DATABASE_SCOPE)

const database = createDatabase(databaseUrl)
try {
  const catalog = await readTargetPermissionCatalog()
  const existingPermissions = await database
    .selectFrom('app_permissions')
    .select('path')
    .execute()
  if (
    requiresAuxPeoplePermissionMigration(
      existingPermissions.map((permission) => permission.path),
      catalog.map((permission) => permission.path),
    )
  )
    throw new Error(
      'legacy DCL/BOB people permissions require pnpm migrate:aux-people before catalog sync',
    )
  await new TargetBootstrapService(database).migratePermissionCatalog(catalog)
  await new AccService(database).syncVouEntityCatalog()
} finally {
  await database.destroy()
}
