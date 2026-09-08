import assert from 'node:assert/strict'
import test from 'node:test'
import { vouPayloadSchemaByEntity } from '../../src/vou/contract.ts'
const objectId = '01J00000000000000000000001'
const current = { objectId }
const old = { objectId, approvalEntryId: objectId, selectionOrigin: 'CURRENT' }

test('cash adoption uses current fund account identity and rejects old approval references', () => {
  const schema = vouPayloadSchemaByEntity['employee-loan']
  const payload = {
    businessDate: '2026-09-07',
    currency: 'CNY',
    attachments: [],
    handler: current,
    employee: current,
    fundAccount: current,
    amount: '12.00',
  }
  assert.equal(schema.safeParse(payload).success, true)
  assert.equal(
    schema.safeParse({ ...payload, fundAccount: old }).success,
    false,
  )
})

test('delivery vehicle and inbound warehouse use stable current identities', () => {
  const base = {
    businessDate: '2026-09-07',
    currency: 'CNY',
    attachments: [],
    sourceLines: [{ sourceLineId: objectId, baseQuantity: '1.000000' }],
  }
  const delivery = vouPayloadSchemaByEntity['sale-delivery']
  assert.equal(delivery.safeParse({ ...base, vehicle: current }).success, true)
  assert.equal(delivery.safeParse({ ...base, vehicle: old }).success, false)
  const inbound = vouPayloadSchemaByEntity['purchase-inbound']
  assert.equal(
    inbound.safeParse({ ...base, supplier: old, warehouse: current }).success,
    true,
  )
  assert.equal(
    inbound.safeParse({ ...base, supplier: old, warehouse: old }).success,
    false,
  )
})
