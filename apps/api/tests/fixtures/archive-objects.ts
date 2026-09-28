import type { Insertable, Kysely, Transaction } from 'kysely'
import type { DB, DclSubjects } from '../../src/db/generated.ts'

type FixtureObject = Insertable<DclSubjects> & {
  enabled?: boolean
  revision?: string | number
}
export async function insertArchiveObjects(
  db: Kysely<DB> | Transaction<DB>,
  input: FixtureObject | FixtureObject[],
) {
  const rows = Array.isArray(input) ? input : [input]
  await db
    .insertInto('dcl_subjects')
    .values(
      rows.map(
        ({ enabled: _enabled, revision: _revision, ...identity }) => identity,
      ),
    )
    .execute()
  await db
    .insertInto('bob_objects')
    .values(
      rows.map((row) => ({
        id: row.id,
        enabled: row.enabled ?? true,
        revision: row.revision ?? '1',
      })),
    )
    .execute()
}

// Adopted historical terms for fixtures that insert already approved customers.
export const monthlySettlementSnapshot = JSON.stringify({
  id: '01J00000000000000000000104',
  code: 'FIXTURE-MONTHLY',
  name: '月结30天',
  termCode: 'MONTHLY_30',
  ruleType: 'MONTH_END',
  monthOffset: 1,
  dayOfMonth: 0,
  dayOffset: 0,
  defaultSalesSurcharge: '0.00',
})
