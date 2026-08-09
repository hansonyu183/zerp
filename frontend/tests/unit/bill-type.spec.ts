import { describe, expect, it } from 'vitest'
import { billTypeOptions, formatBillType } from '@/utils/bill-type'

describe('bill type labels', () => {
  it('formats every supported wire value for Chinese operator views', () => {
    expect(billTypeOptions).toEqual([
      { title: '银行承兑', value: 'BANK_ACCEPTANCE' },
      { title: '商业承兑', value: 'COMMERCIAL_ACCEPTANCE' },
      { title: '支票', value: 'CHECK' },
      { title: '其他', value: 'OTHER' },
    ])
    expect(formatBillType('BANK_ACCEPTANCE')).toBe('银行承兑')
    expect(formatBillType('COMMERCIAL_ACCEPTANCE')).toBe('商业承兑')
    expect(formatBillType('CHECK')).toBe('支票')
    expect(formatBillType('OTHER')).toBe('其他')
  })

  it('keeps an unknown future wire value visible', () => {
    expect(formatBillType('FUTURE_TYPE')).toBe('FUTURE_TYPE')
  })
})
