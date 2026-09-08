import { AuxService } from '../src/aux/service.ts'
import {
  AuxAssetMigrationBlockedError,
  AuxAssetMigrationService,
} from '../src/aux/migration-assets.ts'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import { readTargetPermissionCatalog } from './target-artifacts.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl)
  throw new Error('TARGET_DATABASE_URL is required to migrate AUX assets')
assertTargetDatabaseBoundary(databaseUrl, process.env.TARGET_DATABASE_SCOPE)

const database = createDatabase(databaseUrl)
try {
  const service = new AuxAssetMigrationService(
    database,
    new AuxService(database),
  )
  const report = await service.migrate(await readTargetPermissionCatalog())
  console.log(JSON.stringify(report))
} catch (error) {
  if (error instanceof AuxAssetMigrationBlockedError) {
    console.error(JSON.stringify({ blockers: error.blockers }))
    process.exitCode = 1
  } else throw error
} finally {
  await database.destroy()
}
