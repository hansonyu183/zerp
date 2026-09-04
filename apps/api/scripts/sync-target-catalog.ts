import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { createDatabase } from '../src/db/database.ts'
import { readTargetPermissionCatalog } from './target-artifacts.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl)
  throw new Error('TARGET_DATABASE_URL is required to sync target catalog')
if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test'))
  throw new Error(
    'target catalog sync only accepts a disposable *_test database',
  )

const database = createDatabase(databaseUrl)
try {
  await new TargetBootstrapService(database).migratePermissionCatalog(
    await readTargetPermissionCatalog(),
  )
} finally {
  await database.destroy()
}
