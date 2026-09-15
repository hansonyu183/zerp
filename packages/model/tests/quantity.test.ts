import assert from 'node:assert/strict'
import test from 'node:test'
import { isInputQuantity } from '../src/quantity.ts'
test('input quantities accept two decimal places without rounding', () => {
  for (const value of ['1', '1.2', '1.23', '1.230000'])
    assert.equal(isInputQuantity(value), true)
  for (const value of ['1.234', '0.000001', 'NaN', '1e2'])
    assert.equal(isInputQuantity(value), false)
})
