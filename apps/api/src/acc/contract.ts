import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'

import type { Schema } from 'hono'
import {
  accBookTemplates,
  accSettlementPurposes,
  accSubjectDimensions,
} from '@zerp/model'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const identity = z.object({ id: z.string().length(26) }).strict()
const revisionIdentity = identity
  .extend({ expectedRevision: z.string().regex(/^[1-9]\d*$/) })
  .strict()
const accessUserIds = z.array(z.string().length(26)).max(500)
const accessUserIdsResponse = z.array(z.string().length(26))
const bookQuery = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(20),
    keyword: z.string().trim().max(200).optional(),
  })
  .strict()
const bookCreate = z
  .object({
    id: z.string().length(26),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(1000),
    startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    subjectTemplate: z.enum(accBookTemplates),
    queryUserIds: accessUserIds,
    operateUserIds: accessUserIds,
  })
  .strict()
const bookSave = z
  .object({
    id: z.string().length(26),
    expectedRevision: z.string().regex(/^[1-9]\d*$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(1000),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    queryUserIds: accessUserIds,
    operateUserIds: accessUserIds,
  })
  .strict()
const subject = z
  .object({
    id: z.string().length(26),
    bookId: z.string().length(26),
    code: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    parentId: z.string().length(26).nullable(),
    balanceDirection: z.enum(['DEBIT', 'CREDIT']),
    enabled: z.boolean(),
    requiredDimensions: z.array(z.enum(accSubjectDimensions)),
    inventoryQuantity: z.boolean(),
    settlementPurpose: z.enum(accSettlementPurposes),
  })
  .strict()
const subjectSave = subject
  .extend({ expectedRevision: z.string().regex(/^[1-9]\d*$/) })
  .strict()
const bookIdentity = z.object({ bookId: z.string().length(26) }).strict()
const subjectQuery = bookIdentity
  .extend({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(20),
    keyword: z.string().trim().max(200).optional(),
  })
  .strict()
const period = z
  .object({
    bookId: z.string().length(26),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    expectedRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .nullable(),
  })
  .strict()

const revision = z.string().regex(/^[1-9]\d*$/)
const bookView = z
  .object({
    id: z.string().length(26),
    code: z.string().regex(/^ACC-\d{4}$/),
    name: z.string(),
    description: z.string(),
    startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    baseCurrency: z.string().regex(/^[A-Z]{3}$/),
    controlBook: z.boolean(),
    revision,
    queryUserIds: accessUserIdsResponse,
    operateUserIds: accessUserIdsResponse,
  })
  .strict()
const subjectView = subject.extend({ revision }).strict()
const periodView = z
  .object({
    bookId: z.string().length(26),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    locked: z.boolean(),
    revision,
  })
  .strict()
const deleted = z
  .object({ id: z.string().length(26), deleted: z.literal(true) })
  .strict()
const failureEnvelope = z
  .object({
    code: z
      .number()
      .int()
      .refine((value) => value !== 0),
    errorKey: z.string().min(1),
    message: z.string(),
    data: z.union([
      z.null(),
      z.object({ blockers: z.array(z.unknown()) }).strict(),
    ]),
    requestId: z.string(),
  })
  .strict()
function envelope<Data extends z.ZodType>(data: Data) {
  return z.union([
    z
      .object({
        code: z.literal(0),
        errorKey: z.literal(''),
        message: z.literal('ok'),
        data,
        requestId: z.string(),
      })
      .strict(),
    failureEnvelope,
  ])
}

function route<
  const Path extends string,
  Request extends z.ZodType,
  Response extends z.ZodType,
>(path: Path, request: Request, response: Response) {
  return createRoute({
    method: 'post',
    path,
    request: { body: { content: { 'application/json': { schema: request } } } },
    responses: {
      200: {
        description: path,
        content: { 'application/json': { schema: response } },
      },
    },
  })
}

export const accRouteSet = {
  bookQuery: route(
    '/acc/book/query',
    bookQuery,
    envelope(
      z
        .object({
          items: z.array(bookView),
          total: z.number().int().nonnegative(),
          page: z.number().int().positive(),
          pageSize: z.number().int().positive(),
        })
        .strict(),
    ),
  ),
  bookGet: route('/acc/book/get', identity, envelope(bookView)),
  bookCreate: route('/acc/book/create', bookCreate, envelope(bookView)),
  bookSave: route('/acc/book/save', bookSave, envelope(bookView)),
  bookDelete: route('/acc/book/delete', revisionIdentity, envelope(deleted)),
  subjectQuery: route(
    '/acc/subject/query',
    subjectQuery,
    envelope(
      z
        .object({
          items: z.array(subjectView),
          total: z.number().int().nonnegative(),
          page: z.number().int().positive(),
          pageSize: z.number().int().positive(),
        })
        .strict(),
    ),
  ),
  subjectGet: route('/acc/subject/get', identity, envelope(subjectView)),
  subjectCreate: route('/acc/subject/create', subject, envelope(subjectView)),
  subjectSave: route('/acc/subject/save', subjectSave, envelope(subjectView)),
  subjectDelete: route(
    '/acc/subject/delete',
    revisionIdentity,
    envelope(deleted),
  ),
  periodQuery: route(
    '/acc/period/query',
    bookIdentity,
    envelope(z.array(periodView)),
  ),
  periodLock: route('/acc/period/lock', period, envelope(periodView)),
  periodUnlock: route('/acc/period/unlock', period, envelope(periodView)),
} as const

export const accRouteMetadata = Object.values(accRouteSet).map((item) => ({
  method: item.method,
  path: item.path,
  permission: item.path,
  title: item.path,
}))
export type AccRouteAction = keyof typeof accRouteSet
export type AccRouteHandler = (
  action: AccRouteAction,
  context: any,
) => Promise<Response>

export function registerAccRoutes<
  AppSchema extends Schema,
  BasePath extends string,
>(
  app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>,
  handler: AccRouteHandler,
) {
  const bq = app.openapi(
    accRouteSet.bookQuery,
    (c) => handler('bookQuery', c) as never,
  )
  const bg = bq.openapi(
    accRouteSet.bookGet,
    (c) => handler('bookGet', c) as never,
  )
  const bc = bg.openapi(
    accRouteSet.bookCreate,
    (c) => handler('bookCreate', c) as never,
  )
  const bs = bc.openapi(
    accRouteSet.bookSave,
    (c) => handler('bookSave', c) as never,
  )
  const bd = bs.openapi(
    accRouteSet.bookDelete,
    (c) => handler('bookDelete', c) as never,
  )
  const sq = bd.openapi(
    accRouteSet.subjectQuery,
    (c) => handler('subjectQuery', c) as never,
  )
  const sg = sq.openapi(
    accRouteSet.subjectGet,
    (c) => handler('subjectGet', c) as never,
  )
  const sc = sg.openapi(
    accRouteSet.subjectCreate,
    (c) => handler('subjectCreate', c) as never,
  )
  const ss = sc.openapi(
    accRouteSet.subjectSave,
    (c) => handler('subjectSave', c) as never,
  )
  const sd = ss.openapi(
    accRouteSet.subjectDelete,
    (c) => handler('subjectDelete', c) as never,
  )
  const pq = sd.openapi(
    accRouteSet.periodQuery,
    (c) => handler('periodQuery', c) as never,
  )
  const pl = pq.openapi(
    accRouteSet.periodLock,
    (c) => handler('periodLock', c) as never,
  )
  return pl.openapi(
    accRouteSet.periodUnlock,
    (c) => handler('periodUnlock', c) as never,
  )
}
