import assert from 'node:assert/strict'
import test from 'node:test'

import { vouPayloadSchemaByEntity } from '../../src/vou/contract.ts'

const id = '01J00000000000000000000001'
const versioned = {
  objectId: id,
  approvalEntryId: id,
  selectionOrigin: 'CURRENT' as const,
}
const employee = { objectId: id }
const amountFacts = {
  businessDate: '2026-09-07',
  currency: 'CNY',
  attachments: [],
  handler: employee,
  fundAccount: versioned,
  amount: '12.00',
}

test('employee loan selects AUX people by stable ID and rejects fabricated approval versions', () => {
  const schema = vouPayloadSchemaByEntity['employee-loan']
  const payload = { ...amountFacts, employee }
  assert.equal(schema.safeParse(payload).success, true)
  assert.equal(schema.safeParse({ ...payload, employee: versioned }).success, false)
})

test('mixed counterparties pair employee with AUX stable references only', () => {
  const schema = vouPayloadSchemaByEntity['other-receipt']
  assert.equal(
    schema.safeParse({ ...amountFacts, counterparty: employee, counterpartyType: 'employee' }).success,
    true,
  )
  assert.equal(
    schema.safeParse({ ...amountFacts, counterparty: versioned, counterpartyType: 'employee' }).success,
    false,
  )
  assert.equal(
    schema.safeParse({ ...amountFacts, counterparty: employee, counterpartyType: 'supplier' }).success,
    false,
  )
  assert.equal(
    schema.safeParse({ ...amountFacts, counterparty: versioned, counterpartyType: 'supplier' }).success,
    true,
  )
})
