import { describe, expect, it } from 'vitest'
import {
  calculateDueDate,
  calculateLineAmount,
  isMoney,
  isQuantity,
  parseFixed,
  resolveDueDate,
  sumMoney,
  toVouAtomicDocument,
} from '@/components/voucher'

describe('VOU decimal and settlement helpers', () => {
  it('parses quantities and money without floating point conversion', () => {
    expect(parseFixed('1.234567', 6)).toBe(1_234_567n)
    expect(parseFixed('0', 6, true)).toBe(0n)
    expect(isQuantity('0.000001')).toBe(true)
    expect(isQuantity('1.0000001')).toBe(false)
    expect(isQuantity('-1')).toBe(false)
    expect(isMoney('12.34')).toBe(true)
    expect(isMoney('12.345')).toBe(false)
    expect(isMoney('0')).toBe(false)
  })

  it('rounds product line amounts half up and sums cents exactly', () => {
    expect(calculateLineAmount('1.5', '1.01')).toBe('1.52')
    expect(calculateLineAmount('999999999999.999999', '999999999.99'))
      .toBeNull()
    expect(parseFixed('92233720368547758.07', 2)).toBeNull()
    expect(sumMoney(['1.01', '2.02', '0.00'])).toBe('3.03')
    expect(sumMoney(['1.001'])).toBeNull()
  })

  it('calculates all settlement rule dates in local calendar semantics', () => {
    const base = {
      objectId: 'SM-1',
      versionId: 'SMV-1',
      code: 'NET',
      name: '结算',
      monthOffset: 0,
      dayOffset: 0,
    }
    expect(calculateDueDate('2024-02-28', {
      ...base,
      ruleType: 'RELATIVE_DAYS',
      dayOffset: 1,
    })).toBe('2024-02-29')
    expect(calculateDueDate('2024-02-10', {
      ...base,
      ruleType: 'MONTH_END',
      dayOffset: 1,
    })).toBe('2024-03-01')
    expect(calculateDueDate('2026-01-31', {
      ...base,
      ruleType: 'FIXED_DAY',
      monthOffset: 1,
      dayOfMonth: 31,
    })).toBe('2026-02-28')
    expect(resolveDueDate('2026-03-15', '2024-02-28', {
      ...base,
      ruleType: 'RELATIVE_DAYS',
      dayOffset: 1,
    })).toBe('2026-03-15')
    expect(resolveDueDate(undefined, '2024-02-28', {
      ...base,
      ruleType: 'RELATIVE_DAYS',
      dayOffset: 1,
    })).toBe('2024-02-29')
  })

  it('adapts an existing VOU response to the atomic document contract', () => {
    const atomic = toVouAtomicDocument({
      documentId: 'SO-1',
      entity: 'sale-order',
      documentNo: 'SO-20260725-000001',
      status: 'CHECKED',
      revision: 3,
      amount: '25.00',
      data: {
        businessDate: '2026-07-25',
        currency: 'CNY',
        productLines: [],
      },
      attachments: [],
      createdAt: '2026-07-25T00:00:00Z',
      createdBy: 'USER-1',
      updatedAt: '2026-07-25T01:00:00Z',
      updatedBy: 'USER-2',
      checkedAt: '2026-07-25T01:00:00Z',
      checkedBy: 'USER-2',
    })

    expect(atomic).toMatchObject({
      documentId: 'SO-1',
      entity: 'sale-order',
      status: 'CHECKED',
      revision: 3,
      businessDate: '2026-07-25',
      currency: 'CNY',
      checkedBy: 'USER-2',
    })
  })
})
