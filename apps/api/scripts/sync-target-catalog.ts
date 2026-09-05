import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { AccService } from '../src/acc/service.ts'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import { readTargetPermissionCatalog } from './target-artifacts.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl)
  throw new Error('TARGET_DATABASE_URL is required to sync target catalog')
assertTargetDatabaseBoundary(databaseUrl, process.env.TARGET_DATABASE_SCOPE)

const database = createDatabase(databaseUrl)
try {
  await new TargetBootstrapService(database).migratePermissionCatalog(
    await readTargetPermissionCatalog(),
  )
  await new AccService(database).syncVouEntityCatalog()
} finally {
  await database.destroy()
}
