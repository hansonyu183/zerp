import pg from 'pg'

import { createDatabase } from '../src/db/database.ts'
import { PgRptDefinitionValidator, RptService } from '../src/rpt/service.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl) throw new Error('TARGET_DATABASE_URL is required')
const database = createDatabase(databaseUrl)
const validationPool = new pg.Pool({ connectionString: databaseUrl })
try {
  await new RptService(database, new PgRptDefinitionValidator(validationPool, database)).assertAllEnabled()
  process.stdout.write('all enabled RPT definitions are compatible\n')
} finally {
  await validationPool.end()
  await database.destroy()
}
