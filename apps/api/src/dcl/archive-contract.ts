import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
  z,
} from '@hono/zod-openapi'
import type { TargetRouteEnvironment } from '../app/contract.ts'
import { archiveEntityPresentation } from '@zerp/model'

export const archiveEntities = [
  'operating-entity',
  'vehicle',
  'fund-account',
  'product',
  'employee',
  'supplier',
  'customer',
  'other-unit',
  'sales-partner',
  'acc-mapping',
  'rpt-definition',
] as const

export type ArchiveEntity = (typeof archiveEntities)[number]

export const archiveActions = [
  'query',
  'get',
  'versions',
  'audit-history',
  'submit-new',
  'submit-change',
  'approve',
  'reject',
  'unreject',
  'unapprove',
  'delete',
] as const

export type ArchiveAction = (typeof archiveActions)[number]

const exactReference = z
  .object({
    objectId: z.string().min(1).max(26),
    approvalEntryId: z.string().length(26),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
  })
  .strict()

const auxSnapshot = z
  .object({
    id: z.string().min(1).max(26),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
  })
  .strict()

const identityKind = z.enum([
  'MAINLAND_ENTERPRISE',
  'MAINLAND_INDIVIDUAL',
  'OTHER',
])

const operatingEntitySnapshot = z
  .object({
    legalName: z.string().min(1).max(200),
    shortName: z.string().max(100),
    legalIdentifier: z.string().max(128),
    registeredAddress: z.string().max(500),
    contactName: z.string().max(100),
    contactPhone: z.string().max(32),
    invoiceTitle: z.string().max(200),
    invoiceAddress: z.string().max(500),
    invoicePhone: z.string().max(32),
    invoiceBank: z.string().max(200),
    invoiceAccount: z.string().max(128),
    remark: z.string().max(1000),
    enabled: z.boolean(),
  })
  .strict()

const vehicleSnapshot = z
  .object({
    name: z.string().min(1).max(200),
    plateNumber: z.string().max(64),
    vehicleType: auxSnapshot,
    carrier: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('INTERNAL'),
          operatingEntityId: z.string().length(26),
          approvalEntryId: z.string().length(26),
        })
        .strict(),
      z
        .object({
          kind: z.literal('EXTERNAL'),
          otherUnitId: z.string().length(26),
          approvalEntryId: z.string().length(26),
        })
        .strict(),
    ]),
    vin: z.string().max(64),
    engineNumber: z.string().max(64),
    ratedLoadKg: z.number().nonnegative(),
    bulkWaterCarrier: z.boolean(),
    remark: z.string().max(1000),
    enabled: z.boolean(),
  })
  .strict()

const fundAccountSnapshot = z
  .object({
    name: z.string().min(1).max(200),
    currency: z.string().min(1).max(16),
    accountName: z.string().min(1).max(200),
    bank: z.string().min(1).max(200),
    branch: z.string().max(200),
    accountNumber: z.string().min(1).max(128),
    operatingEntity: exactReference,
    remark: z.string().max(1000),
    enabled: z.boolean(),
  })
  .strict()

const quantityUnit = auxSnapshot
  .extend({
    symbol: z.string().min(1).max(32),
    quantityScale: z.number().int().min(0).max(12),
  })
  .strict()
const productType = auxSnapshot
  .extend({
    behaviorProfile: z.enum([
      'RAW_MATERIAL',
      'STANDARD_FINISHED',
      'CUSTOM_FINISHED',
      'PACKAGING',
    ]),
  })
  .strict()
const positiveDecimal = z
  .string()
  .regex(/^(?:0*[1-9]\d*)(?:\.\d+)?$|^0*\.\d*[1-9]\d*$/)
const productQuantity = z
  .object({
    enteredQuantity: positiveDecimal,
    enteredUnit: quantityUnit,
    baseQuantity: positiveDecimal,
  })
  .strict()
