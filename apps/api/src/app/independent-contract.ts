import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Handler } from 'hono'

import type { TargetRouteEnvironment } from './contract.ts'
import {
  auxCreateRoute,
  auxDeleteRoute,
  auxDisableRoute,
  auxEnableRoute,
  auxEntities,
  auxGetRoute,
  employeeGetRoute,
  auxQueryRoute,
  measurementUnitQueryRoute,
  auxReferenceRoute,
  auxReferenceRouteBinding,
  auxRouteBinding,
  auxSaveRoute,
  operatingEntityGetRoute,
  type AuxRouteBinding,
} from './aux-contract.ts'
import { userRevisionSchema, userSummarySchema } from './user-contract.ts'

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
  data: z.unknown().nullable(),
  requestId: z.string(),
})

function successEnvelope<Data extends z.ZodType>(data: Data) {
  return z.union([
    z.object({
      code: z.literal(0),
      errorKey: z.literal(''),
      message: z.literal('ok'),
      data,
      requestId: z.string(),
    }),
    failureEnvelope,
  ])
}

function postRoute<
  const Path extends string,
  Request extends z.ZodType,
  Data extends z.ZodType,
>(path: Path, request: Request, data: Data) {
  return createRoute({
    method: 'post',
    path,
    request: {
      body: { content: { 'application/json': { schema: request } } },
    },
    responses: {
      200: {
        description: `${path} response envelope`,
        content: { 'application/json': { schema: successEnvelope(data) } },
      },
    },
  })
}

const empty = z.object({}).strict()
const identifier = z.object({ id: z.string().min(1).max(64) }).strict()
const userRevision = identifier.extend({ revision: userRevisionSchema })
const objectIdentifier = z
  .object({ objectId: z.string().min(1).max(64) })
  .strict()
const status = z.enum(['ENABLED', 'DISABLED'])
const jsonObject = z.record(z.string(), z.unknown())
function pageOf<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
}
const pageRequest = z
  .object({
    page: z.number().int().positive(),
    pageSize: z.number().int().min(1).max(100),
    filters: jsonObject.optional(),
    sort: z.array(jsonObject).optional(),
  })
  .strict()

