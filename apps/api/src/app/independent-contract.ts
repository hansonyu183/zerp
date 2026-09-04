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
const page = z.object({
  items: z.array(jsonObject),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})
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
  roles: z.array(jsonObject),
  manageable: z.boolean(),
  roleAssignmentEditable: z.boolean(),
})
const roleDetail = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status,
  type: z.enum(['NORMAL', 'SYSTEM', 'SUPERADMIN']),
  availableActions: z.array(z.enum(['VIEW', 'EDIT', 'ENABLE', 'DISABLE'])),
  assignable: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.string(),
  permissions: z.array(jsonObject),
})
const permissionDetail = z.object({
  path: z.string(),
  domain: z.string(),
  entity: z.string(),
  action: z.string(),
  description: z.string().nullable(),
  status,
  roleCount: z.number().int().nonnegative(),
})
const systemParameter = z.object({
  key: z.string(),
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
const roleQuery = postRoute('/app/role/query', pageRequest, page)
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
const permissionQuery = postRoute('/app/permission/query', pageRequest, page)
const permissionGet = postRoute(
  '/app/permission/get',
  identifier,
  permissionDetail,
)
const systemParameterQuery = postRoute(
  '/app/system-parameter/query',
  pageRequest,
  page,
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
const auxReferences = z.array(
  z.object({
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
    quantityScale: z.number().int().nonnegative().optional(),
  }),
)

function auxRoute<const Path extends string>(
  path: Path,
  action: 'query' | 'get' | 'create' | 'save' | 'enable' | 'disable' | 'delete',
) {
  if (action === 'query') return postRoute(path, auxQueryRequest, auxPage)
  if (action === 'get') return postRoute(path, objectIdentifier, auxObject)
  if (action === 'create') return postRoute(path, auxCreateRequest, auxMutation)
  if (action === 'save') return postRoute(path, auxSaveRequest, auxMutation)
  if (action === 'delete')
    return postRoute(
      path,
      objectRevision,
      z.object({ deleted: z.literal(true) }),
    )
  return postRoute(path, objectRevision, auxMutation)
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

const auxRouteActions = [
  'query',
  'get',
  'create',
  'save',
  'enable',
  'disable',
  'delete',
] as const

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
  // AUX/BOB CRUD routes are registered from finite runtime inventories. Keep
  // them executable without allowing their widened template-string paths to
  // erase the static client schema above or the reference seams below.
  fixed.openapiRoutes([
    ...auxEntities.flatMap((entity) =>
      auxRouteActions
        .filter(
          (action) =>
            entity !== 'settlement-method' ||
            (action !== 'create' && action !== 'delete'),
        )
        .map((action) => ({
          route: auxRoute(`/aux/${entity}/${action}`, action),
          handler: handlers.aux(auxRouteBinding(entity, action)),
        })),
    ),
    ...bobEntities.flatMap((entity) =>
      (['query', 'get'] as const).map((action) => ({
        route: bobRoute(`/bob/${entity}/${action}`, action),
        handler: handlers.bob(bobRouteBinding(entity, action)),
      })),
    ),
  ] as const)
  return fixed.openapiRoutes([
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