const productFixedFormula = z
  .object({
    output: productQuantity,
    components: z
      .array(
        z
          .object({
            material: exactReference,
            quantity: productQuantity,
            resolutionStatus: z.enum(['CURRENT', 'UNRESOLVED']),
            requiresConfirmation: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
const productSnapshot = z
  .object({
    name: z.string().min(1).max(200),
    barcode: z.string().max(128),
    specification: z.string().max(200),
    model: z.string().max(200),
    productType,
    productCategory: auxSnapshot,
    pricingUnit: quantityUnit,
    defaultInputUnit: quantityUnit,
    unitConversions: z
      .array(z.object({ unit: quantityUnit, factor: positiveDecimal }).strict())
      .min(1),
    defaultPackagingSpec: z.string().max(64),
    recyclable: z.boolean(),
    fixedFormula: productFixedFormula.nullable(),
    remark: z.string().max(1000),
    enabled: z.boolean(),
  })
  .strict()

const employeeSnapshot = z
  .object({
    identityKind: z.enum(['PERSON', 'ORGANIZATION']),
    legalName: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    legalIdentifier: z.string().max(128),
    contactName: z.string().max(100),
    phone: z.string().max(32),
    address: z.string().max(500),
    employeeCategory: auxSnapshot,
    department: auxSnapshot,
    position: auxSnapshot,
    employmentDate: z.string().date(),
    workPhone: z.string().max(32),
    workEmail: z.string().max(320),
    operatingEntity: exactReference,
    remark: z.string().max(1000),
    enabled: z.boolean(),
  })
  .strict()

// Settlement methods are AUX facts. They intentionally do not carry an
// Approval Entry: a DCL exact-version reference here would fabricate history.
// ArchiveService replaces any client-supplied identity with these immutable
// term facts from the currently enabled AUX object before persistence.
const settlementSnapshot = auxSnapshot.extend({
  termCode: z
    .enum([
      'PREPAID',
      'CASH_ON_DELIVERY',
      'ARRIVAL_3',
      'ARRIVAL_5',
      'ARRIVAL_7',
      'ARRIVAL_15',
      'ARRIVAL_30',
      'MONTHLY_CURRENT',
      'MONTHLY_30',
      'MONTHLY_60',
      'MONTHLY_90',
    ])
    .optional(),
  ruleType: z.enum(['RELATIVE_DAYS', 'MONTH_END']).optional(),
  monthOffset: z.number().int().min(0).max(3).optional(),
  dayOfMonth: z.number().int().min(0).max(31).optional(),
  dayOffset: z.number().int().min(0).max(30).optional(),
})
const customerSettlementSnapshot = settlementSnapshot
  .extend({
    termCode: z.enum([
      'PREPAID',
      'CASH_ON_DELIVERY',
      'ARRIVAL_3',
      'ARRIVAL_5',
      'ARRIVAL_7',
      'ARRIVAL_15',
      'ARRIVAL_30',
      'MONTHLY_CURRENT',
      'MONTHLY_30',
      'MONTHLY_60',
      'MONTHLY_90',
    ]),
    ruleType: z.enum(['RELATIVE_DAYS', 'MONTH_END']),
    monthOffset: z.number().int().min(0).max(3),
    dayOfMonth: z.number().int().min(0).max(31),
    dayOffset: z.number().int().min(0).max(30),
    defaultSalesSurcharge: z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/),
  })
  .strict()
const paymentMethodSnapshot = auxSnapshot
  .extend({
    defaultSalesSurcharge: z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/),
  })
  .strict()
const archiveIdentityBase = {
  identityKind: z.enum(['PERSON', 'ORGANIZATION']),
  legalName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  legalIdentifier: z.string().max(128),
  contactName: z.string().max(100),
  phone: z.string().max(32),
  address: z.string().max(500),
  operatingEntities: z.array(exactReference),
  defaultOperatingEntityId: z.string().length(26).nullable(),
  remark: z.string().max(1000),
  enabled: z.boolean(),
} as const

const supplierSnapshot = z
  .object({
    ...archiveIdentityBase,
    settlementMethod: settlementSnapshot.nullable(),
    defaultPurchaser: exactReference.nullable(),
  })
  .strict()

const otherUnitSnapshot = z
  .object({
    ...archiveIdentityBase,
    settlementMethod: settlementSnapshot.nullable(),
  })
  .strict()

const salesPartnerSnapshot = z
  .object({
    ...archiveIdentityBase,
    capabilities: z.array(z.enum(['EXTERNAL_PART_TIME', 'CHANNEL_PARTNER'])),
  })
  .strict()

const attachmentMetadata = z
  .object({
    id: z.string().length(26),
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1).max(128),
    sizeBytes: z.number().int().positive().max(10_485_760),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    stagingId: z.string().length(26).optional(),
  })
  .strict()

const pricingCostItem = z.discriminatedUnion('calculationBasis', [
  z
    .object({
      name: z.string().trim().min(1).max(200),
      calculationBasis: z.literal('UNIT_PRICE'),
      unitPrice: z.string().regex(/^(?:0*[1-9]\d*)\.\d{2}$/),
    })
    .strict(),
  z
    .object({
      name: z.string().trim().min(1).max(200),
      calculationBasis: z.literal('ORDER_AMOUNT'),
      orderAmount: z.string().regex(/^(?:0*[1-9]\d*)\.\d{2}$/),
    })
    .strict(),
])
const pricingPolicy = z
  .object({
    defaultPremiumUnitPrice: z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/),
    defaultDiscountUnitPrice: z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/),
    costItems: z.array(pricingCostItem),
    thirdPartyIntermediaryFixedUnitCost: z
      .string()
      .regex(/^(?:0|[1-9]\d*)\.\d{2}$/),
    thirdPartyIntermediaryVariableUnitCost: z
      .string()
      .regex(/^(?:0|[1-9]\d*)\.\d{2}$/),
  })
  .strict()
const customerSalesAttribution = exactReference
  .extend({
    type: z.enum([
      'INTERNAL_EMPLOYEE',
      'EXTERNAL_PART_TIME',
      'CHANNEL_PARTNER',
    ]),
  })
  .strict()
const customerSubunitBase = {
  id: z.string().length(26),
  name: z.string().min(1).max(200),
  contactName: z.string().max(100),
  address: z.string().max(500),
  customerType: auxSnapshot,
  settlementMethod: customerSettlementSnapshot.nullable(),
  paymentMethod: paymentMethodSnapshot.nullable(),
  transportPolicy: z
    .object({
      methodCode: z.string().min(1).max(64),
      methodName: z.string().min(1).max(200),
      surcharge: z.string().regex(/^(?:0|[1-9]\d*)\.\d{2}$/),
    })
    .strict(),
  pricingPolicy,
  creditLimits: z.array(
    z
      .object({ currency: z.string().min(1).max(16), amount: z.string() })
      .strict(),
  ),
  primarySalesAttribution: customerSalesAttribution,
  internalReminder: z.string().max(1000),
  defaultSalesOrderRemark: z.string().max(1000),
  attachments: z.array(attachmentMetadata),
  enabled: z.boolean(),
} as const
const customerSubunit = z.discriminatedUnion('intent', [
  z
    .object({
      ...customerSubunitBase,
      intent: z.literal('NEW'),
      code: z.null(),
    })
    .strict(),
  z
    .object({
      ...customerSubunitBase,
      intent: z.literal('EXISTING'),
      code: z.string().regex(/^SUB-\d{4}$/),
    })
    .strict(),
])

const customerSnapshot = z
  .object({
    identityKind,
    legalName: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    legalIdentifier: z.string().max(128),
    phone: z.string().max(32),
    email: z.string().max(320),
    address: z.string().max(500),
    invoiceTitle: z.string().max(200),
    invoiceAddress: z.string().max(500),
    invoicePhone: z.string().max(32),
    invoiceBank: z.string().max(200),
    invoiceAccount: z.string().max(128),
    remittanceProfiles: z.array(
      z
        .object({
          payerName: z.string().min(1).max(200),
          bank: z.string().max(200),
          accountNumber: z.string().max(128),
        })
        .strict(),
    ),
    defaultOperatingEntity: exactReference.nullable(),
    identityAttachments: z.array(attachmentMetadata),
    subunits: z.array(customerSubunit).min(1),
    enabled: z.boolean(),
  })
  .strict()