const profile = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  passwordChangedAt: z.string().datetime(),
  revision: z.string(),
})
const roleReference = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  type: z.enum(['NORMAL', 'SYSTEM', 'SUPERADMIN']),
  assignable: z.boolean(),
})
const userDetail = userSummarySchema.extend({
  roles: z.array(roleReference),
  manageable: z.boolean(),
  roleAssignmentEditable: z.boolean(),
})
const roleListItem = z.object({
  py: z.string(),
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  type: z.enum(['NORMAL', 'SYSTEM', 'SUPERADMIN']),
  availableActions: z.array(z.enum(['edit', 'enable', 'disable'])),
  manageable: z.boolean(),
  assignable: z.boolean(),
  revision: userRevisionSchema,
})
const permissionReference = z.object({
  id: z.string(),
  path: z.string(),
  domain: z.string(),
  entity: z.string(),
  action: z.string(),
  description: z.string().nullable(),
  status,
})
const roleDetail = roleListItem.extend({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  permissions: z.array(permissionReference),
})
const permissionDetail = z.object({
  id: z.string(),
  path: z.string(),
  domain: z.string(),
  entity: z.string(),
  action: z.string(),
  description: z.string().nullable(),
  status,
  revision: z.string(),
  directRoleCount: z.number().int().nonnegative(),
})
const systemParameter = z.object({
  parameterKey: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  valueType: z.enum(['STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN']),
  configuredValue: z.string(),
  defaultValue: z.string(),
  editable: z.boolean(),
  constraints: jsonObject.nullable(),
  revision: z.string(),
})
const brandingGet = postRoute(
  '/session/app/get',
  empty,
  z.object({ enterpriseName: z.string() }),
)
const userSignout = postRoute('/session/auth/signout', empty, z.object({}))
const sessionUserGet = postRoute('/session/user/get', empty, profile)
const sessionUserSave = postRoute(
  '/session/user/save',
  z
    .object({
      name: z.string().min(1).max(128),
      avatarUrl: z.string().max(500).nullable().optional(),
    })
    .strict(),
  profile,
)
const userChangePassword = postRoute(
  '/session/user/change-password',
  z
    .object({
      currentPassword: z.string().min(1).max(1024),
      newPassword: z.string().min(1).max(1024),
    })
    .strict(),
  z.object({}),
)
const userGet = postRoute('/app/user/get', identifier, userDetail)
const userCreate = postRoute(
  '/app/user/create',
  z
    .object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(128),
      password: z.string().min(1).max(1024),
      roleIds: z.array(z.string()).min(1),
    })
    .strict(),
  userDetail,
)
const userSave = postRoute(
  '/app/user/save',
  z
    .object({
      id: z.string(),
      name: z.string().min(1).max(128),
      roleIds: z.array(z.string()).min(1),
      revision: userRevisionSchema,
    })
    .strict(),
  userDetail,
)
const userEnable = postRoute('/app/user/enable', userRevision, userDetail)
const userDisable = postRoute('/app/user/disable', userRevision, userDetail)
const userResetPassword = postRoute(
  '/app/user/reset-password',
  userRevision,
  z.object({ temporaryPassword: z.string() }),
)
const roleQuery = postRoute(
  '/app/role/query',
  z
    .object({
      keyword: z.string().max(128).optional(),
      page: z.number().int().positive(),
      pageSize: z.literal(20),
    })
    .strict(),
  pageOf(roleListItem),
)
const roleGet = postRoute('/app/role/get', identifier, roleDetail)
const roleCreate = postRoute(
  '/app/role/create',
  z
    .object({
      name: z.string().min(1).max(128),
      description: z.string().max(1000).nullable(),
      permissionIds: z.array(z.string()).min(1),
    })
    .strict(),
  roleDetail,
)
const roleSave = postRoute(
  '/app/role/save',
  z
    .object({
      id: z.string(),
      name: z.string().min(1).max(128),
      description: z.string().max(1000).nullable(),
      permissionIds: z.array(z.string()).min(1),
      revision: userRevisionSchema,
    })
    .strict(),
  roleDetail,
)
const roleEnable = postRoute('/app/role/enable', userRevision, roleDetail)
const roleDisable = postRoute('/app/role/disable', userRevision, roleDetail)
const permissionQuery = postRoute(
  '/app/permission/query',
  pageRequest,
  pageOf(permissionDetail),
)
const permissionGet = postRoute(
  '/app/permission/get',
  identifier,
  permissionDetail,
)
const systemParameterQuery = postRoute(
  '/app/system-parameter/query',
  pageRequest,
  pageOf(systemParameter),
)
const systemParameterGet = postRoute(
  '/app/system-parameter/get',
  z.object({ key: z.string() }).strict(),
  systemParameter,
)
const systemParameterSave = postRoute(
  '/app/system-parameter/save',
  z
    .object({
      key: z.string(),
      configuredValue: z.string(),
      revision: z.number().int().positive(),
    })
    .strict(),
  systemParameter,
)
const systemParameterReset = postRoute(
  '/app/system-parameter/reset',
  z.object({ key: z.string(), revision: z.number().int().positive() }).strict(),
  systemParameter,
)
const bobQueryRequest = pageRequest
const bobObject = z.object({
  objectId: z.string(),
  entity: z.string(),
  code: z.string(),
  enabled: z.boolean(),
  sourceApprovalEntryId: z.string(),
  sourceVersionNo: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  data: jsonObject,
})
const bobPage = z.object({
  items: z.array(bobObject),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})
const bobReferenceRequest = z
  .object({
    entity: z.enum([
      'customer-subunit',
      'other-unit',
      'supplier',
      'sales-partner',
      'product',
    ]),
    keyword: z.string().max(100).optional(),
    operatingEntityId: z.string().max(26).optional(),
    sourceObjectId: z.string().max(26).optional(),
    behaviorProfile: z
      .enum([
        'RAW_MATERIAL',
        'STANDARD_FINISHED',
        'CUSTOM_FINISHED',
        'PACKAGING',
      ])
      .optional(),
  })
  .strict()
