import { describe, expect, it } from 'vitest'
import {
  createCustomerForm,
  pricingPolicyErrors,
  sortedCostItems,
} from '@/pages/bob/customer/form'
import {
  customerAccountPayload,
  customerCreatePayload,
} from '@/pages/bob/customer/payload'

describe('customer relationship form data', () => {
  it('creates a new Party plus first customer-account by default', () => {
    const form = createCustomerForm()

    expect(form.party).toMatchObject({
      mode: 'NEW',
      kind: 'ORGANIZATION',
      partyId: '',
    })
    expect(form.account.operatingEntity).toBeNull()
    expect(form.account.primarySalesAttribution).toEqual({
      type: 'INTERNAL_EMPLOYEE',
      subject: null,
    })
    expect(form.account).toMatchObject({
      defaultTransportMethodCode: 'SELF_PICKUP',
      defaultTransportMethodName: '客户自提',
      transportSurcharge: '0.00',
    })
  })

  it('builds a create request for an existing Party without legacy customer-group fields', () => {
    const form = createCustomerForm()
    form.party.mode = 'EXISTING'
    form.party.partyId = 'party-1'
    form.account.name = ' 华东结算户 '
    form.account.operatingEntity = {
      objectId: 'ope-1',
      versionId: 'v1',
      code: 'OPE-1',
      name: '华东',
      entity: 'operating-entity',
    }
    form.account.primarySalesAttribution.subject = {
      objectId: 'employee-1',
      versionId: 'v1',
      code: 'EMP-1',
      name: '张三',
      entity: 'employee',
    }

    const payload = customerCreatePayload(form)

    expect(payload).toMatchObject({
      partyId: 'party-1',
      data: {
        name: '华东结算户',
        operatingEntityId: 'ope-1',
        primarySalesAttribution: {
          type: 'INTERNAL_EMPLOYEE',
          subjectObjectId: 'employee-1',
        },
      },
    })
    expect(payload).not.toHaveProperty('group')
    expect(payload.data).not.toHaveProperty('salespersonEmployeeId')
  })

  it('uses sales-partner for both external attribution types', () => {
    const form = createCustomerForm()
    form.account.name = '客户'
    form.account.operatingEntity = {
      objectId: 'ope-1',
      versionId: 'v1',
      code: 'OPE-1',
      name: '经营主体',
      entity: 'operating-entity',
    }
    form.account.primarySalesAttribution = {
      type: 'CHANNEL_PARTNER',
      subject: {
        objectId: 'partner-1',
        versionId: 'v1',
        code: 'SP-1',
        name: '渠道',
        entity: 'sales-partner',
      },
    }

    expect(
      customerAccountPayload(form.account).primarySalesAttribution,
    ).toEqual({
      type: 'CHANNEL_PARTNER',
      subjectObjectId: 'partner-1',
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
})
