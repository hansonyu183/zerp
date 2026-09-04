import { sql, type Transaction } from 'kysely'

import type { DB } from '../db/generated.ts'

/**
 * Serializes every write that can change accounting facts for a calendar month.
 * The key deliberately excludes the book: a VOU write is shared by every book,
 * so it must contend with a lock or unlock in any one of them.
 */
export async function lockAccountingPeriod(
  transaction: Transaction<DB>,
  month: string,
): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`acc:period:${month}`}, 0))`.execute(
    transaction,
  )
}