const accMappingSnapshot = z
  .object({
    book: auxSnapshot,
    vouEntity: auxSnapshot,
    defaultResult: z.enum(['POST', 'UN_POST']),
    definition: z
      .object({
        defaultTemplateId: z.string().min(1).max(64).nullable(),
        rules: z.array(
          z
            .object({
              conditions: z
                .array(
                  z
                    .object({
                      field: z.string().min(1).max(128),
                      operator: z.enum([
                        'EQ',
                        'NE',
                        'IN',
                        'NOT_IN',
                        'IS_EMPTY',
                        'IS_NOT_EMPTY',
                      ]),
                      values: z.array(z.string().min(1).max(256)),
                    })
                    .strict(),
                )
                .min(1),
              result: z.enum(['POST', 'UN_POST']),
              templateId: z.string().min(1).max(64).nullable(),
            })
            .strict(),
        ),
        templates: z.array(
          z
            .object({
              templateId: z.string().min(1).max(64),
              collection: z.string().min(1).max(128).nullable(),
              lines: z
                .array(
                  z
                    .object({
                      subjectSource: z.enum(['FIXED', 'FIELD']),
                      subjectValue: z.string().min(1).max(128),
                      direction: z.enum(['DEBIT', 'CREDIT']),
                      amountField: z.string().min(1).max(128),
                      currencyField: z.string().min(1).max(128),
                      dimensions: z.record(z.string(), z.string()),
                      quantityField: z.string().min(1).max(128).nullable(),
                      costCounterpartSubjectId: z
                        .string()
                        .length(26)
                        .nullable(),
                      costCounterpartDimensions: z.record(
                        z.string(),
                        z.string(),
                      ),
                    })
                    .strict(),
                )
                .min(2),
            })
            .strict(),
        ),
        assetConfiguration: z
          .object({
            assetSubjectId: z.string().length(26),
            assetDimensions: z.record(z.string(), z.string()),
            accumulatedDepreciationSubjectId: z.string().length(26),
            accumulatedDepreciationDimensions: z.record(z.string(), z.string()),
            depreciationExpenseSubjectId: z.string().length(26),
            depreciationExpenseDimensions: z.record(z.string(), z.string()),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict()

const rptDefinitionSnapshot = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000),
    enabled: z.boolean(),
    sql: z.string().min(1),
    parameters: z.array(
      z
        .object({
          key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/),
          name: z.string().min(1).max(100),
          type: z.enum([
            'TEXT',
            'INTEGER',
            'DECIMAL',
            'BOOLEAN',
            'DATE',
            'DATE_RANGE',
            'ENUM',
            'REFERENCE',
          ]),
          required: z.boolean(),
          defaultValue: z.unknown().optional(),
          enumValues: z.array(z.string().min(1).max(200)).min(1).optional(),
          referenceType: z
            .enum([
              'ACCOUNTING_BOOK',
              'ACCOUNT_SUBJECT',
              'CUSTOMER_SUBUNIT',
              'SUPPLIER',
              'OTHER_UNIT',
              'EMPLOYEE',
              'SALES_PARTNER',
              'DEPARTMENT',
              'PRODUCT',
              'WAREHOUSE',
              'FUND_ACCOUNT',
              'ASSET',
              'BILL',
              'COUNTERPARTY',
            ])
            .optional(),
        })
        .strict(),
    ),
    columns: z.array(
      z
        .object({
          alias: z.string().regex(/^[a-z][a-z0-9_]{0,62}[a-z0-9]$/),
          name: z.string().min(1).max(100),
          order: z.number().int().positive(),
          type: z.enum([
            'TEXT',
            'INTEGER',
            'DECIMAL',
            'BOOLEAN',
            'DATE',
            'DATETIME',
            'ID',
          ]),
          width: z.number().int().min(60).max(1000),
          visible: z.boolean(),
          format: z.string().max(100).optional(),
          drilldownEntity: z.enum(['VOU']).optional(),
        })
        .strict(),
    ),
  })
  .strict()

export const archiveSnapshotSchemas = {
  'operating-entity': operatingEntitySnapshot,
  vehicle: vehicleSnapshot,
  'fund-account': fundAccountSnapshot,
  product: productSnapshot,
  employee: employeeSnapshot,
  supplier: supplierSnapshot,
  customer: customerSnapshot,
  'other-unit': otherUnitSnapshot,
  'sales-partner': salesPartnerSnapshot,
  'acc-mapping': accMappingSnapshot,
  'rpt-definition': rptDefinitionSnapshot,
} as const satisfies Record<ArchiveEntity, z.ZodType>

const identity = z.object({ subjectId: z.string().length(26) }).strict()
const archiveQueryBaseFilters = z
  .object({
    keyword: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()

const archiveQueryProductFilters = archiveQueryBaseFilters
  .extend({
    productTypeId: z.string().length(26).optional(),
    productCategoryId: z.string().length(26).optional(),
  })
  .strict()

const archiveQueryAccMappingFilters = archiveQueryBaseFilters
  .extend({
    bookId: z.string().length(26).optional(),
    vouEntity: z.string().trim().min(1).max(64).optional(),
  })
  .strict()

const archiveQueryInput = <Filters extends z.ZodType>(filters: Filters) =>
  z
    .object({
      page: z.number().int().positive(),
      pageSize: z.literal(20),
      filters,
    })
    .strict()

export const archiveQuerySchemas = {
  'operating-entity': archiveQueryInput(archiveQueryBaseFilters),
  vehicle: archiveQueryInput(archiveQueryBaseFilters),
  'fund-account': archiveQueryInput(archiveQueryBaseFilters),
  product: archiveQueryInput(archiveQueryProductFilters),
  employee: archiveQueryInput(archiveQueryBaseFilters),
  supplier: archiveQueryInput(archiveQueryBaseFilters),
  customer: archiveQueryInput(archiveQueryBaseFilters),
  'other-unit': archiveQueryInput(archiveQueryBaseFilters),
  'sales-partner': archiveQueryInput(archiveQueryBaseFilters),
  'acc-mapping': archiveQueryInput(archiveQueryAccMappingFilters),
  'rpt-definition': archiveQueryInput(archiveQueryBaseFilters),
} as const satisfies Record<ArchiveEntity, z.ZodType>

const reviewBase = z
  .object({
    subjectId: z.string().length(26),
    submissionId: z.string().length(26),
    expectedRevision: z.string().regex(/^\d+$/),
  })
  .strict()
export const archiveReviewSchemas = {
  withoutReason: reviewBase,
  withReason: reviewBase.extend({
    reason: z.string().trim().min(1).max(1000),
  }),
} as const

const submissionReferenceBlocker = z
  .object({
    kind: z.literal('SUBMISSION_REFERENCE'),
    field: z.string().min(1),
    objectId: z.string().min(1),
    expectedApprovalEntryId: z.string().length(26),
    currentApprovalEntryId: z.string().length(26).optional(),
  })
  .strict()
const dclApprovalReferenceBlocker = z
  .object({
    kind: z.literal('DCL_APPROVAL_REFERENCE'),
    entity: z.enum(archiveEntities),
    subjectId: z.string().length(26),
    submissionId: z.string().length(26),
    field: z.string().min(1),
    approvalEntryId: z.string().length(26),
  })
  .strict()
const accMappingReferenceBlocker = z
  .object({
    kind: z.literal('ACC_MAPPING_REFERENCE'),
    mappingApprovalEntryId: z.string().length(26),
    documentType: z.string().min(1).max(64),
    documentId: z.string().min(1).max(64),
  })
  .strict()
export const archiveBlockerSchema = z.discriminatedUnion('kind', [
  submissionReferenceBlocker,
  dclApprovalReferenceBlocker,
  accMappingReferenceBlocker,
])

const failureEnvelope = z.object({
  code: z.union([
    z.literal(1001),
    z.literal(1002),
    z.literal(2001),
    z.literal(3001),
    z.literal(5000),
  ]),
  errorKey: z.string(),
  message: z.string(),
  data: z.union([
    z.null(),
    z.object({ blockers: z.array(archiveBlockerSchema) }).strict(),
  ]),
  requestId: z.string(),
})

function defineArchiveRoutes<const Entity extends ArchiveEntity>(
  entity: Entity,
  snapshot: (typeof archiveSnapshotSchemas)[Entity],
) {
  const submission = z.object({
    entity: z.literal(entity),
    subjectId: z.string(),
    code: z.string().nullable(),
    submissionId: z.string(),
    versionNo: z.number().int().positive(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
    revision: z.string(),
    submittedBy: z.string(),
    submittedAt: z.string().datetime(),
    approvedBy: z.string().nullable(),
    approvedAt: z.string().datetime().nullable(),
    rejectedBy: z.string().nullable(),
    rejectedAt: z.string().datetime().nullable(),
    rejectionReason: z.string().nullable(),
    snapshot,
    availableApprovalActions: z.array(
      z.enum(['reject', 'approve', 'unreject', 'unapprove']),
    ),
    canDelete: z.boolean(),
    ...(entity === 'rpt-definition'
      ? {
          validity: z
            .object({
              status: z.enum(['VALID', 'INVALID']),
              diagnostic: z.string().nullable(),
              validatedAt: z.string().datetime(),
              validatedBy: z.string(),
            })
            .nullable(),
        }
      : {}),
  })
  const envelope = z.union([
    z.object({
      code: z.literal(0),
      errorKey: z.literal(''),
      message: z.literal('ok'),
      data: submission,
      requestId: z.string(),
    }),
    failureEnvelope,
  ])
  const listSubmission = submission.omit({ snapshot: true })
  const queryPageEnvelope = z.union([
    z.object({
      code: z.literal(0),
      errorKey: z.literal(''),
      message: z.literal('ok'),
      data: z.object({
        items: z.array(
          z
            .object({
              entity: z.literal(entity),
              subjectId: z.string(),
              code: z.string().nullable(),
              latestApproved: listSubmission.nullable(),
              openCandidate: listSubmission.nullable(),
            })
            .strict(),
        ),
        total: z.number().int().nonnegative(),
      }),
      requestId: z.string(),
    }),
    failureEnvelope,
  ])
  const submissionPageEnvelope = z.union([
    z.object({
      code: z.literal(0),
      errorKey: z.literal(''),
      message: z.literal('ok'),
      data: z.object({
        items: z.array(submission),
        total: z.number().int().nonnegative(),
      }),
      requestId: z.string(),
    }),
    failureEnvelope,
  ])
  const auditEnvelope = z.union([
    z.object({
      code: z.literal(0),
      errorKey: z.literal(''),
      message: z.literal('ok'),
      data: z.array(
        z.object({
          id: z.string(),
          submissionId: z.string(),
          versionNo: z.number().int().positive(),
          action: z.enum([
            'SUBMITTED',
            'APPROVED',
            'REJECTED',
            'UNREJECTED',
            'UNAPPROVED',
            'DELETED',
          ]),
          fromStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).nullable(),
          toStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).nullable(),
          fromRevision: z.string().nullable(),
          toRevision: z.string().nullable(),
          actorId: z.string(),
          reason: z.string().nullable(),
          createdAt: z.string().datetime(),
        }),
      ),
      requestId: z.string(),
    }),
    failureEnvelope,
  ])
  const submit = z
    .object({
      subjectId: z.string().length(26),
      submissionId: z.string().length(26),
      idempotencyKey: z.string().min(1).max(128),
      expectedLatestApprovedSubmissionId: z.string().length(26).nullable(),
      expectedLatestApprovedRevision: z.string().regex(/^\d+$/).nullable(),
      snapshot,
    })
    .strict()
  const get =
    entity === 'rpt-definition'
      ? identity.extend({ approvalEntryId: z.string().length(26).optional() })
      : identity
  const deletedEnvelope = z.union([
    z.object({
      code: z.literal(0),
      errorKey: z.literal(''),
      message: z.literal('ok'),
      data: z.object({ submissionId: z.string(), deleted: z.literal(true) }),
      requestId: z.string(),
    }),
    failureEnvelope,
  ])
  const route = <
    const Action extends ArchiveAction,
    const Request extends z.ZodType,
    const Response extends z.ZodType,
  >(
    action: Action,
    request: Request,
    response: Response,
  ) =>
    createRoute({
      method: 'post',
      path: `/dcl/${entity}/${action}` as const,
      request: {
        body: { content: { 'application/json': { schema: request } } },
      },
      responses: {
        200: {
          description: `${entity} ${action}`,
          content: { 'application/json': { schema: response } },
        },
      },
    })
  return {
    query: route('query', archiveQuerySchemas[entity], queryPageEnvelope),
    get: route('get', get, envelope),
    versions: route('versions', identity, submissionPageEnvelope),
    'audit-history': route('audit-history', identity, auditEnvelope),
    'submit-new': route('submit-new', submit, envelope),
    'submit-change': route('submit-change', submit, envelope),
    approve: route('approve', archiveReviewSchemas.withoutReason, envelope),
    reject: route('reject', archiveReviewSchemas.withReason, envelope),
    unreject: route('unreject', archiveReviewSchemas.withoutReason, envelope),
    unapprove: route('unapprove', archiveReviewSchemas.withReason, envelope),
    delete: route(
      'delete',
      archiveReviewSchemas.withoutReason,
      deletedEnvelope,
    ),
  } as const
}

export const archiveRouteSets = {
  'operating-entity': defineArchiveRoutes(
    'operating-entity',
    archiveSnapshotSchemas['operating-entity'],
  ),
  vehicle: defineArchiveRoutes('vehicle', archiveSnapshotSchemas.vehicle),
  'fund-account': defineArchiveRoutes(
    'fund-account',
    archiveSnapshotSchemas['fund-account'],
  ),
  product: defineArchiveRoutes('product', archiveSnapshotSchemas.product),
  employee: defineArchiveRoutes('employee', archiveSnapshotSchemas.employee),
  supplier: defineArchiveRoutes('supplier', archiveSnapshotSchemas.supplier),
  customer: defineArchiveRoutes('customer', archiveSnapshotSchemas.customer),
  'other-unit': defineArchiveRoutes(
    'other-unit',
    archiveSnapshotSchemas['other-unit'],
  ),
  'sales-partner': defineArchiveRoutes(
    'sales-partner',
    archiveSnapshotSchemas['sales-partner'],
  ),
  'acc-mapping': defineArchiveRoutes(
    'acc-mapping',
    archiveSnapshotSchemas['acc-mapping'],
  ),
  'rpt-definition': defineArchiveRoutes(
    'rpt-definition',
    archiveSnapshotSchemas['rpt-definition'],
  ),
} as const

export const archiveRouteMetadata: Array<{
  method: string
  path: string
  permission: string
  title: string
  menu?: { title: string; group: string; order: number }
}> = archiveEntities.flatMap((entity, entityIndex) =>
  archiveActions.map((action) => ({
    method: archiveRouteSets[entity][action].method,
    path: archiveRouteSets[entity][action].path,
    permission: `/dcl/${entity}/${action}`,
    title:
      action === 'query'
        ? archiveEntityPresentation[entity].label
        : `${action} ${entity}`,
    ...(action === 'query'
      ? {
          menu: {
            title: archiveEntityPresentation[entity].label,
            group: '申报控制',
            order: 30 + entityIndex,
          },
        }
      : {}),
  })),
)

/**
 * Capabilities authorize a bounded part of a real route, not a synthetic HTTP
 * endpoint. Keep them out of executable-route completeness checks while still
 * emitting them into the target permission catalog.
 */
export const archiveCapabilityPermissionMetadata = [
  {
    permission: '/dcl/customer/save-subunits',
    title: '维护客户子单位',
  },
] as const

const attachmentStageRequest = z
  .object({
    stagingId: z.string().length(26),
    fileId: z.string().length(26),
    fileName: z.string().min(1).max(255),
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    size: z.number().int().positive().max(10_485_760),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    contentBase64: z.string().min(1),
  })
  .strict()
const attachmentStageData = z.object({
  stagingId: z.string(),
  fileId: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().positive(),
  digest: z.string(),
  expiresAt: z.string().datetime(),
})
const attachmentStageEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: attachmentStageData,
    requestId: z.string(),
  }),
  failureEnvelope,
])
const attachmentCleanupEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: z.object({ deleted: z.number().int().nonnegative() }),
    requestId: z.string(),
  }),
  failureEnvelope,
])

