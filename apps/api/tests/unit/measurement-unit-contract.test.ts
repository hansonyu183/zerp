import assert from 'node:assert/strict'
import test from 'node:test'
import { auxCreateRoute } from '../../src/app/aux-contract.ts'

test('measurement units accept a fixed factor or product-specific conversion without symbol or scale', () => {
  const schema = auxCreateRoute(
    '/aux/measurement-unit/create',
    'measurement-unit',
  ).request.body.content['application/json'].schema
  for (const data of [
    { name: 'kg', fixedFactor: '1' },
    { name: '吨', fixedFactor: '1000' },
    { name: '桶', fixedFactor: null },
    { name: '微量', fixedFactor: '0.0001' },
  ])
    assert.deepEqual(schema.parse(data), data)
  for (const data of [
    { name: 'kg', fixedFactor: '0' },
    { name: 'kg', fixedFactor: '-1' },
    { name: 'kg', fixedFactor: '1', symbol: 'kg' },
    { name: 'kg', fixedFactor: '1', quantityScale: 2 },
  ])
    assert.equal(schema.safeParse(data).success, false)
})
