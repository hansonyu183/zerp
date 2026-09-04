import {
  createRoute,
  OpenAPIHono,
  type RouteHandler,
  z,
} from '@hono/zod-openapi'
import type { Schema } from 'hono'

import {
  independentRouteMetadata,
  registerIndependentRoutes,
  type IndependentRouteHandlers,
} from './independent-contract.ts'
import {
  archiveRouteMetadata,
  registerArchiveRoutes,
  type ArchiveAttachmentHandlers,
  type ArchiveRouteHandler,
} from '../dcl/archive-contract.ts'

export type TargetRouteEnvironment = {
  Variables: { requestId: string }
}

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
    z
      .object({
        references: z.array(
          z.object({
            domain: z.string(),
            entity: z.string(),
            businessId: z.string(),
            businessCode: z.string(),
          }),
        ),
      })
      .strict(),
    z
      .object({
        inventory: z.array(z.record(z.string(), z.unknown())),
        documents: z.array(z.record(z.string(), z.unknown())),
        sources: z.array(z.record(z.string(), z.unknown())),
        references: z.array(z.record(z.string(), z.unknown())),
      })
      .strict(),
    z
      .object({
        fieldBlockers: z.array(
          z.object({
            field: z.literal('manager'),
            objectId: z.string(),
            expectedApprovalEntryId: z.string(),
            currentApprovalEntryId: z.string().optional(),
          }),
        ),
      })
      .strict(),
  ]),
  requestId: z.string(),
})

const sessionData = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  csrfToken: z.string(),
  permissions: z.array(z.string()),
  passwordChangeRequired: z.boolean(),
  passwordMinLength: z.number().int().positive(),
})

const sessionEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: sessionData,
    requestId: z.string(),
  }),
  failureEnvelope,
])

const userQuery = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.literal(20),
    filters: z
      .object({
        search: z.string().max(128).optional(),
        status: z.enum(['ENABLED', 'DISABLED']).optional(),
      })
      .strict()
      .optional(),
    sort: z.tuple([
      z
        .object({ field: z.literal('username'), order: z.literal('asc') })
        .strict(),
    ]),
  })
  .strict()

const userPage = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      username: z.string(),
      displayName: z.string(),
      status: z.enum(['ENABLED', 'DISABLED']),
      system: z.boolean(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
      revision: z.string(),
      manageable: z.boolean(),
    }),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.literal(20),
})

const userPageEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: userPage,
    requestId: z.string(),
  }),
  failureEnvelope,
])

export const signinRoute = createRoute({
  method: 'post',
  path: '/app/user/signin',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              username: z.string().min(1).max(64),
              password: z.string().min(1).max(1024),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Session envelope',
      content: { 'application/json': { schema: sessionEnvelope } },
    },
  },
})

export const restoreRoute = createRoute({
  method: 'post',
  path: '/app/user/session',
  request: {
    body: {
      content: { 'application/json': { schema: z.object({}).strict() } },
    },
  },
  responses: {
    200: {
      description: 'Session envelope',
      content: { 'application/json': { schema: sessionEnvelope } },
    },
  },
})

export const queryUsersRoute = createRoute({
  method: 'post',
  path: '/app/user/query',
  request: {
    body: { content: { 'application/json': { schema: userQuery } } },
  },
  responses: {
    200: {
      description: 'User page envelope',
      content: { 'application/json': { schema: userPageEnvelope } },
    },
  },
})

