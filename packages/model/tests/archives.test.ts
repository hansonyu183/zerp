import assert from 'node:assert/strict'
import test from 'node:test'

import {
  prepareAccMappingSubmit,
  prepareCustomerSubmit,
  prepareFundAccountSubmit,
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
        pricingUnit: { id: 'unit-1', code: 'EA', name: '件', quantityScale: 0 },
        defaultInputUnit: {
          id: 'unit-1',
          code: 'EA',
          name: '件',
          quantityScale: 0,
        },
        defaultPackageSpec: ' 1 ',
        recyclable: false,
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
        behaviorProfile: 'STANDARD_FINISHED',
      },
      productCategory: { id: 'category', code: 'CAT', name: '分类' },
      pricingUnit: { id: 'unit', code: 'EA', name: '件', quantityScale: 0 },
      defaultInputUnit: {
        id: 'unit',
        code: 'EA',
        name: '件',
        quantityScale: 0,
      },
      defaultPackageSpec: '',
      recyclable: false,
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
          legalIdentifier: ' 91350211M000100Y4J ',
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
        legalIdentifier: ' 91350211M000100Y4J ',
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
            sha256: 'abc',
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
            customerType: '',
            settlementMethod: null,
            receiptMethod: '',
            transportMethod: '',
            pricePolicy: '',
            creditLimits: [],
            salesAttribution: null,
            internalReminder: '',
            defaultOrderRemark: '',
            attachments: [],
            enabled: true,
          },
        ],
        enabled: true,
      },
    },
    newFacts,
  )
  assert.equal(customer.ok, true)
  if (customer.ok)
    assert.equal(customer.plan.data.legalIdentifier, '91350211M000100Y4J')
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
          { name: 'asOf', label: '截至日', type: 'DATE', required: true },
        ],
        columns: [
          {
            alias: 'amount',
            label: '金额',
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
