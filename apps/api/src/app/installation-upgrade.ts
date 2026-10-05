import { sql, type Transaction } from 'kysely'
import type { DB } from '../db/generated.ts'

/** One-shot addition of the stable installation identity to a reviewed old schema. */
export async function upgradeInstallationIdentity(
  tx: Transaction<DB>,
): Promise<void> {
  const table = await sql<{
    present: boolean
  }>`SELECT to_regclass('public.app_installation') IS NOT NULL AS present`.execute(
    tx,
  )
  if (table.rows[0]!.present) return
  await sql`CREATE TABLE app_installation (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    id uuid NOT NULL,
    initialized_at timestamptz NOT NULL
  )`.execute(tx)
  await sql`INSERT INTO app_installation(singleton,id,initialized_at) VALUES (true,gen_random_uuid(),now())`.execute(
    tx,
  )
}
