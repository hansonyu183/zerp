import { createDatabase } from '../src/db/database.ts'
import { RptService } from '../src/rpt/service.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl) throw new Error('TARGET_DATABASE_URL is required')
const database = createDatabase(databaseUrl)
try {
  await new RptService(database).assertAllEnabled()
  process.stdout.write('all enabled RPT definitions are compatible\n')
} finally {
  await database.destroy()
}