export const customerAttachmentStageRoute = createRoute({
  method: 'post',
  path: '/dcl/customer/attachment-stage',
  request: {
    body: {
      content: { 'application/json': { schema: attachmentStageRequest } },
    },
  },
  responses: {
    200: {
      description: 'Stage one customer Draft attachment',
      content: { 'application/json': { schema: attachmentStageEnvelope } },
    },
  },
})
export const customerAttachmentCleanupRoute = createRoute({
  method: 'post',
  path: '/dcl/customer/attachment-cleanup',
  request: {
    body: {
      content: {
        'application/json': { schema: z.object({}).strict() },
      },
    },
  },
  responses: {
    200: {
      description: 'Clean expired customer attachment staging',
      content: { 'application/json': { schema: attachmentCleanupEnvelope } },
    },
  },
})

archiveRouteMetadata.push(
  {
    method: customerAttachmentStageRoute.method,
    path: customerAttachmentStageRoute.path,
    permission: customerAttachmentStageRoute.path,
    title: '暂存客户附件',
  },
  {
    method: customerAttachmentCleanupRoute.method,
    path: customerAttachmentCleanupRoute.path,
    permission: customerAttachmentCleanupRoute.path,
    title: '清理客户附件暂存',
  },
)

export type ArchiveRouteHandler = (
  entity: ArchiveEntity,
  action: ArchiveAction,
  context: Parameters<
    RouteHandler<
      (typeof archiveRouteSets)[ArchiveEntity][ArchiveAction],
      TargetRouteEnvironment
    >
  >[0],
) => ReturnType<
  RouteHandler<
    (typeof archiveRouteSets)[ArchiveEntity][ArchiveAction],
    TargetRouteEnvironment
  >
