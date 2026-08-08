import { describe, expect, it } from 'vitest'
import { billCashAmountTypeOptions } from '@/utils/bill-cash-amount-type'

describe('bill cash amount type labels', () => {
  it('provides a Chinese label for every supported wire value', () => {
    expect(billCashAmountTypeOptions).toEqual([
      { title: '本金', value: 'PRINCIPAL' },
      { title: '利息', value: 'INTEREST' },
      { title: '手续费', value: 'FEE' },
      { title: '保证金', value: 'MARGIN' },
      { title: '其他', value: 'OTHER' },
    ])
  })
})
