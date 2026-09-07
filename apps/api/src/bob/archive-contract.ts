import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
  z,
} from '@hono/zod-openapi'
import type { TargetRouteEnvironment } from '../app/contract.ts'
import { archiveEntityPresentation } from '@zerp/model'

export const bobArchiveEntities = [
  'customer',
  'product',
  'supplier',
  'other-unit',
  'sales-partner',
] as const

export type BobArchiveEntity = (typeof bobArchiveEntities)[number]

export type ArchiveEntity = BobArchiveEntity

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

const stableReference = z
  .object({
    objectId: z.string().length(26),
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

const exactReference = z
  .object({
    objectId: z.string().min(1).max(26),
    approvalEntryId: z.string().length(26),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
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
const identityKind = z.enum([
  'MAINLAND_ENTERPRISE',
  'MAINLAND_INDIVIDUAL',
  'OTHER',
])

// Settlement methods are AUX facts. They intentionally do not carry an
// Approval Entry: a DCL exact-version reference here would fabricate history.
// ArchiveService replaces any client-supplied identity with these immutable
// term facts from the currently enabled AUX object before persistence.
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
      unitPrice: z
        .string()
        .regex(/^(?:[1-9]\d*\.\d{2}|0\.(?:[1-9]\d|0[1-9]))$/),
    })
    .strict(),
  z
    .object({
      name: z.string().trim().min(1).max(200),
      calculationBasis: z.literal('ORDER_AMOUNT'),
      orderAmount: z
        .string()
        .regex(/^(?:[1-9]\d*\.\d{2}|0\.(?:[1-9]\d|0[1-9]))$/),
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
const customerSalesAttribution = z.discriminatedUnion('type', [
  stableReference.extend({ type: z.literal('INTERNAL_EMPLOYEE') }),
  exactReference.extend({
    type: z.enum(['EXTERNAL_PART_TIME', 'CHANNEL_PARTNER']),
  }),
])

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
    defaultOperatingEntity: stableReference.nullable(),
    identityAttachments: z.array(attachmentMetadata),
    subunits: z.array(customerSubunit).min(1),
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
  operatingEntities: z.array(stableReference),
  defaultOperatingEntityId: z.string().length(26).nullable(),
  remark: z.string().max(1000),
} as const

const supplierSnapshot = z
  .object({
    ...archiveIdentityBase,
    settlementMethod: settlementSnapshot.nullable(),
    defaultPurchaser: stableReference.nullable(),
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

export const bobArchiveSnapshotSchemas = {
  customer: customerSnapshot,
  product: productSnapshot,
  supplier: supplierSnapshot,
  'other-unit': otherUnitSnapshot,
  'sales-partner': salesPartnerSnapshot,
} as const satisfies Record<BobArchiveEntity, z.ZodType>

export const archiveSnapshotSchemas = bobArchiveSnapshotSchemas

const identity = z.object({ subjectId: z.string().length(26) }).strict()

const archiveQueryBaseFilters = z
  .object({
    keyword: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    enabled: z.boolean().optional(),
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
  customer: archiveQueryInput(archiveQueryBaseFilters),
  product: archiveQueryInput(
    archiveQueryBaseFilters
      .extend({
        productTypeId: z.string().length(26).optional(),
        productCategoryId: z.string().length(26).optional(),
      })
      .strict(),
  ),
  supplier: archiveQueryInput(archiveQueryBaseFilters),
  'other-unit': archiveQueryInput(archiveQueryBaseFilters),
  'sales-partner': archiveQueryInput(archiveQueryBaseFilters),
} as const satisfies Record<BobArchiveEntity, z.ZodType>

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
export const archiveBlockerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('AUX_CURRENT_REFERENCE'),
      entity: z.literal('vehicle'),
      objectId: z.string().length(26),
      field: z.literal('carrier'),
      approvalEntryId: z.string().length(26),
    })
    .strict(),
  z
    .object({
      kind: z.literal('AUX_REFERENCE'),
      entity: z.enum(['operating-entity', 'employee']),
      objectId: z.string(),
    })
    .strict(),
  submissionReferenceBlocker,
  z
    .object({
      kind: z.enum(['PRODUCT_REFERENCE', 'CUSTOMER_REFERENCE']),
      domain: z.enum(['bob', 'vou', 'acc']),
      entity: z.string(),
      objectId: z.string().length(26),
      approvalEntryId: z.string().length(26),
      field: z.string(),
    })
    .strict(),
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

function defineArchiveRoutes<
  const Entity extends ArchiveEntity,
  const Domain extends 'bob' | 'dcl',
  const Query extends 'query' | 'submission-query',
  const Get extends 'get' | 'submission-get',
>(
  domain: Domain,
  queryAction: Query,
  getAction: Get,
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
  const get = identity.extend({
    submissionId: z.string().length(26).optional(),
  })
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
    const Action extends ArchiveAction | Query | Get,
    const Request extends z.ZodType,
    const Response extends z.ZodType,
  >(
    action: Action,
    request: Request,
    response: Response,
  ) =>
    createRoute({
      method: 'post',
      path: `/${domain}/${entity}/${action}` as const,
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
    query: route(queryAction, archiveQuerySchemas[entity], queryPageEnvelope),
    get: route(getAction, get, envelope),
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

export const bobArchiveRouteSets = {
  customer: defineArchiveRoutes(
    'bob',
    'submission-query',
    'submission-get',
    'customer',
    archiveSnapshotSchemas.customer,
  ),
  product: defineArchiveRoutes(
    'bob',
    'submission-query',
    'submission-get',
    'product',
    archiveSnapshotSchemas.product,
  ),

  supplier: defineArchiveRoutes(
    'bob',
    'submission-query',
    'submission-get',
    'supplier',
    archiveSnapshotSchemas.supplier,
  ),
  'other-unit': defineArchiveRoutes(
    'bob',
    'submission-query',
    'submission-get',
    'other-unit',
    archiveSnapshotSchemas['other-unit'],
  ),
  'sales-partner': defineArchiveRoutes(
    'bob',
    'submission-query',
    'submission-get',
    'sales-partner',
    archiveSnapshotSchemas['sales-partner'],
  ),
} as const
export const archiveRouteSets = bobArchiveRouteSets

export const bobArchiveRouteMetadata: Array<{
  method: string
  path: string
  permission: string
  title: string
}> = bobArchiveEntities.flatMap((entity) =>
  archiveActions.map((action) => ({
    method: archiveRouteSets[entity][action].method,
    path: archiveRouteSets[entity][action].path,
    permission: archiveRouteSets[entity][action].path,
    title:
      action === 'query'
        ? archiveEntityPresentation[entity].label
        : `${action} ${entity}`,
  })),
)

/**
 * Capabilities authorize a bounded part of a real route, not a synthetic HTTP
 * endpoint. Keep them out of executable-route completeness checks while still
 * emitting them into the target permission catalog.
 */
export const archiveCapabilityPermissionMetadata = [
  {
    permission: '/bob/customer/save-subunits',
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
  path: '/bob/customer/attachment-stage',
  request: {
    body: {
      content: { 'application/json': { schema: attachmentStageRequest } },
    },
  },
  responses: {
    200: {
      description: 'Stage one customer temporary attachment',
      content: { 'application/json': { schema: attachmentStageEnvelope } },
    },
  },
})
export const customerAttachmentCleanupRoute = createRoute({
  method: 'post',
  path: '/bob/customer/attachment-cleanup',
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

bobArchiveRouteMetadata.push(
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

export type BobArchiveRouteHandler = (
  entity: BobArchiveEntity,
  action: ArchiveAction,
  context: Parameters<
    RouteHandler<
      (typeof archiveRouteSets)[BobArchiveEntity][ArchiveAction],
      TargetRouteEnvironment
    >
  >[0],
) => ReturnType<
  RouteHandler<
    (typeof archiveRouteSets)[BobArchiveEntity][ArchiveAction],
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
  handler: BobArchiveRouteHandler,
  entity: BobArchiveEntity,
  action: ArchiveAction,
) {
  return handler.bind(null, entity, action)
}

export function registerBobArchiveRoutes(
  app: OpenAPIHono<TargetRouteEnvironment>,
  handler: BobArchiveRouteHandler,
  attachments: ArchiveAttachmentHandlers,
) {
  return app.openapiRoutes([
    {
      route: archiveRouteSets['customer']['query'],
      handler: archiveHandler(handler, 'customer', 'query'),
    },
    {
      route: archiveRouteSets['customer']['get'],
      handler: archiveHandler(handler, 'customer', 'get'),
    },
    {
      route: archiveRouteSets['customer']['versions'],
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
      route: archiveRouteSets['customer']['approve'],
      handler: archiveHandler(handler, 'customer', 'approve'),
    },
    {
      route: archiveRouteSets['customer']['reject'],
      handler: archiveHandler(handler, 'customer', 'reject'),
    },
    {
      route: archiveRouteSets['customer']['unreject'],
      handler: archiveHandler(handler, 'customer', 'unreject'),
    },
    {
      route: archiveRouteSets['customer']['unapprove'],
      handler: archiveHandler(handler, 'customer', 'unapprove'),
    },
    {
      route: archiveRouteSets['customer']['delete'],
      handler: archiveHandler(handler, 'customer', 'delete'),
    },

    { route: customerAttachmentStageRoute, handler: attachments.stage },
    { route: customerAttachmentCleanupRoute, handler: attachments.cleanup },
    {
      route: archiveRouteSets['product']['query'],
      handler: archiveHandler(handler, 'product', 'query'),
    },
    {
      route: archiveRouteSets['product']['get'],
      handler: archiveHandler(handler, 'product', 'get'),
    },
    {
      route: archiveRouteSets['product']['versions'],
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
      route: archiveRouteSets['product']['approve'],
      handler: archiveHandler(handler, 'product', 'approve'),
    },
    {
      route: archiveRouteSets['product']['reject'],
      handler: archiveHandler(handler, 'product', 'reject'),
    },
    {
      route: archiveRouteSets['product']['unreject'],
      handler: archiveHandler(handler, 'product', 'unreject'),
    },
    {
      route: archiveRouteSets['product']['unapprove'],
      handler: archiveHandler(handler, 'product', 'unapprove'),
    },
    {
      route: archiveRouteSets['product']['delete'],
      handler: archiveHandler(handler, 'product', 'delete'),
    },

    {
      route: archiveRouteSets['supplier']['query'],
      handler: archiveHandler(handler, 'supplier', 'query'),
    },
    {
      route: archiveRouteSets['supplier']['get'],
      handler: archiveHandler(handler, 'supplier', 'get'),
    },
    {
      route: archiveRouteSets['supplier']['versions'],
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
      route: archiveRouteSets['supplier']['approve'],
      handler: archiveHandler(handler, 'supplier', 'approve'),
    },
    {
      route: archiveRouteSets['supplier']['reject'],
      handler: archiveHandler(handler, 'supplier', 'reject'),
    },
    {
      route: archiveRouteSets['supplier']['unreject'],
      handler: archiveHandler(handler, 'supplier', 'unreject'),
    },
    {
      route: archiveRouteSets['supplier']['unapprove'],
      handler: archiveHandler(handler, 'supplier', 'unapprove'),
    },
    {
      route: archiveRouteSets['supplier']['delete'],
      handler: archiveHandler(handler, 'supplier', 'delete'),
    },
    {
      route: archiveRouteSets['other-unit']['query'],
      handler: archiveHandler(handler, 'other-unit', 'query'),
    },
    {
      route: archiveRouteSets['other-unit']['get'],
      handler: archiveHandler(handler, 'other-unit', 'get'),
    },
    {
      route: archiveRouteSets['other-unit']['versions'],
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
      route: archiveRouteSets['other-unit']['approve'],
      handler: archiveHandler(handler, 'other-unit', 'approve'),
    },
    {
      route: archiveRouteSets['other-unit']['reject'],
      handler: archiveHandler(handler, 'other-unit', 'reject'),
    },
    {
      route: archiveRouteSets['other-unit']['unreject'],
      handler: archiveHandler(handler, 'other-unit', 'unreject'),
    },
    {
      route: archiveRouteSets['other-unit']['unapprove'],
      handler: archiveHandler(handler, 'other-unit', 'unapprove'),
    },
    {
      route: archiveRouteSets['other-unit']['delete'],
      handler: archiveHandler(handler, 'other-unit', 'delete'),
    },
    {
      route: archiveRouteSets['sales-partner']['query'],
      handler: archiveHandler(handler, 'sales-partner', 'query'),
    },
    {
      route: archiveRouteSets['sales-partner']['get'],
      handler: archiveHandler(handler, 'sales-partner', 'get'),
    },
    {
      route: archiveRouteSets['sales-partner']['versions'],
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
      route: archiveRouteSets['sales-partner']['approve'],
      handler: archiveHandler(handler, 'sales-partner', 'approve'),
    },
    {
      route: archiveRouteSets['sales-partner']['reject'],
      handler: archiveHandler(handler, 'sales-partner', 'reject'),
    },
    {
      route: archiveRouteSets['sales-partner']['unreject'],
      handler: archiveHandler(handler, 'sales-partner', 'unreject'),
    },
    {
      route: archiveRouteSets['sales-partner']['unapprove'],
      handler: archiveHandler(handler, 'sales-partner', 'unapprove'),
    },
    {
      route: archiveRouteSets['sales-partner']['delete'],
      handler: archiveHandler(handler, 'sales-partner', 'delete'),
    },
  ] as const)
}
