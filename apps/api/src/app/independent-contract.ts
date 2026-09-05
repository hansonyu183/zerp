import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Handler } from 'hono'

import type { TargetRouteEnvironment } from './contract.ts'

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
const revision = identifier.extend({ revision: z.number().int().positive() })
const objectIdentifier = z
  .object({ objectId: z.string().min(1).max(64) })
  .strict()
const objectRevision = objectIdentifier.extend({
  objectRevision: z.number().int().positive(),
})
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
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  passwordChangedAt: z.string().datetime(),
  revision: z.string(),
})
const roleReference = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  status,
  type: z.enum(['NORMAL', 'SYSTEM', 'SUPERADMIN']),
  assignable: z.boolean(),
})
const userDetail = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  status,
  system: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.string(),
  passwordChangedAt: z.string().datetime(),
  roles: z.array(roleReference),
  manageable: z.boolean(),
  roleAssignmentEditable: z.boolean(),
})
const roleListItem = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status,
  type: z.enum(['NORMAL', 'SYSTEM', 'SUPERADMIN']),
  availableActions: z.array(z.enum(['VIEW', 'EDIT', 'ENABLE', 'DISABLE'])),
  manageable: z.boolean(),
  assignable: z.boolean(),
  revision: z.string(),
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
const menuItem = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  type: z.enum(['GROUP', 'ROUTE']),
  level: z.number().int().min(1).max(2),
  order: z.number().int().nonnegative(),
  displayName: z.string(),
  icon: z.string().nullable(),
  enabled: z.boolean(),
  routeKey: z.string().nullable(),
  routePath: z.string().nullable(),
  permissionCode: z.string().nullable(),
})
const menuTree = z.object({ items: z.array(menuItem) })
const menuRouteOption = z.object({
  routeKey: z.string(),
  routePath: z.string(),
  displayName: z.string(),
  permissionCode: z.string().nullable(),
})
const menuData = z.object({
  mode: z.enum(['DEFAULT', 'BUSINESS']),
  revision: z.string(),
  defaultMenu: menuTree,
  businessMenu: menuTree,
  navigation: menuTree,
  availableRoutes: z.array(menuRouteOption),
})

