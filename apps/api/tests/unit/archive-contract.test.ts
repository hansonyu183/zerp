import assert from 'node:assert/strict'
import test from 'node:test'

import { archiveSnapshotSchemas } from '../../src/dcl/archive-contract.ts'
import { auxReferenceCandidateSchema } from '../../src/app/independent-contract.ts'

const id = (seed: string) => seed.padEnd(26, '0').slice(0, 26)

test('measurement-unit reference exposes its authoritative symbol', () => {
  assert.equal(
    auxReferenceCandidateSchema.safeParse({
      objectId: id('unit'),
      code: 'KG',
      name: '千克',
      symbol: 'kg',
      quantityScale: 3,
    }).success,
    true,
  )
  assert.equal(
    auxReferenceCandidateSchema.safeParse({
      objectId: id('settlement'),
      code: 'MONTHLY_30',
      name: '月结 30 天',
      termCode: 'MONTHLY_30',
      ruleType: 'MONTH_END',
      monthOffset: 1,
      dayOfMonth: 0,
      dayOffset: 0,
      defaultSalesSurcharge: '0.10',
    }).success,
    true,
  )
  assert.equal(
    auxReferenceCandidateSchema.safeParse({
      objectId: id('payment'),
      code: 'BANK_TRANSFER',
      name: '银行转账',
      defaultSalesSurcharge: '0.00',
    }).success,
    true,
  )
})

test('operating entity snapshot requires the versioned short name', () => {
  const snapshot = {
    legalName: '测试科技有限公司',
    shortName: '测试科技',
    legalIdentifier: '91350211M000100Y46',
    registeredAddress: '',
    contactName: '',
    contactPhone: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remark: '',
    enabled: true,
  }
  assert.equal(
    archiveSnapshotSchemas['operating-entity'].safeParse(snapshot).success,
    true,
  )
  const { shortName: _, ...withoutShortName } = snapshot
  assert.equal(
    archiveSnapshotSchemas['operating-entity'].safeParse(withoutShortName)
      .success,
    false,
  )
})

test('product snapshot closes unit conversions and fixed formula', () => {
  const kilogram = {
    id: id('unit-kg'),
    code: 'KG',
    name: '千克',
    symbol: 'kg',
    quantityScale: 3,
  }
  const bag = {
    id: id('unit-bag'),
    code: 'BAG',
    name: '袋',
    symbol: '袋',
    quantityScale: 0,
  }
  const snapshot = {
    name: '标准成品',
    barcode: 'PRD-01',
    specification: '',
    model: '',
    productType: {
      id: id('type'),
      code: 'FINISHED',
      name: '自制成品',
      behaviorProfile: 'STANDARD_FINISHED',
    },
    productCategory: { id: id('category'), code: 'CAT', name: '分类' },
    pricingUnit: kilogram,
    defaultInputUnit: bag,
    unitConversions: [
      { unit: kilogram, factor: '1.000000' },
      { unit: bag, factor: '25.000000' },
    ],
    defaultPackagingSpec: '25.000000',
    recyclable: false,
    fixedFormula: {
      output: {
        enteredQuantity: '1.000000',
        enteredUnit: bag,
        baseQuantity: '25.000000',
      },
      components: [
        {
          material: {
            objectId: id('material'),
            approvalEntryId: id('material-entry'),
            code: 'PRD-0002',
            name: '原料',
          },
          quantity: {
            enteredQuantity: '10.000000',
            enteredUnit: kilogram,
            baseQuantity: '10.000000',
          },
          resolutionStatus: 'CURRENT',
          requiresConfirmation: false,
        },
      ],
    },
    remark: '',
    enabled: true,
  }
  assert.equal(archiveSnapshotSchemas.product.safeParse(snapshot).success, true)
  assert.equal(
    archiveSnapshotSchemas.product.safeParse({
      ...snapshot,
      unitConversions: undefined,
    }).success,
    false,
  )
})

test('customer snapshot uses closed typed subunit business policies', () => {
  const snapshot = {
    identityKind: 'MAINLAND_ENTERPRISE',
    legalName: '测试客户有限公司',
    displayName: '测试客户',
    legalIdentifier: '91350211M000100Y46',
    phone: '',
    email: '',
    address: '',
    invoiceTitle: '',
    invoiceAddress: '',
    invoicePhone: '',
    invoiceBank: '',
    invoiceAccount: '',
    remittanceProfiles: [],
    defaultOperatingEntity: null,
    identityAttachments: [],
    subunits: [
      {
        id: id('subunit'),
        intent: 'NEW',
        code: null,
        name: '总部',
        contactName: '',
        address: '',
        customerType: {
          id: id('customer-type'),
          code: 'DIRECT',
          name: '直客',
        },
        settlementMethod: null,
        paymentMethod: null,
        transportPolicy: {
          methodCode: 'DELIVERY',
          methodName: '送货',
          surcharge: '0.00',
        },
        pricingPolicy: {
          defaultPremiumUnitPrice: '0.00',
          defaultDiscountUnitPrice: '0.00',
          costItems: [],
          thirdPartyIntermediaryFixedUnitCost: '0.00',
          thirdPartyIntermediaryVariableUnitCost: '0.00',
        },
        creditLimits: [],
        primarySalesAttribution: {
          type: 'INTERNAL_EMPLOYEE',
          objectId: id('employee'),
          approvalEntryId: id('employee-entry'),
          code: 'EMP-0001',
          name: '业务员',
        },
        internalReminder: '',
        defaultSalesOrderRemark: '',
        attachments: [],
        enabled: true,
      },
    ],
    enabled: true,
  }
  assert.equal(
    archiveSnapshotSchemas.customer.safeParse(snapshot).success,
    true,
  )
  assert.equal(
    archiveSnapshotSchemas.customer.safeParse({
      ...snapshot,
      subunits: [
        {
          ...snapshot.subunits[0],
          pricingPolicy: {
            ...snapshot.subunits[0]!.pricingPolicy,
            arbitrary: true,
          },
        },
      ],
    }).success,
    false,
  )
})
