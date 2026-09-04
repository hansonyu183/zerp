import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'

import type { DB } from './generated.ts'

export function createDatabase(connectionString: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString }) }),
  })
}
