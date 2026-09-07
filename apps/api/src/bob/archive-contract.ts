import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
  z,
} from '@hono/zod-openapi'
import type { TargetRouteEnvironment } from '../app/contract.ts'
import { archiveEntityPresentation } from '@zerp/model'

export const bobArchiveEntities = [
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
) {
  return app.openapiRoutes([
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