const brandingGet = postRoute(
  '/app/branding/get',
  empty,
  z.object({ enterpriseName: z.string() }),
)
const userSignout = postRoute('/app/user/signout', empty, z.object({}))
const userProfile = postRoute(
  '/app/user/profile',
  z
    .object({
      displayName: z.string().min(1).max(128).optional(),
      avatarUrl: z.string().max(500).nullable().optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (Object.keys(input).length > 0 && input.displayName === undefined)
        context.addIssue({
          code: 'custom',
          path: ['displayName'],
          message: 'displayName is required when saving a profile',
        })
    }),
  profile,
)
const userChangePassword = postRoute(
  '/app/user/change-password',
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
      username: z.string().min(1).max(64),
      displayName: z.string().min(1).max(128),
      password: z.string().min(1).max(1024),
      roleIds: z.array(z.string()),
    })
    .strict(),
  userDetail,
)
const userSave = postRoute(
  '/app/user/save',
  z
    .object({
      id: z.string(),
      displayName: z.string().min(1).max(128),
      roleIds: z.array(z.string()),
      revision: z.number().int().positive(),
    })
    .strict(),
  userDetail,
)
const userEnable = postRoute('/app/user/enable', revision, userDetail)
const userDisable = postRoute('/app/user/disable', revision, userDetail)
const userResetPassword = postRoute(
  '/app/user/reset-password',
  revision,
  z.object({ temporaryPassword: z.string() }),
)
const roleQuery = postRoute(
  '/app/role/query',
  pageRequest,
  pageOf(roleListItem),
)
const roleGet = postRoute('/app/role/get', identifier, roleDetail)
const roleCreate = postRoute(
  '/app/role/create',
  z
    .object({
      name: z.string().min(1).max(128),
      description: z.string().max(1000).nullable(),
      permissionIds: z.array(z.string()),
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
      permissionIds: z.array(z.string()),
      revision: z.number().int().positive(),
    })
    .strict(),
  roleDetail,
)
const roleEnable = postRoute('/app/role/enable', revision, roleDetail)
const roleDisable = postRoute('/app/role/disable', revision, roleDetail)
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
const menuGet = postRoute('/app/menu/get', empty, menuData)
const menuSave = postRoute(
  '/app/menu/save-business',
  z
    .object({
      revision: z.number().int().positive(),
      items: z.array(
        z
          .object({
            id: z.string(),
            parentId: z.string().nullable(),
            type: z.enum(['GROUP', 'ROUTE']),
            order: z.number().int().nonnegative(),
            displayName: z.string().min(1).max(128),
            icon: z.string().max(128).nullable(),
            enabled: z.boolean(),
            routeKey: z.string().nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
  menuData,
)
const menuActivate = postRoute(
  '/app/menu/activate',
  z
    .object({
      mode: z.enum(['DEFAULT', 'BUSINESS']),
      revision: z.number().int().positive(),
    })
    .strict(),
  menuData,
)
const menuReset = postRoute(
  '/app/menu/reset-business',
  z.object({ revision: z.number().int().positive() }).strict(),
  menuData,
)

const auxData = jsonObject
const auxQueryRequest = pageRequest
const auxObject = z.object({
  objectId: z.string(),
  entity: z.string(),
  code: z.string(),
  enabled: z.boolean(),
  objectRevision: z.string(),
  data: auxData,
  updatedAt: z.string().datetime(),
  updatedBy: z.string(),
})
const auxPage = z.object({
  items: z.array(auxObject),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})
const auxCreateRequest = z
  .object({ data: jsonObject.and(z.object({ name: z.string().min(1) })) })
  .strict()
const auxSaveRequest = objectRevision.extend({ data: auxData })
const auxMutation = z.object({
  objectId: z.string(),
  objectRevision: z.string(),
  enabled: z.boolean(),
})
const auxReferenceRequest = z
  .object({
    entity: z.enum([
      'settlement-method',
      'payment-method',
      'dictionary-item',
      'product-type',
      'product-category',
      'employee-category',
      'department',
      'position',
      'measurement-unit',
    ]),
    keyword: z.string().max(100).optional(),
    dictionaryTypeCode: z.string().max(32).optional(),
  })
  .strict()
export const auxReferenceCandidateSchema = z
  .object({
    objectId: z.string(),
    code: z.string(),
    name: z.string(),
    behaviorProfile: z
      .enum([
        'RAW_MATERIAL',
        'STANDARD_FINISHED',
        'CUSTOM_FINISHED',
        'PACKAGING',
      ])
      .optional(),
    symbol: z.string().min(1).max(64).optional(),
    quantityScale: z.number().int().nonnegative().optional(),
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
    defaultSalesSurcharge: z
      .string()
      .regex(/^(?:0|[1-9]\d*)\.\d{2}$/)
      .optional(),
  })
  .strict()
const auxReferences = z.array(auxReferenceCandidateSchema)

function auxQueryRoute<const Path extends string>(path: Path) {
  return postRoute(path, auxQueryRequest, auxPage)
}
function auxGetRoute<const Path extends string>(path: Path) {
  return postRoute(path, objectIdentifier, auxObject)
}
function auxCreateRoute<const Path extends string>(path: Path) {
  return postRoute(path, auxCreateRequest, auxMutation)
}
function auxSaveRoute<const Path extends string>(path: Path) {
  return postRoute(path, auxSaveRequest, auxMutation)
}
function auxEnableRoute<const Path extends string>(path: Path) {
  return postRoute(path, objectRevision, auxMutation)
}
function auxDisableRoute<const Path extends string>(path: Path) {
  return postRoute(path, objectRevision, auxMutation)
}
function auxDeleteRoute<const Path extends string>(path: Path) {
  return postRoute(path, objectRevision, z.object({ deleted: z.literal(true) }))
}

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
      'operating-entity',
      'employee',
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

export const auxEntities = [
  'product-category',
  'product-type',
  'employee-category',
  'department',
  'position',
  'settlement-method',
  'payment-method',
  'dictionary-type',
  'dictionary-item',
  'measurement-unit',
  'income-expense-type',
  'asset-category',
] as const

export const bobEntities = [
  'customer',
  'supplier',
  'employee',
  'other-unit',
  'sales-partner',
  'product',
  'warehouse',
  'vehicle',
  'fund-account',
  'operating-entity',
] as const

type AuxRouteAction =
  'query' | 'get' | 'create' | 'save' | 'enable' | 'disable' | 'delete'
type BobRouteAction = 'query' | 'get'

export interface AuxRouteBinding {
  entity: (typeof auxEntities)[number]
  action: AuxRouteAction
  permission: string
}

export interface BobRouteBinding {
  entity: (typeof bobEntities)[number]
  action: BobRouteAction
  permission: string
}

export const auxReferenceRouteBinding = {
  permission: '/aux/reference/query',
} as const

export const auxReferenceRoute = postRoute(
  '/aux/reference/query',
  auxReferenceRequest,
  auxReferences,
)

export const bobReferenceRouteBinding = {
  permission: '/bob/reference/query',
} as const

export const bobReferenceRoute = postRoute(
  '/bob/reference/query',
  bobReferenceRequest,
  bobReferences,
)

export function auxRouteBinding(
  entity: AuxRouteBinding['entity'],
  action: AuxRouteBinding['action'],
): AuxRouteBinding {
  return { entity, action, permission: `/aux/${entity}/${action}` }
}

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
    { route: userProfile, handler: handlers.app },
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
    { route: menuGet, handler: handlers.app },
    { route: menuSave, handler: handlers.app },
    { route: menuActivate, handler: handlers.app },
    { route: menuReset, handler: handlers.app },
  ] as const)
  // Keep the finite AUX inventory as literal executable routes so the Hono
  // AppType exposes every direct-CRUD seam to the generated client.
  const withAux = fixed.openapiRoutes([
    {
      route: auxQueryRoute('/aux/product-category/query'),
      handler: handlers.aux(auxRouteBinding('product-category', 'query')),
    },
    {
      route: auxGetRoute('/aux/product-category/get'),
      handler: handlers.aux(auxRouteBinding('product-category', 'get')),
    },
    {
      route: auxCreateRoute('/aux/product-category/create'),
      handler: handlers.aux(auxRouteBinding('product-category', 'create')),
    },
    {
      route: auxSaveRoute('/aux/product-category/save'),
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
      route: auxGetRoute('/aux/product-type/get'),
      handler: handlers.aux(auxRouteBinding('product-type', 'get')),
    },
    {
      route: auxCreateRoute('/aux/product-type/create'),
      handler: handlers.aux(auxRouteBinding('product-type', 'create')),
    },
    {
      route: auxSaveRoute('/aux/product-type/save'),
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
      route: auxGetRoute('/aux/employee-category/get'),
      handler: handlers.aux(auxRouteBinding('employee-category', 'get')),
    },
    {
      route: auxCreateRoute('/aux/employee-category/create'),
      handler: handlers.aux(auxRouteBinding('employee-category', 'create')),
    },
    {
      route: auxSaveRoute('/aux/employee-category/save'),
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
      route: auxGetRoute('/aux/department/get'),
      handler: handlers.aux(auxRouteBinding('department', 'get')),
    },
    {
      route: auxCreateRoute('/aux/department/create'),
      handler: handlers.aux(auxRouteBinding('department', 'create')),
    },
    {
      route: auxSaveRoute('/aux/department/save'),
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
      route: auxGetRoute('/aux/position/get'),
      handler: handlers.aux(auxRouteBinding('position', 'get')),
    },
    {
      route: auxCreateRoute('/aux/position/create'),
      handler: handlers.aux(auxRouteBinding('position', 'create')),
    },
    {
      route: auxSaveRoute('/aux/position/save'),
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
      route: auxGetRoute('/aux/settlement-method/get'),
      handler: handlers.aux(auxRouteBinding('settlement-method', 'get')),
    },
    {
      route: auxSaveRoute('/aux/settlement-method/save'),
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
      route: auxGetRoute('/aux/payment-method/get'),
      handler: handlers.aux(auxRouteBinding('payment-method', 'get')),
    },
    {
      route: auxCreateRoute('/aux/payment-method/create'),
      handler: handlers.aux(auxRouteBinding('payment-method', 'create')),
    },
    {
      route: auxSaveRoute('/aux/payment-method/save'),
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
      route: auxGetRoute('/aux/dictionary-type/get'),
      handler: handlers.aux(auxRouteBinding('dictionary-type', 'get')),
    },
    {
      route: auxCreateRoute('/aux/dictionary-type/create'),
      handler: handlers.aux(auxRouteBinding('dictionary-type', 'create')),
    },
    {
      route: auxSaveRoute('/aux/dictionary-type/save'),
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
      route: auxGetRoute('/aux/dictionary-item/get'),
      handler: handlers.aux(auxRouteBinding('dictionary-item', 'get')),
    },
    {
      route: auxCreateRoute('/aux/dictionary-item/create'),
      handler: handlers.aux(auxRouteBinding('dictionary-item', 'create')),
    },
    {
      route: auxSaveRoute('/aux/dictionary-item/save'),
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
      route: auxQueryRoute('/aux/measurement-unit/query'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'query')),
    },
    {
      route: auxGetRoute('/aux/measurement-unit/get'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'get')),
    },
    {
      route: auxCreateRoute('/aux/measurement-unit/create'),
      handler: handlers.aux(auxRouteBinding('measurement-unit', 'create')),
    },
    {
      route: auxSaveRoute('/aux/measurement-unit/save'),
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
      route: auxGetRoute('/aux/income-expense-type/get'),
      handler: handlers.aux(auxRouteBinding('income-expense-type', 'get')),
    },
    {
      route: auxCreateRoute('/aux/income-expense-type/create'),
      handler: handlers.aux(auxRouteBinding('income-expense-type', 'create')),
    },
    {
      route: auxSaveRoute('/aux/income-expense-type/save'),
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
      route: auxGetRoute('/aux/asset-category/get'),
      handler: handlers.aux(auxRouteBinding('asset-category', 'get')),
    },
    {
      route: auxCreateRoute('/aux/asset-category/create'),
      handler: handlers.aux(auxRouteBinding('asset-category', 'create')),
    },
    {
      route: auxSaveRoute('/aux/asset-category/save'),
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
  ['user', 'get', '查看用户', null],
  ['user', 'create', '创建用户', null],
  ['user', 'save', '修改用户', null],
  ['user', 'enable', '启用用户', null],
  ['user', 'disable', '停用用户', null],
  ['user', 'reset-password', '重置用户密码', null],
  ['role', 'query', '查询角色', 20],
  ['role', 'get', '查看角色', null],
  ['role', 'create', '创建角色', null],
  ['role', 'save', '修改角色', null],
  ['role', 'enable', '启用角色', null],
  ['role', 'disable', '停用角色', null],
  ['permission', 'query', '查询权限目录', 30],
  ['permission', 'get', '查看权限', null],
  ['system-parameter', 'query', '查询系统参数', 40],
  ['system-parameter', 'get', '查看系统参数', null],
  ['system-parameter', 'save', '修改系统参数', null],
  ['system-parameter', 'reset', '重置系统参数', null],
  ['menu', 'save-business', '保存业务菜单', null],
  ['menu', 'activate', '切换菜单模式', null],
  ['menu', 'reset-business', '重置业务菜单', null],
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
  'asset-category': '资产分类',
}

const bobNames: Record<(typeof bobEntities)[number], string> = {
  customer: '客户',
  supplier: '供应商',
  employee: '员工',
  'other-unit': '其他单位',
  'sales-partner': '销售合作方',
  product: '产品',
  warehouse: '仓库',
  vehicle: '车辆',
  'fund-account': '资金账户',
  'operating-entity': '经营主体',
}

export const independentRouteMetadata = [
  { method: 'post', path: '/app/branding/get' },
  { method: 'post', path: '/app/user/signout' },
  { method: 'post', path: '/app/user/profile' },
  { method: 'post', path: '/app/user/change-password' },
  { method: 'post', path: '/app/menu/get' },
  ...appPermissions.map(([entity, action, title, order]) => ({
    method: 'post',
    path: `/app/${entity}/${action}`,
    permission: `/app/${entity}/${action}`,
    title,
    ...(order === null ? {} : { menu: { title, group: '系统管理', order } }),
  })),
  ...auxEntities.flatMap((entity, entityIndex) =>
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
          ...(action === 'query'
            ? {
                menu: {
                  title: auxNames[entity],
                  group: '辅助资料',
                  order: 100 + entityIndex * 10,
                },
              }
            : {}),
        }
      }),
  ),
  {
    method: 'post',
    path: '/aux/reference/query',
    permission: '/aux/reference/query',
    title: '查询 AUX 最小引用候选',
  },
  ...bobEntities.flatMap((entity, entityIndex) =>
    ['query', 'get'].map((action) => ({
      method: 'post',
      path: `/bob/${entity}/${action}`,
      permission: `/bob/${entity}/${action}`,
      title: `${action === 'query' ? '查询' : '查看'}${bobNames[entity]}`,
      ...(action === 'query'
        ? {
            menu: {
              title: bobNames[entity],
              group: '业务资料',
              order: 300 + entityIndex * 10,
            },
          }
        : {}),
    })),
  ),
  {
    method: 'post',
    path: '/bob/reference/query',
    permission: '/bob/reference/query',
    title: '查询 BOB 最小引用候选',
  },
] as const
