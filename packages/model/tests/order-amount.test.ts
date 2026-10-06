import assert from 'node:assert/strict'
import test from 'node:test'
import { orderLineAmountMinor, orderQuote } from '../src/order-amount.ts'

test('agreed amounts retain exact source totals and independent batch allocations', () => {
  const line = {
    baseQuantity: '1360.000000',
    unitPrice: '5.430123',
    agreedAmount: '7379.88',
  }
  assert.equal(orderLineAmountMinor(line), 737988n)
  assert.equal(orderLineAmountMinor(line, '680'), 368994n)
  assert.equal(orderLineAmountMinor(line, '27'), 14651n)
  assert.equal(
    orderLineAmountMinor({ ...line, unitPrice: '999.123456' }, '680'),
    368994n,
  )
  assert.equal(
    orderLineAmountMinor(
      { baseQuantity: '3', unitPrice: '0.00', agreedAmount: '1.00' },
      '1',
    ),
    33n,
  )
  assert.equal(
    orderLineAmountMinor({ ...line, agreedAmount: '0.00' }, '680'),
    0n,
  )
  assert.throws(
    () => orderLineAmountMinor({ ...line, baseQuantity: '0' }),
    'positive denominator required',
  )
})
test('unit-price orders retain their existing rounding choices without floating point', () => {
  const line = { baseQuantity: '0.335', unitPrice: '1.00' }
  assert.equal(orderLineAmountMinor(line), 33n)
  assert.equal(orderLineAmountMinor(line, line.baseQuantity, 'HALF_UP'), 34n)
  assert.equal(orderQuote('5.430123'), '5.430123')
  assert.equal(orderQuote('5.430000'), '5.43')
})
