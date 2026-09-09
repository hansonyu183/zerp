import assert from 'node:assert/strict'
import test from 'node:test'
import { intermediaryCollectionDates } from '../../src/vou/intermediary-fifo.ts'
const sale = (id: string, date = '2026-09-01', amount = 100n) => ({
  id,
  date,
  amount,
  customerId: 'customer',
  documentNo: id,
})
test('FIFO pays opening first and never makes a targeted return into another invoice payment', () => {
  const result = intermediaryCollectionDates(
    [sale('a'), sale('b')],
    [
      {
        kind: 'PAYMENT',
        id: 'p1',
        customerId: 'customer',
        date: '2026-09-02',
        amount: 180n,
      },
      {
        kind: 'RETURN',
        id: 'r1',
        customerId: 'customer',
        date: '2026-09-03',
        amount: 100n,
        sourceId: 'a',
      },
      {
        kind: 'PAYMENT',
        id: 'p2',
        customerId: 'customer',
        date: '2026-09-04',
        amount: 20n,
      },
      {
        kind: 'PAYMENT',
        id: 'p3',
        customerId: 'customer',
        date: '2026-09-05',
        amount: 100n,
      },
    ],
    new Map([['customer', 100n]]),
  )
  assert.equal(result.get('a'), '2026-09-03')
  assert.equal(result.get('b'), '2026-09-05')
})
test('prepayments and zero value sales settle on their first sale date', () => {
  const result = intermediaryCollectionDates(
    [sale('a'), sale('b', '2026-09-03', 0n)],
    [],
    new Map([['customer', -100n]]),
  )
  assert.equal(result.get('a'), '2026-09-01')
  assert.equal(result.get('b'), '2026-09-03')
})

test('same-day sales consume prepayments in document-number order', () => {
  const result = intermediaryCollectionDates(
    [sale('a'), sale('b')],
    [],
    new Map([['customer', -100n]]),
  )
  assert.deepEqual([...result], [['a', '2026-09-01']])
})