const warehouseSnapshot = z
  .object({
    name: z.string().min(1).max(200),
    address: z.string().max(500).nullable(),
    contactName: z.string().max(100).nullable(),
    contactPhone: z.string().max(32).nullable(),
    managerEmployeeId: z.string().max(26).nullable(),
    managerEmployeeApprovalEntryId: z.string().max(26).nullable(),
    managerEmployeeCode: z.string().max(64).nullable(),
    managerEmployeeName: z.string().max(200).nullable(),
    remark: z.string().max(1000).nullable(),
    enabled: z.boolean(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const managerFields = [
      snapshot.managerEmployeeId,
      snapshot.managerEmployeeApprovalEntryId,
      snapshot.managerEmployeeCode,
      snapshot.managerEmployeeName,
    ]
    const populated = managerFields.filter((value) => value !== null).length
    if (populated !== 0 && populated !== managerFields.length)
      context.addIssue({
        code: 'custom',
        message: 'manager reference must be empty or complete',
        path: ['managerEmployeeId'],
      })
  })

const warehouseSubmission = z.object({
  subjectId: z.string(),
  code: z.string(),
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
  snapshot: warehouseSnapshot,
  availableApprovalActions: z.array(
    z.enum(['reject', 'approve', 'unreject', 'unapprove']),
  ),
  canDelete: z.boolean(),
})

const warehouseEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: warehouseSubmission,
    requestId: z.string(),
  }),
  failureEnvelope,
])

const warehouseSubmit = z
  .object({
    subjectId: z.string().length(26),
    submissionId: z.string().length(26),
    idempotencyKey: z.string().min(1).max(128),
    expectedLatestApprovedSubmissionId: z.string().length(26).nullable(),
    expectedLatestApprovedRevision: z.string().regex(/^\d+$/).nullable(),
    snapshot: warehouseSnapshot,
  })
  .strict()

const warehouseIdentity = z
  .object({ subjectId: z.string().length(26) })
  .strict()

const warehouseReview = z
  .object({
    subjectId: z.string().length(26),
    submissionId: z.string().length(26),
    expectedRevision: z.string().regex(/^\d+$/),
    reason: z.string().max(1000).optional(),
  })
  .strict()

const warehouseDelete = warehouseReview.omit({ reason: true })

const warehouseDeleteEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: z.object({ submissionId: z.string(), deleted: z.literal(true) }),
    requestId: z.string(),
  }),
  failureEnvelope,
])

const warehouseQueryEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: z.object({ items: z.array(warehouseSubmission), total: z.number() }),
    requestId: z.string(),
  }),
  failureEnvelope,
])

const warehouseAuditEnvelope = z.union([
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

const warehouseReferenceEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: z.array(
      z.object({
        subjectId: z.string(),
        approvalEntryId: z.string(),
        versionNo: z.number().int().positive(),
        code: z.string(),
        name: z.string(),
        enabled: z.literal(true),
      }),
    ),
    requestId: z.string(),
  }),
  failureEnvelope,
])

const warehouseManagerReferenceEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: z
      .object({
        employeeId: z.string(),
        latestApprovedEntryId: z.string(),
        code: z.string(),
        displayName: z.string(),
        enabled: z.boolean(),
      })
      .nullable(),
    requestId: z.string(),
  }),
  failureEnvelope,
])

function warehouseRoute<
  const Path extends string,
  RequestSchema extends z.ZodType,
  ResponseSchema extends z.ZodType,
>(path: Path, requestSchema: RequestSchema, responseSchema: ResponseSchema) {
  return createRoute({
    method: 'post',
    path,
    request: {
      body: { content: { 'application/json': { schema: requestSchema } } },
    },
    responses: {
      200: {
        description: `Warehouse ${path} envelope`,
        content: { 'application/json': { schema: responseSchema } },
      },
    },
  })
}

