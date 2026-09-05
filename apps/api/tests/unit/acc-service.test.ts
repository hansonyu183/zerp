import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accSubjectTemplates,
  validateAccSubjectAttributes,
} from '../../src/acc/service.ts'

test('ACC restores the approved f856118f accounting subject template catalogs', () => {
  assert.equal(accSubjectTemplates.ENTERPRISE.length, 28)
  assert.equal(accSubjectTemplates.SMALL_BUSINESS.length, 29)
  assert.deepEqual(accSubjectTemplates.EMPTY, [])
  assert.deepEqual(accSubjectTemplates.ENTERPRISE.find((line) => line.code === '1122'), {
    code: '1122', name: '应收账款', parentCode: '1000', balanceDirection: 'DEBIT',
    requiredDimensions: ['CUSTOMER_SUBUNIT'], inventoryQuantity: false, settlementPurpose: 'RECEIVABLE',
  })
  assert.deepEqual(accSubjectTemplates.SMALL_BUSINESS.find((line) => line.code === '3001'), {
    code: '3001', name: '实收资本', parentCode: '3000', balanceDirection: 'CREDIT',
    requiredDimensions: [], inventoryQuantity: false, settlementPurpose: 'NONE',
  })
})

test('ACC enforces settlement and inventory dimensions before persistence', () => {
  assert.doesNotThrow(() => validateAccSubjectAttributes({
    requiredDimensions: ['CUSTOMER_SUBUNIT'], inventoryQuantity: false, settlementPurpose: 'RECEIVABLE',
  }))
  assert.throws(() => validateAccSubjectAttributes({
    requiredDimensions: [], inventoryQuantity: false, settlementPurpose: 'RECEIVABLE',
  }), { name: 'AccApplicationError', errorKey: 'acc_subject_settlement_dimension_required' })
  assert.throws(() => validateAccSubjectAttributes({
    requiredDimensions: ['PRODUCT'], inventoryQuantity: true, settlementPurpose: 'NONE',
  }), { name: 'AccApplicationError', errorKey: 'acc_subject_inventory_dimension_required' })
  assert.throws(() => validateAccSubjectAttributes({
    requiredDimensions: ['DEPARTMENT'], inventoryQuantity: false, settlementPurpose: 'OTHER',
  }), { name: 'AccApplicationError', errorKey: 'acc_subject_settlement_dimension_required' })
})
