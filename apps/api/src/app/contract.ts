import {
  createRoute,
  OpenAPIHono,
  type RouteHandler,
  z,
} from '@hono/zod-openapi'
import type { Schema } from 'hono'

import { userSummarySchema } from './user-contract.ts'

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
import { bobArchiveRouteMetadata, registerBobArchiveRoutes, type BobArchiveRouteHandler } from '../bob/archive-contract.ts'
import { registerVouRoutes, type VouRouteHandler } from '../vou/contract.ts'
import { registerAccRoutes, type AccRouteHandler } from '../acc/contract.ts'
import { registerWflRoutes, type WflRouteHandler } from '../wfl/contract.ts'
import { registerRptRoutes, type RptRouteHandler } from '../rpt/contract.ts'

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
  ]),
  requestId: z.string(),
})

const sessionData = z.object({
  user: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
  }),
  csrfToken: z.string(),
  apiPaths: z.array(z.string()),
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
    keyword: z.string().max(128),
    page: z.number().int().min(1),
    pageSize: z.literal(20),
  })
  .strict()

const userPage = z.object({
  items: z.array(userSummarySchema),
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

const workbenchQuery = z
  .object({
    page: z.number().int().min(1),
    pageSize: z.literal(20),
    filters: z
      .object({
        kind: z.enum(['ARCHIVE', 'DOCUMENT']).optional(),
        entity: z.string().min(1).max(64).optional(),
        status: z.enum(['PENDING', 'REJECTED']).optional(),
        keyword: z.string().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const workbenchPageEnvelope = z.union([
  z.object({
    code: z.literal(0),
    errorKey: z.literal(''),
    message: z.literal('ok'),
    data: z
      .object({
        items: z.array(
          z
            .object({
              domain: z.enum(['dcl', 'bob', 'vou']),
              entity: z.string(),
              subjectOrDocumentId: z.string(),
              submissionId: z.string(),
              code: z.string(),
              name: z.string(),
              status: z.enum(['PENDING', 'REJECTED']),
              revision: z.string(),
              availableActions: z.array(
                z.enum([
                  'view',
                  'edit',
                  'delete',
                  'reject',
                  'approve',
                  'unreject',
                ]),
              ),
              updatedAt: z.string().datetime(),
            })
            .strict(),
        ),
        total: z.number().int().nonnegative(),
        page: z.number().int().positive(),
        pageSize: z.literal(20),
      })
      .strict(),
    requestId: z.string(),
  }),
  failureEnvelope,
])

export const queryWorkbenchRoute = createRoute({
  method: 'post',
  path: '/app/workbench/query',
  request: {
    body: { content: { 'application/json': { schema: workbenchQuery } } },
  },
  responses: {
    200: {
      description: 'Session-scoped actionable approval submissions',
      content: { 'application/json': { schema: workbenchPageEnvelope } },
    },
  },
})

export const signinRoute = createRoute({
  method: 'post',
  path: '/session/auth/signin',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z
            .object({
              code: z.string().min(1).max(64),
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
  path: '/session/auth/restore',
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
  { method: queryWorkbenchRoute.method, path: queryWorkbenchRoute.path },
  {
    method: queryUsersRoute.method,
    path: queryUsersRoute.path,
    permission: '/app/user/query',
    title: '查询用户',
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
  ...bobArchiveRouteMetadata,
] as const

export interface TargetRouteHandlers {
  independent: IndependentRouteHandlers
  archive: ArchiveRouteHandler
  bobArchive: BobArchiveRouteHandler
  archiveAttachments: ArchiveAttachmentHandlers
  signin: RouteHandler<typeof signinRoute, TargetRouteEnvironment>
  restore: RouteHandler<typeof restoreRoute, TargetRouteEnvironment>
  queryUsers: RouteHandler<typeof queryUsersRoute, TargetRouteEnvironment>
  queryWorkbench: RouteHandler<
    typeof queryWorkbenchRoute,
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
    { route: queryWorkbenchRoute, handler: handlers.queryWorkbench },
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
  const bobArchives = registerBobArchiveRoutes(
    new OpenAPIHono<TargetRouteEnvironment>(),
    handlers.bobArchive,
  )
  return base.route('/', independent).route('/', archives).route('/', bobArchives)
}

function targetAppType() {
  const base = registerTargetRoutes(
    new OpenAPIHono<TargetRouteEnvironment>(),
    undefined as unknown as TargetRouteHandlers,
  )
  const vou = registerVouRoutes(base, undefined as unknown as VouRouteHandler)
  const acc = registerAccRoutes(vou, undefined as unknown as AccRouteHandler)
  const wfl = registerWflRoutes(acc, undefined as unknown as WflRouteHandler)
  return registerRptRoutes(wfl, undefined as unknown as RptRouteHandler)
}

export type TargetAppType = ReturnType<typeof targetAppType>
