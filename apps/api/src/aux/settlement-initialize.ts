import { sql, type Kysely } from 'kysely'
import { ulid } from 'ulid'
import type { DB } from '../db/generated.ts'

// Fixed AUX facts, not customer-company defaults. Subsequent enabled/surcharge
// maintenance is preserved; normal clients cannot create a fourteenth term.
export async function initializeSettlementMethods(
  db: Kysely<DB>,
  actorId: string,
): Promise<number> {
  const terms = [
    ['PREPAID', '预付', 'RELATIVE_DAYS', 0, 0, '0.00'],
    ['CASH_ON_DELIVERY', '现结（货到付款）', 'RELATIVE_DAYS', 0, 0, '0.00'],
    ...[3, 5, 7, 10, 15, 20, 30].map((days) => [
      `ARRIVAL_${days}`,
      `货到${days}天`,
      'RELATIVE_DAYS',
      0,
      days,
      days === 30 ? '0.10' : '0.00',
    ]),
    ['MONTHLY_CURRENT', '当月结', 'MONTH_END', 0, 0, '0.05'],
    ['MONTHLY_30', '月结30天', 'MONTH_END', 1, 0, '0.10'],
    ['MONTHLY_60', '月结60天', 'MONTH_END', 2, 0, '0.20'],
    ['MONTHLY_90', '月结90天', 'MONTH_END', 3, 0, '0.30'],
  ] as const
  return db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('aux:settlement-initialize'))`.execute(
      tx,
    )
    const existing = await tx
      .selectFrom('aux_objects')
      .select(['id', 'data'])
      .where('entity', '=', 'settlement-method')
      .execute()
    const byTerm = new Map<string, string>()
    for (const row of existing) {
      const term = (row.data as { termCode?: string }).termCode
      if (!term || !terms.some((item) => item[0] === term) || byTerm.has(term))
        throw new Error('invalid fixed settlement baseline')
      byTerm.set(term, row.id)
    }
    let created = 0
    for (const [
      termCode,
      name,
      ruleType,
      monthOffset,
      dayOffset,
      defaultSalesSurcharge,
    ] of terms) {
      if (byTerm.has(String(termCode))) continue
      const counter = await sql<{
        last_value: number
      }>`INSERT INTO object_number_counters(domain,entity,last_value) VALUES ('aux','settlement-method',1)
        ON CONFLICT (domain,entity) DO UPDATE SET last_value=object_number_counters.last_value+1 WHERE object_number_counters.last_value<9999 RETURNING last_value`.execute(
        tx,
      )
      const number = counter.rows[0]?.last_value
      if (!number) throw new Error('settlement counter exhausted')
      const data = {
        name,
        termCode,
        ruleType,
        monthOffset,
        dayOfMonth: 0,
        dayOffset,
        defaultSalesSurcharge,
        description: '',
      }
      await tx
        .insertInto('aux_objects')
        .values({
          id: ulid(),
          entity: 'settlement-method',
          code: `STM-${String(number).padStart(4, '0')}`,
          enabled: true,
          revision: '1',
          data: JSON.stringify(data),
          created_by: actorId,
          updated_by: actorId,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .execute()
      created++
    }
    return created
  })
}
