import { describe, it, expect } from 'vitest'
import { emptyCustomer } from '../../../src/target/pages/bob/customer/vm.ts'
import { customerPricingChanges } from '../../../src/target/pages/bob/customer/pricing-diff.ts'

describe('customer pricing history', () => {
  it('matches normalized names and distinguishes added, removed, basis and amount changes', () => {
    const before = emptyCustomer()
    before.subunits[0]!.pricingPolicy.costItems = [
      { name: 'Handling', calculationBasis: 'UNIT_PRICE', unitPrice: '1.00' },
      { name: '删除项', calculationBasis: 'ORDER_AMOUNT', orderAmount: '2.00' },
      { name: '金额项', calculationBasis: 'UNIT_PRICE', unitPrice: '3.00' },
    ]
    const after = structuredClone(before)
    after.subunits[0]!.pricingPolicy.costItems = [
      {
        name: ' handling ',
        calculationBasis: 'ORDER_AMOUNT',
        orderAmount: '1.00',
      },
      { name: '新增项', calculationBasis: 'UNIT_PRICE', unitPrice: '2.00' },
      { name: '金额项', calculationBasis: 'UNIT_PRICE', unitPrice: '4.00' },
    ]
    after.subunits[0]!.pricingPolicy.defaultDiscountUnitPrice = '0.10'
    expect(customerPricingChanges(before, after)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: '默认优惠单价',
          before: '0.00',
          after: '0.10',
        }),
        expect.objectContaining({
          change: '口径变化',
          before: '按单价 1.00',
          after: '按订单金额 1.00',
        }),
        expect.objectContaining({ field: '删除项', change: '删除' }),
        expect.objectContaining({ field: '新增项', change: '新增' }),
        expect.objectContaining({ field: '金额项', change: '金额变化' }),
      ]),
    )
    expect(customerPricingChanges(before, before)).toEqual([])
  })
})