export const warehouseQueryRoute = warehouseRoute(
  '/dcl/warehouse/query',
  z.object({}).strict(),
  warehouseQueryEnvelope,
)
export const warehouseGetRoute = warehouseRoute(
  '/dcl/warehouse/get',
  warehouseIdentity,
  warehouseEnvelope,
)
export const warehouseVersionsRoute = warehouseRoute(
  '/dcl/warehouse/versions',
  warehouseIdentity,
  warehouseQueryEnvelope,
)
export const warehouseAuditRoute = warehouseRoute(
  '/dcl/warehouse/audit-history',
  warehouseIdentity,
  warehouseAuditEnvelope,
)
export const warehouseManagerReferenceRoute = warehouseRoute(
  '/dcl/warehouse/manager-reference',
  z
    .object({
      employeeId: z.string().length(26),
      action: z.enum(['submit-new', 'submit-change']),
    })
    .strict(),
  warehouseManagerReferenceEnvelope,
)
export const warehouseSubmitNewRoute = warehouseRoute(
  '/dcl/warehouse/submit-new',
  warehouseSubmit,
  warehouseEnvelope,
)
export const warehouseSubmitChangeRoute = warehouseRoute(
  '/dcl/warehouse/submit-change',
  warehouseSubmit,
  warehouseEnvelope,
)
export const warehouseApproveRoute = warehouseRoute(
  '/dcl/warehouse/approve',
  warehouseReview,
  warehouseEnvelope,
)
export const warehouseRejectRoute = warehouseRoute(
  '/dcl/warehouse/reject',
  warehouseReview,
  warehouseEnvelope,
)
export const warehouseUnrejectRoute = warehouseRoute(
  '/dcl/warehouse/unreject',
  warehouseReview,
  warehouseEnvelope,
)
export const warehouseUnapproveRoute = warehouseRoute(
  '/dcl/warehouse/unapprove',
  warehouseReview,
  warehouseEnvelope,
)
export const warehouseDeleteRoute = warehouseRoute(
  '/dcl/warehouse/delete',
  warehouseDelete,
  warehouseDeleteEnvelope,
)

export const warehouseReferenceRoute = createRoute({
  method: 'post',
  path: '/bob/warehouse/reference',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ search: z.string().max(128).optional() }).strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Current Warehouse reference envelope',
      content: { 'application/json': { schema: warehouseReferenceEnvelope } },
    },
  },
})

