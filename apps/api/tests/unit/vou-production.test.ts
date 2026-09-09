import assert from 'node:assert/strict'
import test from 'node:test'
import { vouPayloadSchemaByEntity } from '../../src/vou/contract.ts'

test('production accepts empty currency and rejects financial currency', () => {
  const reference = { objectId: '01J00000000000000000000001' }
  const payload = {
    businessDate: '2026-09-09',
    currency: '',
    attachments: [],
    materialWarehouse: reference,
    finishedWarehouse: reference,
    productionLines: [
      {
        product: reference,
        enteredQuantity: '1',
        enteredUnit: reference,
        baseQuantity: '1',
        lossRate: '0',
        materials: [
          {
            formulaLineNo: 1,
            actualMaterial: reference,
            actualEnteredQuantity: '1',
            actualEnteredUnit: reference,
            actualBaseQuantity: '1',
          },
        ],
      },
    ],
  }
  for (const entity of ['order-production', 'self-production'] as const) {
    assert.equal(
      vouPayloadSchemaByEntity[entity].safeParse(payload).success,
      true,
    )
    assert.equal(
      vouPayloadSchemaByEntity[entity].safeParse({
        ...payload,
        currency: 'CNY',
      }).success,
      false,
    )
  }
})