>

export interface ArchiveAttachmentHandlers {
  stage: RouteHandler<
    typeof customerAttachmentStageRoute,
    TargetRouteEnvironment
  >
  cleanup: RouteHandler<
    typeof customerAttachmentCleanupRoute,
    TargetRouteEnvironment
  >
}

function archiveHandler(
  handler: ArchiveRouteHandler,
  entity: ArchiveEntity,
  action: ArchiveAction,
) {
  return handler.bind(null, entity, action)
}

export function registerArchiveRoutes(
  app: OpenAPIHono<TargetRouteEnvironment>,
  handler: ArchiveRouteHandler,
  attachments: ArchiveAttachmentHandlers,
) {
  const operatingEntity = app.openapiRoutes([
    {
      route: archiveRouteSets['operating-entity'].query,
      handler: archiveHandler(handler, 'operating-entity', 'query'),
    },
    {
      route: archiveRouteSets['operating-entity'].get,
      handler: archiveHandler(handler, 'operating-entity', 'get'),
    },
    {
      route: archiveRouteSets['operating-entity'].versions,
      handler: archiveHandler(handler, 'operating-entity', 'versions'),
    },
    {
      route: archiveRouteSets['operating-entity']['audit-history'],
      handler: archiveHandler(handler, 'operating-entity', 'audit-history'),
    },
    {
      route: archiveRouteSets['operating-entity']['submit-new'],
      handler: archiveHandler(handler, 'operating-entity', 'submit-new'),
    },
    {
      route: archiveRouteSets['operating-entity']['submit-change'],
      handler: archiveHandler(handler, 'operating-entity', 'submit-change'),
    },
    {
      route: archiveRouteSets['operating-entity'].approve,
      handler: archiveHandler(handler, 'operating-entity', 'approve'),
    },
    {
      route: archiveRouteSets['operating-entity'].reject,
      handler: archiveHandler(handler, 'operating-entity', 'reject'),
    },
    {
      route: archiveRouteSets['operating-entity'].unreject,
      handler: archiveHandler(handler, 'operating-entity', 'unreject'),
    },
    {
      route: archiveRouteSets['operating-entity'].unapprove,
      handler: archiveHandler(handler, 'operating-entity', 'unapprove'),
    },
    {
      route: archiveRouteSets['operating-entity'].delete,
      handler: archiveHandler(handler, 'operating-entity', 'delete'),
    },
  ] as const)
  const vehicle = operatingEntity.openapiRoutes([
    {
      route: archiveRouteSets['vehicle'].query,
      handler: archiveHandler(handler, 'vehicle', 'query'),
    },
    {
      route: archiveRouteSets['vehicle'].get,
      handler: archiveHandler(handler, 'vehicle', 'get'),
    },
    {
      route: archiveRouteSets['vehicle'].versions,
      handler: archiveHandler(handler, 'vehicle', 'versions'),
    },
    {
      route: archiveRouteSets['vehicle']['audit-history'],
      handler: archiveHandler(handler, 'vehicle', 'audit-history'),
    },
    {
      route: archiveRouteSets['vehicle']['submit-new'],
      handler: archiveHandler(handler, 'vehicle', 'submit-new'),
    },
    {
      route: archiveRouteSets['vehicle']['submit-change'],
      handler: archiveHandler(handler, 'vehicle', 'submit-change'),
    },
    {
      route: archiveRouteSets['vehicle'].approve,
      handler: archiveHandler(handler, 'vehicle', 'approve'),
    },
    {
      route: archiveRouteSets['vehicle'].reject,
      handler: archiveHandler(handler, 'vehicle', 'reject'),
    },
    {
      route: archiveRouteSets['vehicle'].unreject,
      handler: archiveHandler(handler, 'vehicle', 'unreject'),
    },
    {
      route: archiveRouteSets['vehicle'].unapprove,
      handler: archiveHandler(handler, 'vehicle', 'unapprove'),
    },
    {
      route: archiveRouteSets['vehicle'].delete,
      handler: archiveHandler(handler, 'vehicle', 'delete'),
    },
  ] as const)
  const fundAccount = vehicle.openapiRoutes([
    {
      route: archiveRouteSets['fund-account'].query,
      handler: archiveHandler(handler, 'fund-account', 'query'),
    },
    {
      route: archiveRouteSets['fund-account'].get,
      handler: archiveHandler(handler, 'fund-account', 'get'),
    },
    {
      route: archiveRouteSets['fund-account'].versions,
      handler: archiveHandler(handler, 'fund-account', 'versions'),
    },
    {
      route: archiveRouteSets['fund-account']['audit-history'],
      handler: archiveHandler(handler, 'fund-account', 'audit-history'),
    },
    {
      route: archiveRouteSets['fund-account']['submit-new'],
      handler: archiveHandler(handler, 'fund-account', 'submit-new'),
    },
    {
      route: archiveRouteSets['fund-account']['submit-change'],
      handler: archiveHandler(handler, 'fund-account', 'submit-change'),
    },
    {
      route: archiveRouteSets['fund-account'].approve,
      handler: archiveHandler(handler, 'fund-account', 'approve'),
    },
    {
      route: archiveRouteSets['fund-account'].reject,
      handler: archiveHandler(handler, 'fund-account', 'reject'),
    },
    {
      route: archiveRouteSets['fund-account'].unreject,
      handler: archiveHandler(handler, 'fund-account', 'unreject'),
    },
    {
      route: archiveRouteSets['fund-account'].unapprove,
      handler: archiveHandler(handler, 'fund-account', 'unapprove'),
    },
    {
      route: archiveRouteSets['fund-account'].delete,
      handler: archiveHandler(handler, 'fund-account', 'delete'),
    },
  ] as const)
  const product = fundAccount.openapiRoutes([
    {
      route: archiveRouteSets['product'].query,
      handler: archiveHandler(handler, 'product', 'query'),
    },
    {
      route: archiveRouteSets['product'].get,
      handler: archiveHandler(handler, 'product', 'get'),
    },
    {
      route: archiveRouteSets['product'].versions,
      handler: archiveHandler(handler, 'product', 'versions'),
    },
    {
      route: archiveRouteSets['product']['audit-history'],
      handler: archiveHandler(handler, 'product', 'audit-history'),
    },
    {
      route: archiveRouteSets['product']['submit-new'],
      handler: archiveHandler(handler, 'product', 'submit-new'),
    },
    {
      route: archiveRouteSets['product']['submit-change'],
      handler: archiveHandler(handler, 'product', 'submit-change'),
    },
    {
      route: archiveRouteSets['product'].approve,
      handler: archiveHandler(handler, 'product', 'approve'),
    },
    {
      route: archiveRouteSets['product'].reject,
      handler: archiveHandler(handler, 'product', 'reject'),
    },
    {
      route: archiveRouteSets['product'].unreject,
      handler: archiveHandler(handler, 'product', 'unreject'),
    },
    {
      route: archiveRouteSets['product'].unapprove,
      handler: archiveHandler(handler, 'product', 'unapprove'),
    },
    {
      route: archiveRouteSets['product'].delete,
      handler: archiveHandler(handler, 'product', 'delete'),
    },
  ] as const)
  const employee = product.openapiRoutes([
    {
      route: archiveRouteSets['employee'].query,
      handler: archiveHandler(handler, 'employee', 'query'),
    },
    {
      route: archiveRouteSets['employee'].get,
      handler: archiveHandler(handler, 'employee', 'get'),
    },
    {
      route: archiveRouteSets['employee'].versions,
      handler: archiveHandler(handler, 'employee', 'versions'),
    },
    {
      route: archiveRouteSets['employee']['audit-history'],
      handler: archiveHandler(handler, 'employee', 'audit-history'),
    },
    {
      route: archiveRouteSets['employee']['submit-new'],
      handler: archiveHandler(handler, 'employee', 'submit-new'),
    },
    {
      route: archiveRouteSets['employee']['submit-change'],
      handler: archiveHandler(handler, 'employee', 'submit-change'),
    },
    {
      route: archiveRouteSets['employee'].approve,
      handler: archiveHandler(handler, 'employee', 'approve'),
    },
    {
      route: archiveRouteSets['employee'].reject,
      handler: archiveHandler(handler, 'employee', 'reject'),
    },
    {
      route: archiveRouteSets['employee'].unreject,
      handler: archiveHandler(handler, 'employee', 'unreject'),
    },
    {
      route: archiveRouteSets['employee'].unapprove,
      handler: archiveHandler(handler, 'employee', 'unapprove'),
    },
    {
      route: archiveRouteSets['employee'].delete,
      handler: archiveHandler(handler, 'employee', 'delete'),
    },
  ] as const)
  const supplier = employee.openapiRoutes([
    {
      route: archiveRouteSets['supplier'].query,
      handler: archiveHandler(handler, 'supplier', 'query'),
    },
    {
      route: archiveRouteSets['supplier'].get,
      handler: archiveHandler(handler, 'supplier', 'get'),
    },
    {
      route: archiveRouteSets['supplier'].versions,
      handler: archiveHandler(handler, 'supplier', 'versions'),
    },
    {
      route: archiveRouteSets['supplier']['audit-history'],
      handler: archiveHandler(handler, 'supplier', 'audit-history'),
    },
    {
      route: archiveRouteSets['supplier']['submit-new'],
      handler: archiveHandler(handler, 'supplier', 'submit-new'),
    },
    {
      route: archiveRouteSets['supplier']['submit-change'],
      handler: archiveHandler(handler, 'supplier', 'submit-change'),
    },
    {
      route: archiveRouteSets['supplier'].approve,
      handler: archiveHandler(handler, 'supplier', 'approve'),
    },
    {
      route: archiveRouteSets['supplier'].reject,
      handler: archiveHandler(handler, 'supplier', 'reject'),
    },
    {
      route: archiveRouteSets['supplier'].unreject,
      handler: archiveHandler(handler, 'supplier', 'unreject'),
    },
    {
      route: archiveRouteSets['supplier'].unapprove,
      handler: archiveHandler(handler, 'supplier', 'unapprove'),
    },
    {
      route: archiveRouteSets['supplier'].delete,
      handler: archiveHandler(handler, 'supplier', 'delete'),
    },
  ] as const)
  const customer = supplier.openapiRoutes([
    {
      route: archiveRouteSets['customer'].query,
      handler: archiveHandler(handler, 'customer', 'query'),
    },
    {
      route: archiveRouteSets['customer'].get,
      handler: archiveHandler(handler, 'customer', 'get'),
    },
    {
      route: archiveRouteSets['customer'].versions,
      handler: archiveHandler(handler, 'customer', 'versions'),
    },
    {
      route: archiveRouteSets['customer']['audit-history'],
      handler: archiveHandler(handler, 'customer', 'audit-history'),
    },
    {
      route: archiveRouteSets['customer']['submit-new'],
      handler: archiveHandler(handler, 'customer', 'submit-new'),
    },
    {
      route: archiveRouteSets['customer']['submit-change'],
      handler: archiveHandler(handler, 'customer', 'submit-change'),
    },
    {
      route: archiveRouteSets['customer'].approve,
      handler: archiveHandler(handler, 'customer', 'approve'),
    },
    {
      route: archiveRouteSets['customer'].reject,
      handler: archiveHandler(handler, 'customer', 'reject'),
    },
    {
      route: archiveRouteSets['customer'].unreject,
      handler: archiveHandler(handler, 'customer', 'unreject'),
    },
    {
      route: archiveRouteSets['customer'].unapprove,
      handler: archiveHandler(handler, 'customer', 'unapprove'),
    },
    {
      route: archiveRouteSets['customer'].delete,
      handler: archiveHandler(handler, 'customer', 'delete'),
    },
  ] as const)
  const otherUnit = customer.openapiRoutes([
    {
      route: archiveRouteSets['other-unit'].query,
      handler: archiveHandler(handler, 'other-unit', 'query'),
    },
    {
      route: archiveRouteSets['other-unit'].get,
      handler: archiveHandler(handler, 'other-unit', 'get'),
    },
    {
      route: archiveRouteSets['other-unit'].versions,
      handler: archiveHandler(handler, 'other-unit', 'versions'),
    },
    {
      route: archiveRouteSets['other-unit']['audit-history'],
      handler: archiveHandler(handler, 'other-unit', 'audit-history'),
    },
    {
      route: archiveRouteSets['other-unit']['submit-new'],
      handler: archiveHandler(handler, 'other-unit', 'submit-new'),
    },
    {
      route: archiveRouteSets['other-unit']['submit-change'],
      handler: archiveHandler(handler, 'other-unit', 'submit-change'),
    },
    {
      route: archiveRouteSets['other-unit'].approve,
      handler: archiveHandler(handler, 'other-unit', 'approve'),
    },
    {
      route: archiveRouteSets['other-unit'].reject,
      handler: archiveHandler(handler, 'other-unit', 'reject'),
    },
    {
      route: archiveRouteSets['other-unit'].unreject,
      handler: archiveHandler(handler, 'other-unit', 'unreject'),
    },
    {
      route: archiveRouteSets['other-unit'].unapprove,
      handler: archiveHandler(handler, 'other-unit', 'unapprove'),
    },
    {
      route: archiveRouteSets['other-unit'].delete,
      handler: archiveHandler(handler, 'other-unit', 'delete'),
    },
  ] as const)
  const salesPartner = otherUnit.openapiRoutes([
    {
      route: archiveRouteSets['sales-partner'].query,
      handler: archiveHandler(handler, 'sales-partner', 'query'),
    },
    {
      route: archiveRouteSets['sales-partner'].get,
      handler: archiveHandler(handler, 'sales-partner', 'get'),
    },
    {
      route: archiveRouteSets['sales-partner'].versions,
      handler: archiveHandler(handler, 'sales-partner', 'versions'),
    },
    {
      route: archiveRouteSets['sales-partner']['audit-history'],
      handler: archiveHandler(handler, 'sales-partner', 'audit-history'),
    },
    {
      route: archiveRouteSets['sales-partner']['submit-new'],
      handler: archiveHandler(handler, 'sales-partner', 'submit-new'),
    },
    {
      route: archiveRouteSets['sales-partner']['submit-change'],
      handler: archiveHandler(handler, 'sales-partner', 'submit-change'),
    },
    {
      route: archiveRouteSets['sales-partner'].approve,
      handler: archiveHandler(handler, 'sales-partner', 'approve'),
    },
    {
      route: archiveRouteSets['sales-partner'].reject,
      handler: archiveHandler(handler, 'sales-partner', 'reject'),
    },
    {
      route: archiveRouteSets['sales-partner'].unreject,
      handler: archiveHandler(handler, 'sales-partner', 'unreject'),
    },
    {
      route: archiveRouteSets['sales-partner'].unapprove,
      handler: archiveHandler(handler, 'sales-partner', 'unapprove'),
    },
    {
      route: archiveRouteSets['sales-partner'].delete,
      handler: archiveHandler(handler, 'sales-partner', 'delete'),
    },
  ] as const)
  const accMapping = salesPartner.openapiRoutes([
    {
      route: archiveRouteSets['acc-mapping'].query,
      handler: archiveHandler(handler, 'acc-mapping', 'query'),
    },
    {
      route: archiveRouteSets['acc-mapping'].get,
      handler: archiveHandler(handler, 'acc-mapping', 'get'),
    },
    {
      route: archiveRouteSets['acc-mapping'].versions,
      handler: archiveHandler(handler, 'acc-mapping', 'versions'),
    },
    {
      route: archiveRouteSets['acc-mapping']['audit-history'],
      handler: archiveHandler(handler, 'acc-mapping', 'audit-history'),
    },
    {
      route: archiveRouteSets['acc-mapping']['submit-new'],
      handler: archiveHandler(handler, 'acc-mapping', 'submit-new'),
    },
    {
      route: archiveRouteSets['acc-mapping']['submit-change'],
      handler: archiveHandler(handler, 'acc-mapping', 'submit-change'),
    },
    {
      route: archiveRouteSets['acc-mapping'].approve,
      handler: archiveHandler(handler, 'acc-mapping', 'approve'),
    },
    {
      route: archiveRouteSets['acc-mapping'].reject,
      handler: archiveHandler(handler, 'acc-mapping', 'reject'),
    },
    {
      route: archiveRouteSets['acc-mapping'].unreject,
      handler: archiveHandler(handler, 'acc-mapping', 'unreject'),
    },
    {
      route: archiveRouteSets['acc-mapping'].unapprove,
      handler: archiveHandler(handler, 'acc-mapping', 'unapprove'),
    },
    {
      route: archiveRouteSets['acc-mapping'].delete,
      handler: archiveHandler(handler, 'acc-mapping', 'delete'),
    },
  ] as const)
  const rptDefinition = accMapping.openapiRoutes([
    {
      route: archiveRouteSets['rpt-definition'].query,
      handler: archiveHandler(handler, 'rpt-definition', 'query'),
    },
    {
      route: archiveRouteSets['rpt-definition'].get,
      handler: archiveHandler(handler, 'rpt-definition', 'get'),
    },
    {
      route: archiveRouteSets['rpt-definition'].versions,
      handler: archiveHandler(handler, 'rpt-definition', 'versions'),
    },
    {
      route: archiveRouteSets['rpt-definition']['audit-history'],
      handler: archiveHandler(handler, 'rpt-definition', 'audit-history'),
    },
    {
      route: archiveRouteSets['rpt-definition']['submit-new'],
      handler: archiveHandler(handler, 'rpt-definition', 'submit-new'),
    },
    {
      route: archiveRouteSets['rpt-definition']['submit-change'],
      handler: archiveHandler(handler, 'rpt-definition', 'submit-change'),
    },
    {
      route: archiveRouteSets['rpt-definition'].approve,
      handler: archiveHandler(handler, 'rpt-definition', 'approve'),
    },
    {
      route: archiveRouteSets['rpt-definition'].reject,
      handler: archiveHandler(handler, 'rpt-definition', 'reject'),
    },
    {
      route: archiveRouteSets['rpt-definition'].unreject,
      handler: archiveHandler(handler, 'rpt-definition', 'unreject'),
    },
    {
      route: archiveRouteSets['rpt-definition'].unapprove,
      handler: archiveHandler(handler, 'rpt-definition', 'unapprove'),
    },
    {
      route: archiveRouteSets['rpt-definition'].delete,
      handler: archiveHandler(handler, 'rpt-definition', 'delete'),
    },
  ] as const)
  return rptDefinition.openapiRoutes([
    { route: customerAttachmentStageRoute, handler: attachments.stage },
    { route: customerAttachmentCleanupRoute, handler: attachments.cleanup },
  ] as const)
}