const bobReferences = z.array(
  z.object({
    objectId: z.string(),
    code: z.string(),
    name: z.string(),
    sourceApprovalEntryId: z.string(),
    sourceVersionNo: z.number().int().positive(),
    data: jsonObject.optional(),
  }),
)

function bobRoute<const Path extends string>(
  path: Path,
  action: 'query' | 'get',
) {
  return action === 'query'
    ? postRoute(path, bobQueryRequest, bobPage)
    : postRoute(path, objectIdentifier, bobObject)
}

export const bobEntities = [
  'customer',
  'supplier',
  'other-unit',
  'sales-partner',
  'product',
  'warehouse',
  'vehicle',
  'fund-account',
] as const

type BobRouteAction = 'query' | 'get'

export interface BobRouteBinding {
  entity: (typeof bobEntities)[number]
  action: BobRouteAction
  permission: string
}

export const bobReferenceRouteBinding = {
  permission: '/bob/reference/query',
} as const

export const bobReferenceRoute = postRoute(
  '/bob/reference/query',
  bobReferenceRequest,
  bobReferences,
)

export function bobRouteBinding(
  entity: BobRouteBinding['entity'],
  action: BobRouteBinding['action'],
): BobRouteBinding {
  return { entity, action, permission: `/bob/${entity}/${action}` }
}

type IndependentHandler = Handler<TargetRouteEnvironment>

export interface IndependentRouteHandlers {
  app: IndependentHandler
  aux(
    binding: AuxRouteBinding | typeof auxReferenceRouteBinding,
  ): IndependentHandler
  bob(
    binding: BobRouteBinding | typeof bobReferenceRouteBinding,
  ): IndependentHandler
}

