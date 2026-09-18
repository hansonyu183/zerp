import { readFile } from 'node:fs/promises'
import { sql, type Kysely } from 'kysely'
import type { DB } from '../db/generated.ts'

/** Additive schema preparation; business writes remain in ManagementService. */
export async function prepareSourceUsers(
  db: Kysely<DB>,
): Promise<'created' | 'unchanged'> {
  const baseline = await readFile(
    new URL('../../db/target-schema.sql', import.meta.url),
    'utf8',
  )
  const ddl = baseline
    .split('-- BEGIN SOURCE USER MIGRATION SCHEMA\n')[1]
    ?.split('-- END SOURCE USER MIGRATION SCHEMA')[0]
  if (!ddl) throw new Error('source user schema missing')
  return db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(74155001)`.execute(tx)
    const existing = await sql<{
      name: string
    }>`SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('app_source_users','app_source_user_roles')`.execute(
      tx,
    )
    if (existing.rows.length === 2) return 'unchanged'
    if (existing.rows.length) throw new Error('incomplete source user schema')
    await sql.raw(ddl).execute(tx)
    return 'created'
  })
}
