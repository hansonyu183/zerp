import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accBookTemplates,
  accSettlementPurposes,
  accSubjectDimensions,
} from '../src/index.ts'

test('ACC exposes the complete current wire-value sets', () => {
  assert.deepEqual(accBookTemplates, ['ENTERPRISE', 'SMALL_BUSINESS', 'EMPTY'])
  assert.deepEqual(accSettlementPurposes, [
    'NONE',
    'RECEIVABLE',
    'PREPAID',
    'PAYABLE',
    'ADVANCE_RECEIPT',
    'OTHER',
  ])
  assert.deepEqual(accSubjectDimensions, [
    'CUSTOMER_SUBUNIT',
    'SUPPLIER',
    'OTHER_UNIT',
    'EMPLOYEE',
    'SALES_PARTNER',
    'DEPARTMENT',
    'PRODUCT',
    'WAREHOUSE',
    'FUND_ACCOUNT',
    'ASSET',
    'BILL',
  ])
})