const accMappingCatalog = z
  .object({
    books: z.array(
      z.object({ id: z.string(), code: z.string(), name: z.string() }).strict(),
    ),
    vouEntities: z.array(
      z
        .object({
          id: z.string(),
          code: z.string(),
          name: z.string(),
          fieldCatalog: z
            .object({
              headerFields: z.array(z.string()),
              lineFields: z.array(z.string()),
            })
            .strict(),
        })
        .strict(),
    ),
    subjects: z.array(
      z
        .object({
          id: z.string(),
          bookId: z.string(),
          code: z.string(),
          name: z.string(),
          requiredDimensions: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict()

const accMappingDefinition = z
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
                  costCounterpartSubjectId: z.string().length(26).nullable(),
                  costCounterpartDimensions: z.record(z.string(), z.string()),
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
  .strict()

const accMappingCurrent = z
  .object({
    subjectId: z.string().length(26),
    approvalEntryId: z.string().length(26),
    approvalRevision: z.string(),
    book: z
      .object({ id: z.string().length(26), code: z.string(), name: z.string() })
      .strict(),
    vouEntity: z
      .object({ id: z.string().length(26), code: z.string(), name: z.string() })
      .strict(),
    defaultResult: z.enum(['POST', 'UN_POST']),
    definition: accMappingDefinition,
  })
  .strict()

const accMappingQueryData = z
  .object({
    items: z.array(accMappingCurrent),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict()

function accMappingRoute<
  Path extends string,
  Body extends z.ZodType,
  Data extends z.ZodType,
>(path: Path, body: Body, data: Data, description: string) {
  return createRoute({
    method: 'post',
    path,
    request: { body: { content: { 'application/json': { schema: body } } } },
    responses: {
      200: {
        description,
        content: {
          'application/json': {
            schema: z.union([
              z.object({
                code: z.literal(0),
                errorKey: z.literal(''),
                message: z.literal('ok'),
                data,
                requestId: z.string(),
              }),
              failureEnvelope,
            ]),
          },
        },
      },
    },
  })
}

const accMappingEmptyRequest = z.object({}).strict()

export const accMappingQueryRoute = accMappingRoute(
  '/acc/mapping/query',
  z
    .object({
      bookId: z.string().length(26),
      vouEntity: z.string().min(1).max(64).optional(),
      page: z.number().int().positive(),
      pageSize: z.number().int().positive().max(100),
    })
    .strict(),
  accMappingQueryData,
  'Current approved ACC mappings envelope',
)
export const accMappingGetRoute = accMappingRoute(
  '/acc/mapping/get',
  z
    .object({
      bookId: z.string().length(26),
      vouEntity: z.string().min(1).max(64),
    })
    .strict(),
  accMappingCurrent,
  'Current approved ACC mapping envelope',
)
export const accMappingCatalogRoute = accMappingRoute(
  '/acc/mapping/catalog',
  accMappingEmptyRequest,
  accMappingCatalog,
  'ACC mapping catalog envelope',
)

export const targetRouteMetadata = [
  { method: signinRoute.method, path: signinRoute.path },
  { method: restoreRoute.method, path: restoreRoute.path },
  {
    method: queryUsersRoute.method,
    path: queryUsersRoute.path,
    permission: '/app/user/query',
    menu: { title: '用户管理', group: '系统管理', order: 10 },
  },
  ...(
    [
      ['query', warehouseQueryRoute, '查询仓库申报', 20],
      ['get', warehouseGetRoute, '查看仓库申报', null],
      ['versions', warehouseVersionsRoute, '查看仓库申报版本', null],
      ['audit-history', warehouseAuditRoute, '查看仓库申报审核记录', null],
      ['submit-new', warehouseSubmitNewRoute, '提交新仓库申报', null],
      ['submit-change', warehouseSubmitChangeRoute, '提交仓库变更', null],
      ['approve', warehouseApproveRoute, '批准仓库申报', null],
      ['reject', warehouseRejectRoute, '驳回仓库申报', null],
      ['unreject', warehouseUnrejectRoute, '恢复仓库申报审核', null],
      ['unapprove', warehouseUnapproveRoute, '反批准仓库申报', null],
      ['delete', warehouseDeleteRoute, '撤回仓库提交件', null],
    ] as const
  ).map(([action, route, title, order]) => ({
    method: route.method,
    path: route.path,
    permission: `/dcl/warehouse/${action}`,
    title,
    ...(order === null ? {} : { menu: { title, group: '申报控制', order } }),
  })),
  {
    method: warehouseManagerReferenceRoute.method,
    path: warehouseManagerReferenceRoute.path,
  },
  {
    method: warehouseReferenceRoute.method,
    path: warehouseReferenceRoute.path,
    permission: '/bob/warehouse/reference',
    title: '引用仓库',
  },
  ...(
    [
      ['query', accMappingQueryRoute, '查询当前会计映射'],
      ['get', accMappingGetRoute, '查看当前会计映射'],
      ['catalog', accMappingCatalogRoute, '会计映射目录'],
    ] as const
  ).map(([action, route, title]) => ({
    method: route.method,
    path: route.path,
    permission: `/acc/mapping/${action}`,
    title,
  })),
  ...independentRouteMetadata,
  ...archiveRouteMetadata,
] as const

export interface TargetRouteHandlers {
  independent: IndependentRouteHandlers
  archive: ArchiveRouteHandler
  archiveAttachments: ArchiveAttachmentHandlers
  signin: RouteHandler<typeof signinRoute, TargetRouteEnvironment>
  restore: RouteHandler<typeof restoreRoute, TargetRouteEnvironment>
  queryUsers: RouteHandler<typeof queryUsersRoute, TargetRouteEnvironment>
  warehouseQuery: RouteHandler<
    typeof warehouseQueryRoute,
    TargetRouteEnvironment
  >
  warehouseGet: RouteHandler<typeof warehouseGetRoute, TargetRouteEnvironment>
  warehouseVersions: RouteHandler<
    typeof warehouseVersionsRoute,
    TargetRouteEnvironment
  >
  warehouseAudit: RouteHandler<
    typeof warehouseAuditRoute,
    TargetRouteEnvironment
  >
  warehouseManagerReference: RouteHandler<
    typeof warehouseManagerReferenceRoute,
    TargetRouteEnvironment
  >
  warehouseSubmitNew: RouteHandler<
    typeof warehouseSubmitNewRoute,
    TargetRouteEnvironment
  >
  warehouseSubmitChange: RouteHandler<
    typeof warehouseSubmitChangeRoute,
    TargetRouteEnvironment
  >
  warehouseApprove: RouteHandler<
    typeof warehouseApproveRoute,
    TargetRouteEnvironment
  >
  warehouseReject: RouteHandler<
    typeof warehouseRejectRoute,
    TargetRouteEnvironment
  >
  warehouseUnreject: RouteHandler<
    typeof warehouseUnrejectRoute,
    TargetRouteEnvironment
  >
  warehouseUnapprove: RouteHandler<
    typeof warehouseUnapproveRoute,
    TargetRouteEnvironment
  >
  warehouseDelete: RouteHandler<
    typeof warehouseDeleteRoute,
    TargetRouteEnvironment
  >
  warehouseReference: RouteHandler<
    typeof warehouseReferenceRoute,
    TargetRouteEnvironment
  >
  accMappingQuery: RouteHandler<
    typeof accMappingQueryRoute,
    TargetRouteEnvironment
  >
  accMappingGet: RouteHandler<typeof accMappingGetRoute, TargetRouteEnvironment>
  accMappingCatalog: RouteHandler<
    typeof accMappingCatalogRoute,
    TargetRouteEnvironment
  >
}

export function registerTargetRoutes<
  AppSchema extends Schema,
  BasePath extends string,
>(
  app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>,
  handlers: TargetRouteHandlers,
) {
  const base = app.openapiRoutes([
    { route: signinRoute, handler: handlers.signin },
    { route: restoreRoute, handler: handlers.restore },
    { route: queryUsersRoute, handler: handlers.queryUsers },
    { route: warehouseQueryRoute, handler: handlers.warehouseQuery },
    { route: warehouseGetRoute, handler: handlers.warehouseGet },
    { route: warehouseVersionsRoute, handler: handlers.warehouseVersions },
    { route: warehouseAuditRoute, handler: handlers.warehouseAudit },
    {
      route: warehouseManagerReferenceRoute,
      handler: handlers.warehouseManagerReference,
    },
    { route: warehouseSubmitNewRoute, handler: handlers.warehouseSubmitNew },
    {
      route: warehouseSubmitChangeRoute,
      handler: handlers.warehouseSubmitChange,
    },
    { route: warehouseApproveRoute, handler: handlers.warehouseApprove },
    { route: warehouseRejectRoute, handler: handlers.warehouseReject },
    { route: warehouseUnrejectRoute, handler: handlers.warehouseUnreject },
    { route: warehouseUnapproveRoute, handler: handlers.warehouseUnapprove },
    { route: warehouseDeleteRoute, handler: handlers.warehouseDelete },
    { route: warehouseReferenceRoute, handler: handlers.warehouseReference },
    { route: accMappingQueryRoute, handler: handlers.accMappingQuery },
    { route: accMappingGetRoute, handler: handlers.accMappingGet },
    { route: accMappingCatalogRoute, handler: handlers.accMappingCatalog },
  ] as const)
  const independent = registerIndependentRoutes(
    new OpenAPIHono<TargetRouteEnvironment>(),
    handlers.independent,
  )
  const archives = registerArchiveRoutes(
    new OpenAPIHono<TargetRouteEnvironment>(),
    handlers.archive,
    handlers.archiveAttachments,
  )
  return base.route('/', independent).route('/', archives)
}

function targetAppType() {
  return registerTargetRoutes(
    new OpenAPIHono<TargetRouteEnvironment>(),
    undefined as unknown as TargetRouteHandlers,
  )
}

export type TargetAppType = ReturnType<typeof targetAppType>
