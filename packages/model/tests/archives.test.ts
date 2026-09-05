import assert from 'node:assert/strict'
import test from 'node:test'

import {
  prepareAccMappingSubmit,
  prepareCustomerSubmit,
  prepareFundAccountSubmit,
  prepareOperatingEntitySubmit,
  prepareProductSubmit,
  prepareRptDefinitionSubmit,
  prepareSalesPartnerSubmit,
  prepareVehicleSubmit,
  projectRptDefinitionExecutionState,
  type ApprovalActor,
  type ProductSubmitCommand,
  type ProductSubmitFacts,
} from '../src/index.ts'

const actor: ApprovalActor = {
  id: 'user-1',
  permissions: [
    '/dcl/vehicle/submit-new',
    '/dcl/fund-account/submit-new',
    '/dcl/operating-entity/submit-new',
    '/dcl/product/submit-new',
    '/dcl/product/submit-change',
    '/dcl/customer/submit-new',
    '/dcl/sales-partner/submit-new',
    '/dcl/acc-mapping/submit-new',
    '/dcl/rpt-definition/submit-new',
  ],
}

function command(action: 'submit-new' | 'submit-change' = 'submit-new') {
  return {
    action,
    actor,
    requestId: 'request-1',
    occurredAt: '2026-09-04T00:00:00Z',
    submissionId: 'submission-1',
    idempotencyKey: 'submission-1',
    subjectId: 'subject-1',
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
  } as const
}

const newFacts = { subject: { exists: false, history: [] } } as const

test('freezes the operating entity short name in the canonical submission', () => {
  const result = prepareOperatingEntitySubmit(
    {
      ...command(),
      data: {
        legalName: ' 上海测试科技有限公司 ',
        shortName: ' 测试科技 ',
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
      },
    },
    newFacts,
  )

  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.plan.data.shortName, '测试科技')
})

test('requires a complete product unit snapshot and confirmed latest fixed formula', () => {
  const data = {
    name: ' 标准成品 ',
    barcode: ' prd-01 ',
    specification: '',
    model: '',
    productType: {
      id: 'type-1',
      code: 'FINISHED',
      name: '自制成品',
      behaviorProfile: 'STANDARD_FINISHED' as const,
    },
    productCategory: { id: 'category-1', code: 'CAT', name: '分类' },
    pricingUnit: {
      id: 'unit-kg',
      code: 'KG',
      name: '千克',
      symbol: 'kg',
      quantityScale: 3,
    },
    defaultInputUnit: {
      id: 'unit-bag',
      code: 'BAG',
      name: '袋',
      symbol: '袋',
      quantityScale: 0,
    },
    unitConversions: [
      {
        unit: {
          id: 'unit-kg',
          code: 'KG',
          name: '千克',
          symbol: 'kg',
          quantityScale: 3,
        },
        factor: '1.000000',
      },
      {
        unit: {
          id: 'unit-bag',
          code: 'BAG',
          name: '袋',
          symbol: '袋',
          quantityScale: 0,
        },
        factor: '25.000000',
      },
    ],
    defaultPackagingSpec: '25.000000',
    recyclable: false,
    fixedFormula: {
      output: {
        enteredQuantity: '1.000000',
        enteredUnit: {
          id: 'unit-bag',
          code: 'BAG',
          name: '袋',
          symbol: '袋',
          quantityScale: 0,
        },
        baseQuantity: '25.000000',
      },
      components: [
        {
          material: {
            objectId: 'material-1',
            approvalEntryId: 'material-entry-2',
            code: 'PRD-0002',
            name: '原料',
          },
          quantity: {
            enteredQuantity: '10.000000',
            enteredUnit: {
              id: 'unit-kg',
              code: 'KG',
              name: '千克',
              symbol: 'kg',
              quantityScale: 3,
            },
            baseQuantity: '10.000000',
          },
          resolutionStatus: 'CURRENT' as const,
          requiresConfirmation: false,
        },
      ],
    },
    remark: '',
    enabled: true,
  }
  const facts = {
    ...newFacts,
    references: [
      { field: 'productType' as const, objectId: 'type-1', available: true },
      {
        field: 'productCategory' as const,
        objectId: 'category-1',
        available: true,
      },
      { field: 'pricingUnit' as const, objectId: 'unit-kg', available: true },
      {
        field: 'defaultInputUnit' as const,
        objectId: 'unit-bag',
        available: true,
      },
    ],
    materials: [
      {
        objectId: 'material-1',
        latestApprovedEntryId: 'material-entry-2',
        enabled: true,
        behaviorProfile: 'RAW_MATERIAL' as const,
      },
    ],
  }
  const result = prepareProductSubmit({ ...command(), data }, facts)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.plan.data.defaultPackagingSpec, '25.000000')
    assert.equal(result.plan.data.unitConversions.length, 2)
    assert.equal(result.plan.data.fixedFormula?.components.length, 1)
  }

  assert.deepEqual(
    prepareProductSubmit(
      {
        ...command(),
        data: {
          ...data,
          fixedFormula: {
            ...data.fixedFormula,
            components: [
              {
                ...data.fixedFormula.components[0]!,
                material: {
                  ...data.fixedFormula.components[0]!.material,
                  approvalEntryId: 'material-entry-1',
                },
              },
            ],
          },
        },
      },
      facts,
    ),
    {
      ok: false,
      error: {
        errorKey: 'product_reference_stale',
        blockers: [
          {
            field: 'fixedFormula.components[0].material',
            objectId: 'material-1',
            expectedApprovalEntryId: 'material-entry-1',
            currentApprovalEntryId: 'material-entry-2',
          },
        ],
      },
    },
  )
})

