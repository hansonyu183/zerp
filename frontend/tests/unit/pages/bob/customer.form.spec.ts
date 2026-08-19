import { describe, expect, it } from 'vitest'
import {
  createCustomerForm,
  pricingPolicyErrors,
  sortedCostItems,
} from '@/pages/bob/customer/form'
import { customerCreatePayload } from '@/pages/bob/customer/payload'

describe('customer form data', () => {
  it('creates a complete, closed default pricing policy and account draft', () => {
    const form = createCustomerForm()

    expect(form.group).toMatchObject({
      companyName: '',
      taxNumber: '',
      bankAccounts: [],
    })
    expect(form.account.pricingPolicy).toEqual({
      defaultPremiumUnitPrice: '0.00',
      defaultDiscountUnitPrice: '0.00',
      costItems: [],
      thirdPartyIntermediaryFixedUnitCost: '0.00',
      thirdPartyIntermediaryVariableUnitCost: '0.00',
    })
    expect(form.account.primarySalesAttribution).toEqual({
      type: 'INTERNAL_EMPLOYEE',
      subject: null,
    })
  })

  it('rejects incomplete and ambiguous cost rows while sorting valid rows by normalized name', () => {
    expect(
      pricingPolicyErrors({
        defaultPremiumUnitPrice: '0.00',
        defaultDiscountUnitPrice: '0.00',
        thirdPartyIntermediaryFixedUnitCost: '0.00',
        thirdPartyIntermediaryVariableUnitCost: '0.00',
        costItems: [
          {
            name: ' 运输 ',
            basis: 'UNIT_PRICE',
            unitPrice: '1.00',
            orderAmount: '2.00',
          },
          {
            name: '运输',
            basis: 'ORDER_AMOUNT',
            unitPrice: '',
            orderAmount: '0.00',
          },
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        '成本“运输”只能填写单位价格。',
        '成本名称“运输”重复。',
        '成本“运输”的整单金额必须大于 0 且最多两位小数。',
      ]),
    )

    expect(
      sortedCostItems([
        { name: ' 乙 ', basis: 'UNIT_PRICE', unitPrice: '1.00' },
        { name: '甲', basis: 'ORDER_AMOUNT', orderAmount: '2.00' },
      ]).map((item) => item.name),
    ).toEqual(['甲', '乙'])
  })

  it('produces a complete create payload without deprecated flat customer fields', () => {
    const form = createCustomerForm()
    form.group.companyName = '华东集团'
    form.account.name = '华东结算账户'
    form.account.primarySalesAttribution.subject = {
      objectId: 'employee-1',
      versionId: 'employee-v1',
      code: 'EMP-0001',
      name: '张三',
      entity: 'employee',
    }
    form.account.pricingPolicy.costItems = [
      { name: ' 运输 ', basis: 'UNIT_PRICE', unitPrice: '1.00' },
    ]

    const payload = customerCreatePayload(form)

    expect(payload).toMatchObject({
      group: { companyName: '华东集团' },
      data: {
        name: '华东结算账户',
        primarySalesAttribution: {
          type: 'INTERNAL_EMPLOYEE',
          subjectObjectId: 'employee-1',
        },
      },
    })
    expect(payload.data.pricingPolicy.costItems).toEqual([
      { name: '运输', basis: 'UNIT_PRICE', unitPrice: '1.00' },
    ])
    expect(payload.data).not.toHaveProperty('salespersonEmployeeId')
    expect(payload.data).not.toHaveProperty('rebateUnitPrice')
    expect(payload.data).not.toHaveProperty('intermediaryOtherPartyId')
  })
})
