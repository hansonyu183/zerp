import { BobArchiveMigrationService } from '../src/bob/migration.ts'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import { readTargetPermissionCatalog } from './target-artifacts.ts'

const url = process.env.TARGET_DATABASE_URL
if (!url) throw new Error('TARGET_DATABASE_URL is required')
assertTargetDatabaseBoundary(url, process.env.TARGET_DATABASE_SCOPE)
const database = createDatabase(url)
try {
  console.log(JSON.stringify(await new BobArchiveMigrationService(database).migrate(await readTargetPermissionCatalog())))
} finally {
  await database.destroy()
}
