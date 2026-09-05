import assert from 'node:assert/strict'
import test from 'node:test'

import { accRouteSet } from '../../src/acc/contract.ts'

function requestSchema(action: keyof typeof accRouteSet) {
  return accRouteSet[action].request.body.content['application/json'].schema
}

function responseSchema(action: keyof typeof accRouteSet) {
  return accRouteSet[action].responses[200].content['application/json'].schema
}

test('ACC book create requires the historical template and independent access scopes', () => {
  const parsed = requestSchema('bookCreate').safeParse({
    id: '01J00000000000000000000001',
    name: '管理账簿',
    description: '',
    startMonth: '2026-09',
    baseCurrency: 'CNY',
    subjectTemplate: 'ENTERPRISE',
    queryUserIds: ['01J00000000000000000000002'],
    operateUserIds: ['01J00000000000000000000003'],
  })
  assert.equal(parsed.success, true)
  assert.equal(requestSchema('bookCreate').safeParse({
    id: '01J00000000000000000000001',
    name: '管理账簿',
    description: '',
    startMonth: '2026-09',
    baseCurrency: 'CNY',
  }).success, false)
})

test('ACC subject request accepts only the six current settlement purposes', () => {
  const base = {
    id: '01J00000000000000000000001',
    bookId: '01J00000000000000000000002',
    code: '1122',
    name: '应收账款',
    parentId: null,
    balanceDirection: 'DEBIT',
    enabled: true,
    requiredDimensions: ['CUSTOMER_SUBUNIT'],
    inventoryQuantity: false,
  }
  for (const settlementPurpose of ['NONE', 'RECEIVABLE', 'PREPAID', 'PAYABLE', 'ADVANCE_RECEIPT', 'OTHER'])
    assert.equal(requestSchema('subjectCreate').safeParse({ ...base, settlementPurpose }).success, true)
  assert.equal(requestSchema('subjectCreate').safeParse({ ...base, settlementPurpose: 'LEGACY' }).success, false)
})

test('ACC book query response validates the exact successful data shape', () => {
  const response = {
    code: 0,
    errorKey: '',
    message: 'ok',
    requestId: 'request-1',
    data: {
      items: [{
        id: '01J00000000000000000000001',
        code: 'ACC-0001',
        name: '管理账簿',
        description: '',
        startMonth: '2026-09',
        baseCurrency: 'CNY',
        controlBook: true,
        revision: '1',
        queryUserIds: ['01J00000000000000000000002'],
        operateUserIds: ['01J00000000000000000000003'],
      }],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  }
  const parsed = responseSchema('bookQuery').safeParse(response)
  assert.equal(parsed.success, true)
  assert.equal(responseSchema('bookQuery').safeParse({ ...response, data: { items: [{ arbitrary: true }], total: 1, page: 1, pageSize: 20 } }).success, false)
})
