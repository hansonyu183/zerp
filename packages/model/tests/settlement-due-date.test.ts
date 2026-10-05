import assert from 'node:assert/strict'
import test from 'node:test'
import { settlementDueDate } from '../src/index.ts'
const monthly = {
  termCode: 'MONTHLY_30',
  ruleType: 'MONTH_END',
  monthOffset: 1,
  dayOfMonth: 0,
  dayOffset: 0,
} as const
test('monthly closing day separates signoffs on either side and clamps short months', () => {
  assert.equal(settlementDueDate('2026-09-25', monthly, 25), '2026-10-31')
  assert.equal(settlementDueDate('2026-09-26', monthly, 25), '2026-11-30')
  assert.equal(settlementDueDate('2028-02-29', monthly, 31), '2028-03-31')
  assert.equal(settlementDueDate('2026-09-26', monthly, null), '2026-10-31')
})
test('arrival thirty days uses actual signoff and ignores monthly closing', () => {
  const arrival = {
    termCode: 'ARRIVAL_30',
    ruleType: 'RELATIVE_DAYS',
    monthOffset: 0,
    dayOfMonth: 0,
    dayOffset: 30,
  } as const
  assert.equal(settlementDueDate('2026-09-10', arrival, 25), '2026-10-10')
  assert.equal(settlementDueDate('2028-02-29', arrival, 25), '2028-03-30')
})
