import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
  z,
} from '@hono/zod-openapi'

export type TargetRouteEnvironment = {
  Variables: { requestId: string }
}

const failureEnvelope = z.object({
  code: z.number().int(),
  errorKey: z.string(),
  message: z.string(),
  data: z.null(),
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

export const targetRouteMetadata = [
  { method: signinRoute.method, path: signinRoute.path },
  { method: restoreRoute.method, path: restoreRoute.path },
  {
    method: queryUsersRoute.method,
    path: queryUsersRoute.path,
    permission: '/app/user/query',
    menu: { title: '用户管理', group: '系统管理', order: 10 },
  },
] as const

export interface TargetRouteHandlers {
  signin: RouteHandler<typeof signinRoute, TargetRouteEnvironment>
  restore: RouteHandler<typeof restoreRoute, TargetRouteEnvironment>
  queryUsers: RouteHandler<typeof queryUsersRoute, TargetRouteEnvironment>
}

export function registerTargetRoutes(
  app: OpenAPIHono<TargetRouteEnvironment>,
  handlers: TargetRouteHandlers,
) {
  return app.openapiRoutes([
    { route: signinRoute, handler: handlers.signin },
    { route: restoreRoute, handler: handlers.restore },
    { route: queryUsersRoute, handler: handlers.queryUsers },
  ] as const)
}

export type TargetAppType = ReturnType<typeof registerTargetRoutes>
