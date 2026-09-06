import { createRoute, z } from '@hono/zod-openapi'

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

export type AuxContractEntity = (typeof auxEntities)[number]
export type AuxRouteAction =
  'query' | 'get' | 'create' | 'save' | 'enable' | 'disable' | 'delete'

export interface AuxRouteBinding {
  entity: AuxContractEntity
  action: AuxRouteAction
  permission: string
}

const identifierShape = {
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
}
const revisionShape = {
  revision: z.string().regex(/^[1-9]\d*$/),
}
const nameShape = { name: z.string().min(1).max(200) }
const descriptionShape = { description: z.string().max(1000).default('') }
const parentShape = { parentId: z.string().max(26).default('') }
const money = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
const percentage = z
  .string()
  .regex(/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$/)
  .refine((value) => Number(value) <= 99.99)
const behaviorProfile = z.enum([
  'RAW_MATERIAL',
  'STANDARD_FINISHED',
  'CUSTOM_FINISHED',
  'PACKAGING',
])
const settlementTermCode = z.enum([
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

const auxWriteShapes = {
  'product-category': {
    ...nameShape,
    ...parentShape,
    ...descriptionShape,
  },
  'product-type': {
    ...nameShape,
    behaviorProfile,
    ...descriptionShape,
  },
  'employee-category': { ...nameShape, ...descriptionShape },
  department: { ...nameShape, ...parentShape, ...descriptionShape },
  position: { ...nameShape, ...descriptionShape },
  'settlement-method': {
    ...nameShape,
    termCode: settlementTermCode,
    ruleType: z.enum(['RELATIVE_DAYS', 'MONTH_END']),
    monthOffset: z.number().int().min(0).max(3),
    dayOfMonth: z.number().int().min(0).max(31),
    dayOffset: z.number().int().min(0).max(30),
    defaultSalesSurcharge: money,
    ...descriptionShape,
  },
  'payment-method': {
    ...nameShape,
    defaultSalesSurcharge: money.default('0.00'),
    ...descriptionShape,
  },
  'dictionary-type': { ...nameShape, ...descriptionShape },
  'dictionary-item': {
    ...nameShape,
    dictionaryTypeId: identifierShape.id,
    sortOrder: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  },
  'measurement-unit': {
    ...nameShape,
    symbol: z.string().min(1).max(64),
    quantityScale: z.number().int().min(0).max(6),
  },
  'income-expense-type': {
    ...nameShape,
    direction: z.enum(['INCOME', 'EXPENSE']),
    ...parentShape,
    ...descriptionShape,
  },
  'asset-category': {
    ...nameShape,
    defaultUsefulLifeMonths: z.number().int().min(1).max(1200),
    defaultResidualRate: percentage,
    ...descriptionShape,
  },
} as const

const auxDetailOnlyShapes = {
  'product-category': {},
  'product-type': {},
  'employee-category': {},
  department: {},
  position: {},
  'settlement-method': {},
  'payment-method': {},
  'dictionary-type': {},
  'dictionary-item': {
    dictionaryTypeCode: z.string(),
    dictionaryTypeName: z.string(),
  },
  'measurement-unit': {},
  'income-expense-type': {},
  'asset-category': {},
} as const

const listItem = z
  .object({
    ...identifierShape,
    code: z.string(),
    py: z.string(),
    ...nameShape,
    enabled: z.boolean(),
    ...revisionShape,
    availableActions: z.array(z.enum(['edit', 'enable', 'disable'])),
  })
  .strict()

const page = z
  .object({
    items: z.array(listItem),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.literal(20),
  })
  .strict()

const queryRequest = z
  .object({
    keyword: z.string().max(200).optional(),
    page: z.number().int().positive(),
    pageSize: z.literal(20),
  })
  .strict()

const mutation = z
  .object({
    ...identifierShape,
    ...revisionShape,
    enabled: z.boolean(),
  })
  .strict()

export function auxQueryRoute<const Path extends string>(path: Path) {
  return postRoute(path, queryRequest, page)
}

export function auxGetRoute<
  const Path extends string,
  const Entity extends AuxContractEntity,
>(path: Path, entity: Entity) {
  return postRoute(
    path,
    z.object(identifierShape).strict(),
    z
      .object({
        ...listItem.shape,
        ...auxWriteShapes[entity],
        ...auxDetailOnlyShapes[entity],
        updatedAt: z.string().datetime(),
        updatedBy: z.string(),
      })
      .strict(),
  )
}

export function auxCreateRoute<
  const Path extends string,
  const Entity extends AuxContractEntity,
>(path: Path, entity: Entity) {
  return postRoute(path, z.object(auxWriteShapes[entity]).strict(), mutation)
}

export function auxSaveRoute<
  const Path extends string,
  const Entity extends AuxContractEntity,
>(path: Path, entity: Entity) {
  return postRoute(
    path,
    z
      .object({
        ...identifierShape,
        ...revisionShape,
        ...auxWriteShapes[entity],
      })
      .strict(),
    mutation,
  )
}

const idRevision = z.object({ ...identifierShape, ...revisionShape }).strict()

export function auxEnableRoute<const Path extends string>(path: Path) {
  return postRoute(path, idRevision, mutation)
}

export function auxDisableRoute<const Path extends string>(path: Path) {
  return postRoute(path, idRevision, mutation)
}

export function auxDeleteRoute<const Path extends string>(path: Path) {
  return postRoute(
    path,
    idRevision,
    z.object({ deleted: z.literal(true) }).strict(),
  )
}

const referenceRequest = z
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
    behaviorProfile: behaviorProfile.optional(),
    symbol: z.string().min(1).max(64).optional(),
    quantityScale: z.number().int().nonnegative().optional(),
    termCode: settlementTermCode.optional(),
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

export const auxReferenceRouteBinding = {
  permission: '/aux/reference/query',
} as const

export const auxReferenceRoute = postRoute(
  '/aux/reference/query',
  referenceRequest,
  z.array(auxReferenceCandidateSchema),
)

export function auxRouteBinding(
  entity: AuxContractEntity,
  action: AuxRouteAction,
): AuxRouteBinding {
  return { entity, action, permission: `/aux/${entity}/${action}` }
}
