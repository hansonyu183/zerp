import { sql, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'

/** One-shot conversion of ordinary dictionaries predating the typed purpose. */
export async function upgradeDictionaryPurposes(
  tx: Transaction<DB>,
): Promise<void> {
  await sql`UPDATE aux_objects SET data=jsonb_set(data,'{purpose}','"GENERAL"'::jsonb) WHERE entity='dictionary-type' AND NOT(data ? 'purpose')`.execute(
    tx,
  )
}
