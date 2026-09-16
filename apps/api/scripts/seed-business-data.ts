import pg from 'pg'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import { seedBusinessData } from './lib/business-seed.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl) throw new Error('TARGET_DATABASE_URL is required')
assertTargetDatabaseBoundary(databaseUrl, process.env.TARGET_DATABASE_SCOPE)
const database = createDatabase(databaseUrl)
const pool = new pg.Pool({ connectionString: databaseUrl })
try {
  const report = await seedBusinessData(database, pool)
  process.stdout.write(
    `business seed: ${report.created ? 'created' : 'already installed; preserved'}; book=${report.bookId}\n`,
  )
} catch (error) {
  const key =
    error && typeof error === 'object' && 'errorKey' in error
      ? String(error.errorKey)
      : 'seed_failed'
  process.stderr.write(
    `Business seed error: ${/^[a-z_]+$/.test(key) ? key : 'seed_failed'}\n`,
  )
  process.stderr.write(
    'Business seed failed; all business changes rolled back. Verify catalog, enabled online-test users and WASM build.\n',
  )
  process.exitCode = 1
} finally {
  await pool.end()
  await database.destroy()
}