export function registerIndependentRoutes(
  app: OpenAPIHono<TargetRouteEnvironment>,
  handlers: IndependentRouteHandlers,
) {
  const fixed = app.openapiRoutes([
    { route: brandingGet, handler: handlers.app },
    { route: userSignout, handler: handlers.app },
    { route: sessionUserGet, handler: handlers.app },
    { route: sessionUserSave, handler: handlers.app },
    { route: userChangePassword, handler: handlers.app },
    { route: userGet, handler: handlers.app },
    { route: userCreate, handler: handlers.app },
    { route: userSave, handler: handlers.app },
    { route: userEnable, handler: handlers.app },
    { route: userDisable, handler: handlers.app },
    { route: userResetPassword, handler: handlers.app },
    { route: roleQuery, handler: handlers.app },
    { route: roleGet, handler: handlers.app },
    { route: roleCreate, handler: handlers.app },
    { route: roleSave, handler: handlers.app },
    { route: roleEnable, handler: handlers.app },
    { route: roleDisable, handler: handlers.app },
    { route: permissionQuery, handler: handlers.app },
    { route: permissionGet, handler: handlers.app },
    { route: systemParameterQuery, handler: handlers.app },
    { route: systemParameterGet, handler: handlers.app },
    { route: systemParameterSave, handler: handlers.app },
    { route: systemParameterReset, handler: handlers.app },
  ] as const)
  // Keep the finite AUX inventory as literal executable routes so the Hono
  // AppType exposes every direct-CRUD seam to the generated client.
  const withAux = fixed.openapiRoutes([
    {
      route: auxQueryRoute('/aux/operating-entity/query'),
      handler: handlers.aux(auxRouteBinding('operating-entity', 'query')),
    },
    {
      route: operatingEntityGetRoute('/aux/operating-entity/get'),
      handler: handlers.aux(auxRouteBinding('operating-entity', 'get')),
    },
    {
      route: auxCreateRoute('/aux/operating-entity/create', 'operating-entity'),
      handler: handlers.aux(auxRouteBinding('operating-entity', 'create')),
    },
    {
      route: auxSaveRoute('/aux/operating-entity/save', 'operating-entity'),
      handler: handlers.aux(auxRouteBinding('operating-entity', 'save')),
    },
    {
      route: auxEnableRoute('/aux/operating-entity/enable'),
      handler: handlers.aux(auxRouteBinding('operating-entity', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/operating-entity/disable'),
      handler: handlers.aux(auxRouteBinding('operating-entity', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/operating-entity/delete'),
      handler: handlers.aux(auxRouteBinding('operating-entity', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/employee/query'),
      handler: handlers.aux(auxRouteBinding('employee', 'query')),
    },
    {
      route: employeeGetRoute('/aux/employee/get'),
      handler: handlers.aux(auxRouteBinding('employee', 'get')),
    },
    {
      route: auxCreateRoute('/aux/employee/create', 'employee'),
      handler: handlers.aux(auxRouteBinding('employee', 'create')),
    },
    {
      route: auxSaveRoute('/aux/employee/save', 'employee'),
      handler: handlers.aux(auxRouteBinding('employee', 'save')),
    },
    {
      route: auxEnableRoute('/aux/employee/enable'),
      handler: handlers.aux(auxRouteBinding('employee', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/employee/disable'),
      handler: handlers.aux(auxRouteBinding('employee', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/employee/delete'),
      handler: handlers.aux(auxRouteBinding('employee', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/product-category/query'),
      handler: handlers.aux(auxRouteBinding('product-category', 'query')),
    },
    {
      route: auxGetRoute('/aux/product-category/get', 'product-category'),
      handler: handlers.aux(auxRouteBinding('product-category', 'get')),
    },
    {
      route: auxCreateRoute('/aux/product-category/create', 'product-category'),
      handler: handlers.aux(auxRouteBinding('product-category', 'create')),
    },
    {
      route: auxSaveRoute('/aux/product-category/save', 'product-category'),
      handler: handlers.aux(auxRouteBinding('product-category', 'save')),
    },
    {
      route: auxEnableRoute('/aux/product-category/enable'),
      handler: handlers.aux(auxRouteBinding('product-category', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/product-category/disable'),
      handler: handlers.aux(auxRouteBinding('product-category', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/product-category/delete'),
      handler: handlers.aux(auxRouteBinding('product-category', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/product-type/query'),
      handler: handlers.aux(auxRouteBinding('product-type', 'query')),
    },
    {
      route: auxGetRoute('/aux/product-type/get', 'product-type'),
      handler: handlers.aux(auxRouteBinding('product-type', 'get')),
    },
    {
      route: auxCreateRoute('/aux/product-type/create', 'product-type'),
      handler: handlers.aux(auxRouteBinding('product-type', 'create')),
    },
    {
      route: auxSaveRoute('/aux/product-type/save', 'product-type'),
      handler: handlers.aux(auxRouteBinding('product-type', 'save')),
    },
    {
      route: auxEnableRoute('/aux/product-type/enable'),
      handler: handlers.aux(auxRouteBinding('product-type', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/product-type/disable'),
      handler: handlers.aux(auxRouteBinding('product-type', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/product-type/delete'),
      handler: handlers.aux(auxRouteBinding('product-type', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/employee-category/query'),
      handler: handlers.aux(auxRouteBinding('employee-category', 'query')),
    },
    {
      route: auxGetRoute('/aux/employee-category/get', 'employee-category'),
      handler: handlers.aux(auxRouteBinding('employee-category', 'get')),
    },
    {
      route: auxCreateRoute(
        '/aux/employee-category/create',
        'employee-category',
      ),
      handler: handlers.aux(auxRouteBinding('employee-category', 'create')),
    },
    {
      route: auxSaveRoute('/aux/employee-category/save', 'employee-category'),
      handler: handlers.aux(auxRouteBinding('employee-category', 'save')),
    },
    {
      route: auxEnableRoute('/aux/employee-category/enable'),
      handler: handlers.aux(auxRouteBinding('employee-category', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/employee-category/disable'),
      handler: handlers.aux(auxRouteBinding('employee-category', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/employee-category/delete'),
      handler: handlers.aux(auxRouteBinding('employee-category', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/department/query'),
      handler: handlers.aux(auxRouteBinding('department', 'query')),
    },
    {
      route: auxGetRoute('/aux/department/get', 'department'),
      handler: handlers.aux(auxRouteBinding('department', 'get')),
    },
    {
      route: auxCreateRoute('/aux/department/create', 'department'),
      handler: handlers.aux(auxRouteBinding('department', 'create')),
    },
    {
      route: auxSaveRoute('/aux/department/save', 'department'),
      handler: handlers.aux(auxRouteBinding('department', 'save')),
    },
    {
      route: auxEnableRoute('/aux/department/enable'),
      handler: handlers.aux(auxRouteBinding('department', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/department/disable'),
      handler: handlers.aux(auxRouteBinding('department', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/department/delete'),
      handler: handlers.aux(auxRouteBinding('department', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/position/query'),
      handler: handlers.aux(auxRouteBinding('position', 'query')),
    },
    {
      route: auxGetRoute('/aux/position/get', 'position'),
      handler: handlers.aux(auxRouteBinding('position', 'get')),
    },
    {
      route: auxCreateRoute('/aux/position/create', 'position'),
      handler: handlers.aux(auxRouteBinding('position', 'create')),
    },
    {
      route: auxSaveRoute('/aux/position/save', 'position'),
      handler: handlers.aux(auxRouteBinding('position', 'save')),
    },
    {
      route: auxEnableRoute('/aux/position/enable'),
      handler: handlers.aux(auxRouteBinding('position', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/position/disable'),
      handler: handlers.aux(auxRouteBinding('position', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/position/delete'),
      handler: handlers.aux(auxRouteBinding('position', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/settlement-method/query'),
      handler: handlers.aux(auxRouteBinding('settlement-method', 'query')),
    },
    {
      route: auxGetRoute('/aux/settlement-method/get', 'settlement-method'),
      handler: handlers.aux(auxRouteBinding('settlement-method', 'get')),
    },
    {
      route: auxSaveRoute('/aux/settlement-method/save', 'settlement-method'),
      handler: handlers.aux(auxRouteBinding('settlement-method', 'save')),
    },
    {
      route: auxEnableRoute('/aux/settlement-method/enable'),
      handler: handlers.aux(auxRouteBinding('settlement-method', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/settlement-method/disable'),
      handler: handlers.aux(auxRouteBinding('settlement-method', 'disable')),
    },
    {
      route: auxQueryRoute('/aux/payment-method/query'),
      handler: handlers.aux(auxRouteBinding('payment-method', 'query')),
    },
    {
      route: auxGetRoute('/aux/payment-method/get', 'payment-method'),
      handler: handlers.aux(auxRouteBinding('payment-method', 'get')),
    },
    {
      route: auxCreateRoute('/aux/payment-method/create', 'payment-method'),
      handler: handlers.aux(auxRouteBinding('payment-method', 'create')),
    },
    {
      route: auxSaveRoute('/aux/payment-method/save', 'payment-method'),
      handler: handlers.aux(auxRouteBinding('payment-method', 'save')),
    },
    {
      route: auxEnableRoute('/aux/payment-method/enable'),
      handler: handlers.aux(auxRouteBinding('payment-method', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/payment-method/disable'),
      handler: handlers.aux(auxRouteBinding('payment-method', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/payment-method/delete'),
      handler: handlers.aux(auxRouteBinding('payment-method', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/dictionary-type/query'),
      handler: handlers.aux(auxRouteBinding('dictionary-type', 'query')),
    },
    {
      route: auxGetRoute('/aux/dictionary-type/get', 'dictionary-type'),
      handler: handlers.aux(auxRouteBinding('dictionary-type', 'get')),
    },
    {
      route: auxCreateRoute('/aux/dictionary-type/create', 'dictionary-type'),
      handler: handlers.aux(auxRouteBinding('dictionary-type', 'create')),
    },
    {
      route: auxSaveRoute('/aux/dictionary-type/save', 'dictionary-type'),
      handler: handlers.aux(auxRouteBinding('dictionary-type', 'save')),
    },
    {
      route: auxEnableRoute('/aux/dictionary-type/enable'),
      handler: handlers.aux(auxRouteBinding('dictionary-type', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/dictionary-type/disable'),
      handler: handlers.aux(auxRouteBinding('dictionary-type', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/dictionary-type/delete'),
      handler: handlers.aux(auxRouteBinding('dictionary-type', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/dictionary-item/query'),
      handler: handlers.aux(auxRouteBinding('dictionary-item', 'query')),
    },
    {
      route: auxGetRoute('/aux/dictionary-item/get', 'dictionary-item'),
      handler: handlers.aux(auxRouteBinding('dictionary-item', 'get')),
    },
    {
      route: auxCreateRoute('/aux/dictionary-item/create', 'dictionary-item'),
      handler: handlers.aux(auxRouteBinding('dictionary-item', 'create')),
    },
    {
      route: auxSaveRoute('/aux/dictionary-item/save', 'dictionary-item'),
      handler: handlers.aux(auxRouteBinding('dictionary-item', 'save')),
    },
    {
      route: auxEnableRoute('/aux/dictionary-item/enable'),
      handler: handlers.aux(auxRouteBinding('dictionary-item', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/dictionary-item/disable'),
      handler: handlers.aux(auxRouteBinding('dictionary-item', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/dictionary-item/delete'),
      handler: handlers.aux(auxRouteBinding('dictionary-item', 'delete')),
    },
    {
      route: measurementUnitQueryRoute('/aux/measurement-unit/query'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'query')),
    },
    {
      route: auxGetRoute('/aux/measurement-unit/get', 'measurement-unit'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'get')),
    },
    {
      route: auxCreateRoute('/aux/measurement-unit/create', 'measurement-unit'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'create')),
    },
    {
      route: auxSaveRoute('/aux/measurement-unit/save', 'measurement-unit'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'save')),
    },
    {
      route: auxEnableRoute('/aux/measurement-unit/enable'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/measurement-unit/disable'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/measurement-unit/delete'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/income-expense-type/query'),
      handler: handlers.aux(auxRouteBinding('income-expense-type', 'query')),
    },
    {
      route: auxGetRoute('/aux/income-expense-type/get', 'income-expense-type'),
      handler: handlers.aux(auxRouteBinding('income-expense-type', 'get')),
    },
    {
      route: auxCreateRoute(
        '/aux/income-expense-type/create',
        'income-expense-type',
      ),
      handler: handlers.aux(auxRouteBinding('income-expense-type', 'create')),
    },
    {
      route: auxSaveRoute(
        '/aux/income-expense-type/save',
        'income-expense-type',
      ),
      handler: handlers.aux(auxRouteBinding('income-expense-type', 'save')),
    },
    {
      route: auxEnableRoute('/aux/income-expense-type/enable'),
      handler: handlers.aux(auxRouteBinding('income-expense-type', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/income-expense-type/disable'),
      handler: handlers.aux(auxRouteBinding('income-expense-type', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/income-expense-type/delete'),
      handler: handlers.aux(auxRouteBinding('income-expense-type', 'delete')),
    },
    {
      route: auxQueryRoute('/aux/asset-category/query'),
      handler: handlers.aux(auxRouteBinding('asset-category', 'query')),
    },
    {
      route: auxGetRoute('/aux/asset-category/get', 'asset-category'),
      handler: handlers.aux(auxRouteBinding('asset-category', 'get')),
    },
    {
      route: auxCreateRoute('/aux/asset-category/create', 'asset-category'),
      handler: handlers.aux(auxRouteBinding('asset-category', 'create')),
    },
    {
      route: auxSaveRoute('/aux/asset-category/save', 'asset-category'),
      handler: handlers.aux(auxRouteBinding('asset-category', 'save')),
    },
    {
      route: auxEnableRoute('/aux/asset-category/enable'),
      handler: handlers.aux(auxRouteBinding('asset-category', 'enable')),
    },
    {
      route: auxDisableRoute('/aux/asset-category/disable'),
      handler: handlers.aux(auxRouteBinding('asset-category', 'disable')),
    },
    {
      route: auxDeleteRoute('/aux/asset-category/delete'),
      handler: handlers.aux(auxRouteBinding('asset-category', 'delete')),
    },
  ] as const)
  withAux.openapiRoutes([
    ...bobEntities.flatMap((entity) =>
      (['query', 'get'] as const).map((action) => ({
        route: bobRoute(`/bob/${entity}/${action}`, action),
        handler: handlers.bob(bobRouteBinding(entity, action)),
      })),
    ),
  ] as const)
  return withAux.openapiRoutes([
    {
      route: auxReferenceRoute,
      handler: handlers.aux(auxReferenceRouteBinding),
    },
    {
      route: bobReferenceRoute,
      handler: handlers.bob(bobReferenceRouteBinding),
    },
  ] as const)
}
const appPermissions = [
  ['user', 'get', '查看用户'],
  ['user', 'create', '创建用户'],
  ['user', 'save', '修改用户'],
  ['user', 'enable', '启用用户'],
  ['user', 'disable', '停用用户'],
  ['user', 'reset-password', '重置用户密码'],
  ['role', 'query', '查询角色'],
  ['role', 'get', '查看角色'],
  ['role', 'create', '创建角色'],
  ['role', 'save', '修改角色'],
  ['role', 'enable', '启用角色'],
  ['role', 'disable', '停用角色'],
  ['permission', 'query', '查询权限目录'],
  ['permission', 'get', '查看权限'],
  ['system-parameter', 'query', '查询系统参数'],
  ['system-parameter', 'get', '查看系统参数'],
  ['system-parameter', 'save', '修改系统参数'],
  ['system-parameter', 'reset', '重置系统参数'],
] as const

const auxNames: Record<(typeof auxEntities)[number], string> = {
  'product-category': '产品分类',
  'product-type': '产品类型',
  'employee-category': '员工分类',
  department: '部门',
  position: '岗位',
  'settlement-method': '结算方式',
  'payment-method': '收款方式',
  'dictionary-type': '字典类型',
  'dictionary-item': '字典项',
  'measurement-unit': '计量单位',
  'income-expense-type': '收支类型',
  'asset-category': '资产类别',
  'operating-entity': '经营主体',
  employee: '员工',
}

const bobNames: Record<(typeof bobEntities)[number], string> = {
  customer: '客户',
  supplier: '供应商',
  'other-unit': '其他单位',
  'sales-partner': '销售合作方',
  product: '产品',
  warehouse: '仓库',
  vehicle: '车辆',
  'fund-account': '资金账户',
}

export const independentRouteMetadata = [
  { method: 'post', path: '/session/app/get' },
  { method: 'post', path: '/session/auth/signout' },
  { method: 'post', path: '/session/user/get' },
  { method: 'post', path: '/session/user/save' },
  { method: 'post', path: '/session/user/change-password' },
  ...appPermissions.map(([entity, action, title]) => ({
    method: 'post',
    path: `/app/${entity}/${action}`,
    permission: `/app/${entity}/${action}`,
    title,
  })),
  ...auxEntities.flatMap((entity) =>
    ['query', 'get', 'create', 'save', 'enable', 'disable', 'delete']
      .filter(
        (action) =>
          entity !== 'settlement-method' ||
          (action !== 'create' && action !== 'delete'),
      )
      .map((action) => {
        const title = `${
          action === 'query'
            ? '查询'
            : action === 'get'
              ? '查看'
              : action === 'create'
                ? '创建'
                : action === 'save'
                  ? '保存'
                  : action === 'enable'
                    ? '启用'
                    : action === 'disable'
                      ? '停用'
                      : '删除'
        }${auxNames[entity]}`
        return {
          method: 'post',
          path: `/aux/${entity}/${action}`,
          permission: `/aux/${entity}/${action}`,
          title,
        }
      }),
  ),
  {
    method: 'post',
    path: '/aux/reference/query',
    permission: '/aux/reference/query',
    title: '查询 AUX 最小引用候选',
  },
  ...bobEntities.flatMap((entity) =>
    ['query', 'get'].map((action) => ({
      method: 'post',
      path: `/bob/${entity}/${action}`,
      permission: `/bob/${entity}/${action}`,
      title: `${action === 'query' ? '查询' : '查看'}${bobNames[entity]}`,
    })),
  ),
  {
    method: 'post',
    path: '/bob/reference/query',
    permission: '/bob/reference/query',
    title: '查询 BOB 最小引用候选',
  },
] as const
