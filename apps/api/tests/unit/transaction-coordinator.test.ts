import assert from 'node:assert/strict'
import test from 'node:test'

import { ApplicationTransactionCoordinator } from '../../src/platform/transaction-coordinator.ts'

test('transaction coordinator invokes typed plans in one deterministic lock order', async () => {
  const calls: string[] = []
  const transaction = { identity: Symbol('transaction') }
  const assertTransaction = (received: unknown) =>
    assert.equal(received, transaction)
  const coordinator = new ApplicationTransactionCoordinator({
    approval: {
      async apply(tx) {
        assertTransaction(tx)
        calls.push('approval')
      },
    },
    vou: {
      async apply(tx) {
        assertTransaction(tx)
        calls.push('vou')
      },
    },
    acc: {
      async apply(tx) {
        assertTransaction(tx)
        calls.push('acc')
      },
    },
    wfl: {
      async apply(tx) {
        assertTransaction(tx)
        calls.push('wfl')
      },
    },
    rpt: {
      async apply(tx) {
        assertTransaction(tx)
        calls.push('rpt')
      },
    },
  })

  await coordinator.execute(transaction as never, {
    approval: { kind: 'approval', action: 'APPLY', transition: {} as never, entity: 'sale-order', documentId: 'document' },
    vou: { kind: 'vou', action: 'NONE' },
    acc: { kind: 'acc', action: 'NONE' },
    wfl: { kind: 'wfl', action: 'NONE' },
    rpt: { kind: 'rpt', action: 'NONE' },
  })

  assert.deepEqual(calls, ['approval', 'vou', 'acc', 'wfl', 'rpt'])
})

test('transaction coordinator fails fast before later domain plans', async () => {
  const calls: string[] = []
  const coordinator = new ApplicationTransactionCoordinator({
    approval: { async apply() { calls.push('approval') } },
    vou: { async apply() { calls.push('vou'); throw new Error('forced VOU failure') } },
    acc: { async apply() { calls.push('acc') } },
    wfl: { async apply() { calls.push('wfl') } },
    rpt: { async apply() { calls.push('rpt') } },
  })

  await assert.rejects(
    coordinator.execute({} as never, {
      approval: { kind: 'approval', action: 'APPLY', transition: {} as never, entity: 'sale-order', documentId: 'document' },
      vou: { kind: 'vou', action: 'NONE' },
      acc: { kind: 'acc', action: 'NONE' },
      wfl: { kind: 'wfl', action: 'NONE' },
      rpt: { kind: 'rpt', action: 'NONE' },
    }),
    /forced VOU failure/,
  )
  assert.deepEqual(calls, ['approval', 'vou'])
})