test('keeps the complete typed customer aggregate and rejects malformed pricing facts', () => {
  const data = {
    identityKind: 'MAINLAND_ENTERPRISE' as const,
    legalName: ' 测试客户有限公司 ',
    displayName: ' 测试客户 ',
    legalIdentifier: '91350211M000100Y46',
    phone: '021-12345678',
    email: 'contact@example.com',
    address: '上海',
    invoiceTitle: '测试客户有限公司',
    invoiceAddress: '上海',
    invoicePhone: '021-12345678',
    invoiceBank: '测试银行',
    invoiceAccount: ' 6222 0001 ',
    remittanceProfiles: [],
    defaultOperatingEntity: null,
    identityAttachments: [],
    subunits: [
      {
        id: 'subunit-1',
        intent: 'NEW' as const,
        code: null,
        name: ' 总部 ',
        contactName: ' 联系人 ',
        address: ' 业务地址 ',
        customerType: {
          id: 'customer-type-1',
          code: 'DIRECT',
          name: '直客',
        },
        settlementMethod: {
          id: 'settlement-1',
          code: 'MONTHLY_30',
          name: '月结 30 天',
          termCode: 'MONTHLY_30' as const,
          ruleType: 'MONTH_END' as const,
          monthOffset: 1,
          dayOfMonth: 0,
          dayOffset: 0,
          defaultSalesSurcharge: '0.10',
        },
        paymentMethod: {
          id: 'payment-1',
          code: 'BANK_TRANSFER',
          name: '银行转账',
          defaultSalesSurcharge: '0.00',
        },
        transportPolicy: {
          methodCode: 'DELIVERY',
          methodName: '送货',
          surcharge: '0.20',
        },
        pricingPolicy: {
          defaultPremiumUnitPrice: '0.10',
          defaultDiscountUnitPrice: '0.00',
          costItems: [
            {
              name: '装卸',
              calculationBasis: 'ORDER_AMOUNT' as const,
              orderAmount: '20.00',
            },
          ],
          thirdPartyIntermediaryFixedUnitCost: '0.00',
          thirdPartyIntermediaryVariableUnitCost: '0.00',
        },
        creditLimits: [{ currency: 'cny', amount: '1000.00' }],
        primarySalesAttribution: {
          type: 'INTERNAL_EMPLOYEE' as const,
          objectId: 'employee-1',
          approvalEntryId: 'employee-entry-1',
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
  const facts = {
    ...newFacts,
    customerTypes: [{ objectId: 'customer-type-1', available: true }],
    salesAttributions: [
      {
        objectId: 'employee-1',
        latestApprovedEntryId: 'employee-entry-1',
        enabled: true,
        type: 'INTERNAL_EMPLOYEE' as const,
      },
    ],
  }
  const result = prepareCustomerSubmit({ ...command(), data }, facts)
  assert.equal(result.ok, true)
  if (result.ok) {
    const subunit = result.plan.data.subunits[0]!
    assert.equal(subunit.customerType.code, 'DIRECT')
    assert.equal(subunit.paymentMethod?.defaultSalesSurcharge, '0.00')
    assert.equal(subunit.transportPolicy.surcharge, '0.20')
    assert.deepEqual(subunit.pricingPolicy.costItems, [
      {
        name: '装卸',
        calculationBasis: 'ORDER_AMOUNT',
        orderAmount: '20.00',
      },
    ])
  }

  const malformed = prepareCustomerSubmit(
    {
      ...command(),
      data: {
        ...data,
        subunits: [
          {
            ...data.subunits[0]!,
            pricingPolicy: {
              ...data.subunits[0]!.pricingPolicy,
              costItems: [
                {
                  name: '装卸',
                  calculationBasis: 'ORDER_AMOUNT' as const,
                  orderAmount: '0.00',
                },
              ],
            },
          },
        ],
      },
    },
    facts,
  )
  assert.deepEqual(malformed, {
    ok: false,
    error: { errorKey: 'customer_invalid_data' },
  })

  assert.deepEqual(
    prepareCustomerSubmit(
      {
        ...command(),
        data: { ...data, legalIdentifier: '91350211M000100Y40' },
      },
      facts,
    ),
    { ok: false, error: { errorKey: 'customer_invalid_data' } },
  )
})

test('prepares typed archive submissions with canonical payloads and exact permissions', () => {
  const vehicle = prepareVehicleSubmit(
    {
      ...command(),
      data: {
        name: ' 配送车 ',
        plateNumber: ' 沪 A-12345 ',
        vehicleType: { id: 'vehicle-type-1', code: 'VAN', name: ' 厢货 ' },
        carrier: {
          kind: 'INTERNAL',
          operatingEntityId: 'oe-1',
          approvalEntryId: 'oe-entry-1',
        },
        vin: ' lsv123 ',
        engineNumber: ' eng-1 ',
        ratedLoadKg: 1000,
        bulkWaterCarrier: false,
        remark: ' 备注 ',
        enabled: true,
      },
    },
    {
      ...newFacts,
      operatingEntity: {
        objectId: 'oe-1',
        latestApprovedEntryId: 'oe-entry-1',
        enabled: true,
      },
    },
  )
  assert.equal(vehicle.ok, true)
  if (vehicle.ok) {
    assert.equal(vehicle.plan.data.plateNumber, '沪A-12345')
    assert.equal(vehicle.plan.data.vin, 'LSV123')
  }

  const fundAccount = prepareFundAccountSubmit(
    {
      ...command(),
      data: {
        name: ' 基本户 ',
        currency: ' cny ',
        accountName: ' ZERP ',
        bank: ' 银行 ',
        branch: ' 支行 ',
        accountNumber: ' cn-12 34 ',
        remark: ' 备注 ',
        enabled: true,
        operatingEntity: {
          objectId: 'oe-1',
          approvalEntryId: 'oe-entry-1',
          code: 'OE-1',
          name: '主体',
        },
      },
    },
    {
      ...newFacts,
      operatingEntity: {
        objectId: 'oe-1',
        latestApprovedEntryId: 'oe-entry-1',
        enabled: true,
      },
    },
  )
  assert.equal(fundAccount.ok, true)
  if (fundAccount.ok)
    assert.equal(fundAccount.plan.data.accountNumber, 'CN1234')

  const product = prepareProductSubmit(
    {
      ...command(),
      data: {
        name: ' 产品 ',
        barcode: ' ab-12 ',
        specification: ' 500ml ',
        model: ' M1 ',
        productType: {
          id: 'type-1',
          code: 'TYPE',
          name: '类型',
          behaviorProfile: 'STANDARD_FINISHED',
        },
        productCategory: { id: 'category-1', code: 'CAT', name: '分类' },
        pricingUnit: {
          id: 'unit-1',
          code: 'EA',
          name: '件',
          symbol: '件',
          quantityScale: 0,
        },
        defaultInputUnit: {
          id: 'unit-1',
          code: 'EA',
          name: '件',
          symbol: '件',
          quantityScale: 0,
        },
        unitConversions: [
          {
            unit: {
              id: 'unit-1',
              code: 'EA',
              name: '件',
              symbol: '件',
              quantityScale: 0,
            },
            factor: '1.000000',
          },
        ],
        defaultPackagingSpec: ' 1.000000 ',
        recyclable: false,
        fixedFormula: {
          output: {
            enteredQuantity: '1.000000',
            enteredUnit: {
              id: 'unit-1',
              code: 'EA',
              name: '件',
              symbol: '件',
              quantityScale: 0,
            },
            baseQuantity: '1.000000',
          },
          components: [
            {
              material: {
                objectId: 'material-1',
                approvalEntryId: 'material-entry-1',
                code: 'PRD-0002',
                name: '原料',
              },
              quantity: {
                enteredQuantity: '1.000000',
                enteredUnit: {
                  id: 'unit-1',
                  code: 'EA',
                  name: '件',
                  symbol: '件',
                  quantityScale: 0,
                },
                baseQuantity: '1.000000',
              },
              resolutionStatus: 'CURRENT',
              requiresConfirmation: false,
            },
          ],
        },
        remark: ' ',
        enabled: true,
      },
    },
    {
      ...newFacts,
      references: [
        { field: 'productType', objectId: 'type-1', available: true },
        { field: 'productCategory', objectId: 'category-1', available: true },
        { field: 'pricingUnit', objectId: 'unit-1', available: true },
        { field: 'defaultInputUnit', objectId: 'unit-1', available: true },
      ],
      materials: [
        {
          objectId: 'material-1',
          latestApprovedEntryId: 'material-entry-1',
          enabled: true,
          behaviorProfile: 'RAW_MATERIAL',
        },
      ],
    },
  )
  assert.equal(product.ok, true)
  if (product.ok) assert.equal(product.plan.data.barcode, 'AB-12')
})

test('returns exact stale or unavailable reference blockers', () => {
  assert.deepEqual(
    prepareVehicleSubmit(
      {
        ...command(),
        data: {
          name: '车',
          plateNumber: '沪A1',
          vehicleType: { id: 'type', code: 'T', name: '类型' },
          carrier: {
            kind: 'EXTERNAL',
            otherUnitId: 'other-1',
            approvalEntryId: 'other-old',
          },
          vin: '',
          engineNumber: '',
          ratedLoadKg: 0,
          bulkWaterCarrier: false,
          remark: '',
          enabled: true,
        },
      },
      {
        ...newFacts,
        otherUnit: {
          objectId: 'other-1',
          latestApprovedEntryId: 'other-now',
          enabled: true,
        },
      },
    ),
    {
      ok: false,
      error: {
        errorKey: 'vehicle_reference_stale',
        blockers: [
          {
            field: 'carrier',
            objectId: 'other-1',
            expectedApprovalEntryId: 'other-old',
            currentApprovalEntryId: 'other-now',
          },
        ],
      },
    },
  )
})

test('rechecks exact submit permission, one open version, latest approval revision, and submission idempotency', () => {
  const productCommand: ProductSubmitCommand = {
    ...command('submit-change'),
    expectedLatestApprovedSubmissionId: 'approved-2',
    expectedLatestApprovedRevision: '7',
    data: {
      name: '产品',
      barcode: 'barcode',
      specification: '',
      model: '',
      productType: {
        id: 'type',
        code: 'TYPE',
        name: '类型',
        behaviorProfile: 'RAW_MATERIAL',
      },
      productCategory: { id: 'category', code: 'CAT', name: '分类' },
      pricingUnit: {
        id: 'unit',
        code: 'EA',
        name: '件',
        symbol: '件',
        quantityScale: 0,
      },
      defaultInputUnit: {
        id: 'unit',
        code: 'EA',
        name: '件',
        symbol: '件',
        quantityScale: 0,
      },
      unitConversions: [
        {
          unit: {
            id: 'unit',
            code: 'EA',
            name: '件',
            symbol: '件',
            quantityScale: 0,
          },
          factor: '1.000000',
        },
      ],
      defaultPackagingSpec: '1.000000',
      recyclable: false,
      fixedFormula: null,
      remark: '',
      enabled: true,
    },
  }
  const productFacts: ProductSubmitFacts = {
    subject: {
      exists: true,
      history: [
        {
          entryId: 'approved-2',
          versionNo: 2,
          revision: '7',
          status: 'APPROVED' as const,
        },
      ],
    },
    references: [
      { field: 'productType' as const, objectId: 'type', available: true },
      {
        field: 'productCategory' as const,
        objectId: 'category',
        available: true,
      },
      { field: 'pricingUnit' as const, objectId: 'unit', available: true },
      { field: 'defaultInputUnit' as const, objectId: 'unit', available: true },
    ],
    materials: [],
  }
  assert.equal(prepareProductSubmit(productCommand, productFacts).ok, true)
  assert.deepEqual(
    prepareProductSubmit(
      {
        ...productCommand,
        actor: { ...actor, permissions: ['/dcl/product/submit-new'] },
      },
      productFacts,
    ),
    { ok: false, error: { errorKey: 'approval_invalid_action' } },
  )
  assert.deepEqual(
    prepareProductSubmit(
      { ...productCommand, idempotencyKey: 'another' },
      productFacts,
    ),
    { ok: false, error: { errorKey: 'archive_invalid_command' } },
  )
  assert.deepEqual(
    prepareProductSubmit(productCommand, {
      ...productFacts,
      subject: {
        ...productFacts.subject,
        history: [
          ...productFacts.subject.history,
          {
            entryId: 'open-3',
            versionNo: 3,
            revision: '1',
            status: 'PENDING' as const,
          },
        ],
      },
    }),
    { ok: false, error: { errorKey: 'approval_open_version_exists' } },
  )
  assert.deepEqual(
    prepareProductSubmit(productCommand, {
      ...productFacts,
      subject: {
        ...productFacts.subject,
        history: [
          {
            entryId: 'approved-2',
            versionNo: 2,
            revision: '8',
            status: 'APPROVED' as const,
          },
        ],
      },
    }),
    { ok: false, error: { errorKey: 'archive_stale_facts' } },
  )
})

test('enforces sales partner capabilities, customer subunits, and legal identifier canonicalization', () => {
  assert.deepEqual(
    prepareSalesPartnerSubmit(
      {
        ...command(),
        data: {
          identityKind: 'ORGANIZATION',
          legalName: '销售方',
          displayName: '销售方',
          legalIdentifier: ' 91350211M000100Y46 ',
          contactName: '',
          phone: '',
          address: '',
          operatingEntities: [],
          defaultOperatingEntityId: null,
          capabilities: [],
          remark: '',
          enabled: true,
        },
      },
      { ...newFacts, operatingEntities: [] },
    ),
    { ok: false, error: { errorKey: 'sales_partner_invalid_data' } },
  )
  const customer = prepareCustomerSubmit(
    {
      ...command(),
      data: {
        identityKind: 'MAINLAND_ENTERPRISE',
        legalName: '客户',
        displayName: '客户',
        legalIdentifier: ' 91350211M000100Y46 ',
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
        identityAttachments: [
          {
            id: 'att-1',
            fileName: '执照.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1,
            sha256: 'a'.repeat(64),
          },
        ],
        subunits: [
          {
            id: 'sub-1',
            intent: 'EXISTING',
            code: 'SUB-0001',
            name: '总部',
            contactName: '',
            address: '',
            customerType: {
              id: 'customer-type-1',
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
              objectId: 'employee-1',
              approvalEntryId: 'employee-entry-1',
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
      },
    },
    {
      ...newFacts,
      customerTypes: [{ objectId: 'customer-type-1', available: true }],
      salesAttributions: [
        {
          objectId: 'employee-1',
          latestApprovedEntryId: 'employee-entry-1',
          enabled: true,
          type: 'INTERNAL_EMPLOYEE',
        },
      ],
    },
  )
  assert.equal(customer.ok, true)
  if (customer.ok)
    assert.equal(customer.plan.data.legalIdentifier, '91350211M000100Y46')
})

test('keeps ACC and RPT payloads typed and frozen in their plans', () => {
  const mapping = prepareAccMappingSubmit(
    {
      ...command(),
      data: {
        book: { id: 'book-1', code: 'BOOK', name: '账簿' },
        vouEntity: { id: 'sale-order', code: 'sale-order', name: '销售订单' },
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [],
          templates: [],
          assetConfiguration: null,
        },
      },
    },
    {
      ...newFacts,
      book: { id: 'book-1', enabled: true },
      vouEntity: { id: 'sale-order', enabled: true },
      fieldCatalog: { headerFields: ['status'], lineFields: [] },
      accounts: [],
    },
  )
  assert.equal(mapping.ok, true)

  const rpt = prepareRptDefinitionSubmit(
    {
      ...command(),
      data: {
        name: ' 报表 ',
        description: ' 描述 ',
        enabled: true,
        sql: 'SELECT 1 AS amount',
        parameters: [
          { key: 'asOf', name: '截至日', type: 'DATE', required: true },
          {
            key: 'status',
            name: '状态',
            type: 'ENUM',
            required: false,
            defaultValue: 'OPEN',
            enumValues: ['OPEN', 'CLOSED'],
          },
          {
            key: 'customerId',
            name: '客户子单位',
            type: 'REFERENCE',
            required: false,
            referenceType: 'CUSTOMER_SUBUNIT',
          },
        ],
        columns: [
          {
            alias: 'amount',
            name: '金额',
            order: 1,
            type: 'DECIMAL',
            width: 120,
            visible: true,
            format: 'MONEY',
          },
        ],
      },
    },
    newFacts,
  )
  assert.equal(rpt.ok, true)
  if (rpt.ok) {
    assert.deepEqual(rpt.plan.data.parameters[1], {
      key: 'status',
      name: '状态',
      type: 'ENUM',
      required: false,
      defaultValue: 'OPEN',
      enumValues: ['OPEN', 'CLOSED'],
    })
  }
  const invalidRpt = prepareRptDefinitionSubmit(
    {
      ...command(),
      data: {
        name: '无效参数',
        description: '',
        enabled: true,
        sql: 'SELECT 1 AS total',
        parameters: [
          { key: 'status', name: '状态', type: 'ENUM', required: true },
        ],
        columns: [
          {
            alias: 'total',
            name: '总数',
            order: 1,
            type: 'INTEGER',
            width: 120,
            visible: true,
          },
        ],
      },
    },
    newFacts,
  )
  assert.deepEqual(invalidRpt, {
    ok: false,
    error: { errorKey: 'rpt_definition_invalid_data' },
  })
})

test('rejects a fixed mapping subject whose dimensions do not match its required dimensions', () => {
  const mapping = prepareAccMappingSubmit(
    {
      ...command(),
      data: {
        book: { id: 'book-1', code: 'BOOK', name: '账簿' },
        vouEntity: { id: 'vou-1', code: 'SALE', name: '销售订单' },
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [],
          templates: [
            {
              templateId: 'sale-post',
              collection: null,
              lines: [
                {
                  subjectSource: 'FIXED',
                  subjectValue: 'account-1',
                  direction: 'DEBIT',
                  amountField: 'amount',
                  currencyField: 'currency',
                  dimensions: {},
                  quantityField: null,
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
                {
                  subjectSource: 'FIELD',
                  subjectValue: 'lineSubject',
                  direction: 'CREDIT',
                  amountField: 'amount',
                  currencyField: 'currency',
                  dimensions: {},
                  quantityField: null,
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
              ],
            },
          ],
          assetConfiguration: null,
        },
      },
    },
    {
      ...newFacts,
      book: { id: 'book-1', enabled: true },
      vouEntity: { id: 'vou-1', enabled: true },
      fieldCatalog: {
        headerFields: ['currency'],
        lineFields: ['amount', 'lineSubject', 'customer'],
      },
      accounts: [
        {
          id: 'account-1',
          bookId: 'book-1',
          enabled: true,
          leaf: true,
          requiredDimensions: ['customer'],
        },
      ],
    },
  )
  assert.equal(mapping.ok, false)
  if (!mapping.ok)
    assert.equal(mapping.error.errorKey, 'acc_mapping_invalid_data')
})

test('rejects ACC counterpart and asset dimensions that differ from their fixed subjects', () => {
  const input: Parameters<typeof prepareAccMappingSubmit>[0] = {
    ...command(),
    data: {
      book: { id: 'book-1', code: 'BOOK', name: '账簿' },
      vouEntity: { id: 'vou-1', code: 'SALE', name: '销售订单' },
      defaultResult: 'UN_POST',
      definition: {
        defaultTemplateId: null,
        rules: [],
        templates: [
          {
            templateId: 'sale-post',
            collection: null,
            lines: [
              {
                subjectSource: 'FIXED',
                subjectValue: 'main-account',
                direction: 'DEBIT',
                amountField: 'amount',
                currencyField: 'currency',
                dimensions: { customer: 'customer' },
                quantityField: null,
                costCounterpartSubjectId: 'counterpart-account',
                costCounterpartDimensions: { department: 'department' },
              },
              {
                subjectSource: 'FIELD',
                subjectValue: 'lineSubject',
                direction: 'CREDIT',
                amountField: 'amount',
                currencyField: 'currency',
                dimensions: {},
                quantityField: null,
                costCounterpartSubjectId: null,
                costCounterpartDimensions: {},
              },
            ],
          },
        ],
        assetConfiguration: {
          assetSubjectId: 'asset-account',
          assetDimensions: {},
          accumulatedDepreciationSubjectId: 'accumulated-account',
          accumulatedDepreciationDimensions: { department: 'department' },
          depreciationExpenseSubjectId: 'expense-account',
          depreciationExpenseDimensions: {},
        },
      },
    },
  }
  const facts: Parameters<typeof prepareAccMappingSubmit>[1] = {
    ...newFacts,
    book: { id: 'book-1', enabled: true },
    vouEntity: { id: 'vou-1', enabled: true },
    fieldCatalog: {
      headerFields: ['currency'],
      lineFields: ['amount', 'lineSubject', 'customer', 'department'],
    },
    accounts: [
      {
        id: 'main-account',
        bookId: 'book-1',
        enabled: true,
        leaf: true,
        requiredDimensions: ['customer'],
      },
      {
        id: 'counterpart-account',
        bookId: 'book-1',
        enabled: true,
        leaf: true,
        requiredDimensions: ['department'],
      },
      {
        id: 'asset-account',
        bookId: 'book-1',
        enabled: true,
        leaf: true,
        requiredDimensions: [],
      },
      {
        id: 'accumulated-account',
        bookId: 'book-1',
        enabled: true,
        leaf: true,
        requiredDimensions: ['department'],
      },
      {
        id: 'expense-account',
        bookId: 'book-1',
        enabled: true,
        leaf: true,
        requiredDimensions: [],
      },
    ],
  }
  assert.equal(prepareAccMappingSubmit(input, facts).ok, true)

  const nullCounterpart = structuredClone(input)
  nullCounterpart.data.definition.templates[0]!.lines[1]!.costCounterpartDimensions =
    {
      customer: 'customer',
    }
  assert.equal(prepareAccMappingSubmit(nullCounterpart, facts).ok, false)

  const mismatchedCounterpart = structuredClone(input)
  mismatchedCounterpart.data.definition.templates[0]!.lines[0]!.costCounterpartDimensions =
    {
      customer: 'customer',
    }
  assert.equal(prepareAccMappingSubmit(mismatchedCounterpart, facts).ok, false)

  const mismatchedAsset = structuredClone(input)
  mismatchedAsset.data.definition.assetConfiguration!.accumulatedDepreciationDimensions =
    {}
  assert.equal(prepareAccMappingSubmit(mismatchedAsset, facts).ok, false)
})

test('validates full MappingDefinition facts and keeps RPT validity separate from Approval', () => {
  const valid = prepareAccMappingSubmit(
    {
      ...command(),
      data: {
        book: { id: 'book-1', code: 'BOOK', name: '账簿' },
        vouEntity: { id: 'vou-1', code: 'SALE', name: '销售订单' },
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [
            {
              conditions: [
                { field: 'header.status', operator: 'EQ', values: ['READY'] },
              ],
              result: 'POST',
              templateId: 'sale-post',
            },
          ],
          templates: [
            {
              templateId: 'sale-post',
              collection: 'lines',
              lines: [
                {
                  subjectSource: 'FIXED',
                  subjectValue: 'account-1',
                  direction: 'DEBIT',
                  amountField: 'lines.amount',
                  currencyField: 'header.currency',
                  dimensions: { customer: 'header.customerId' },
                  quantityField: 'lines.quantity',
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
                {
                  subjectSource: 'FIELD',
                  subjectValue: 'lines.subjectId',
                  direction: 'CREDIT',
                  amountField: 'lines.amount',
                  currencyField: 'header.currency',
                  dimensions: {},
                  quantityField: null,
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
              ],
            },
          ],
          assetConfiguration: {
            assetSubjectId: 'asset-account',
            assetDimensions: {},
            accumulatedDepreciationSubjectId: 'accumulated-account',
            accumulatedDepreciationDimensions: {},
            depreciationExpenseSubjectId: 'expense-account',
            depreciationExpenseDimensions: {},
          },
        },
      },
    },
    {
      ...newFacts,
      book: { id: 'book-1', enabled: true },
      vouEntity: { id: 'vou-1', enabled: true },
      fieldCatalog: {
        headerFields: ['header.status', 'header.currency', 'header.customerId'],
        lineFields: [
          'lines.amount',
          'lines.quantity',
          'lines.unitId',
          'lines.assetCategoryId',
          'lines.subjectId',
        ],
      },
      accounts: [
        {
          id: 'account-1',
          bookId: 'book-1',
          enabled: true,
          leaf: true,
          requiredDimensions: ['customer'],
        },
        {
          id: 'asset-account',
          bookId: 'book-1',
          enabled: true,
          leaf: true,
          requiredDimensions: [],
        },
        {
          id: 'accumulated-account',
          bookId: 'book-1',
          enabled: true,
          leaf: true,
          requiredDimensions: [],
        },
        {
          id: 'expense-account',
          bookId: 'book-1',
          enabled: true,
          leaf: true,
          requiredDimensions: [],
        },
      ],
    },
  )
  assert.equal(valid.ok, true)
  assert.deepEqual(
    projectRptDefinitionExecutionState(
      'APPROVED',
      { enabled: true },
      {
        status: 'INVALID',
        diagnostic: 'schema drift',
        validatedAt: '2026-09-04T00:00:00Z',
        validatedBy: 'system',
      },
    ),
    {
      approvalStatus: 'APPROVED',
      enabled: true,
      validity: {
        status: 'INVALID',
        diagnostic: 'schema drift',
        validatedAt: '2026-09-04T00:00:00Z',
        validatedBy: 'system',
      },
      executable: false,
    },
  )
})
