import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const envelope = z.object({ code: z.number().int(), errorKey: z.string(), message: z.string(), data: z.unknown().nullable(), requestId: z.string() })
const identity = z.object({ id: z.string().length(26) }).strict()
const revisionIdentity = identity.extend({ expectedRevision: z.string().regex(/^[1-9]\d*$/) }).strict()
const bookCreate = z.object({ id: z.string().length(26), name: z.string().trim().min(1).max(200), description: z.string().max(1000), startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), baseCurrency: z.string().regex(/^[A-Z]{3}$/) }).strict()
const bookSave = z.object({ id: z.string().length(26), expectedRevision: z.string().regex(/^[1-9]\d*$/), name: z.string().trim().min(1).max(200), description: z.string().max(1000), baseCurrency: z.string().regex(/^[A-Z]{3}$/) }).strict()
const subject = z.object({ id: z.string().length(26), bookId: z.string().length(26), code: z.string().min(1).max(64), name: z.string().trim().min(1).max(200), parentId: z.string().length(26).nullable(), balanceDirection: z.enum(['DEBIT', 'CREDIT']), enabled: z.boolean(), requiredDimensions: z.array(z.enum(['CUSTOMER_SUBUNIT', 'SUPPLIER', 'OTHER_UNIT', 'EMPLOYEE', 'SALES_PARTNER', 'DEPARTMENT', 'PRODUCT', 'WAREHOUSE', 'FUND_ACCOUNT', 'ASSET', 'BILL'])), inventoryQuantity: z.boolean(), settlementPurpose: z.string().min(1).max(32) }).strict()
const subjectSave = subject.extend({ expectedRevision: z.string().regex(/^[1-9]\d*$/) }).strict()
const bookIdentity = z.object({ bookId: z.string().length(26) }).strict()
const opening = z.object({
  bookId: z.string().length(26), submissionId: z.string().length(26), idempotencyKey: z.string().min(1).max(128),
  lines: z.array(z.object({ subjectId: z.string().length(26), currency: z.string().regex(/^[A-Z]{3}$/), direction: z.enum(['DEBIT', 'CREDIT']), amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/), dimensions: z.record(z.string(), z.string().length(26)) }).strict()),
  assets: z.array(z.unknown()), bills: z.array(z.unknown()), containers: z.array(z.unknown()),
}).strict()
const openingReview = z.object({ bookId: z.string().length(26), submissionId: z.string().length(26), expectedRevision: z.string().regex(/^[1-9]\d*$/) }).strict()
const openingReason = openingReview.extend({ reason: z.string().trim().min(1).max(1000) }).strict()
const period = z.object({ bookId: z.string().length(26), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), expectedRevision: z.string().regex(/^[1-9]\d*$/).nullable() }).strict()

function route<const Path extends string>(path: Path, request: z.ZodType) {
  return createRoute({ method: 'post', path, request: { body: { content: { 'application/json': { schema: request } } } }, responses: { 200: { description: path, content: { 'application/json': { schema: envelope } } } } })
}

export const accRouteSet = {
  bookQuery: route('/acc/book/query', z.object({}).strict()), bookGet: route('/acc/book/get', identity),
  bookCreate: route('/acc/book/create', bookCreate), bookSave: route('/acc/book/save', bookSave), bookDelete: route('/acc/book/delete', revisionIdentity),
  subjectQuery: route('/acc/subject/query', bookIdentity), subjectGet: route('/acc/subject/get', identity),
  subjectCreate: route('/acc/subject/create', subject), subjectSave: route('/acc/subject/save', subjectSave), subjectDelete: route('/acc/subject/delete', revisionIdentity),
  openingQuery: route('/acc/opening/query', bookIdentity), openingSubmit: route('/acc/opening/submit-new', opening),
  openingApprove: route('/acc/opening/approve', openingReview), openingReject: route('/acc/opening/reject', openingReason), openingUnreject: route('/acc/opening/unreject', openingReview), openingUnapprove: route('/acc/opening/unapprove', openingReason), openingDelete: route('/acc/opening/delete', openingReview),
  periodQuery: route('/acc/period/query', bookIdentity), periodLock: route('/acc/period/lock', period), periodUnlock: route('/acc/period/unlock', period),
} as const

export const accRouteMetadata = Object.values(accRouteSet).map((item) => ({ method: item.method, path: item.path, permission: item.path, title: item.path }))
export type AccRouteAction = keyof typeof accRouteSet
export type AccRouteHandler = (action: AccRouteAction, context: any) => Promise<Response>

export function registerAccRoutes<AppSchema extends Schema, BasePath extends string>(app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>, handler: AccRouteHandler) {
  const bq = app.openapi(accRouteSet.bookQuery, (c) => handler('bookQuery', c) as never)
  const bg = bq.openapi(accRouteSet.bookGet, (c) => handler('bookGet', c) as never)
  const bc = bg.openapi(accRouteSet.bookCreate, (c) => handler('bookCreate', c) as never)
  const bs = bc.openapi(accRouteSet.bookSave, (c) => handler('bookSave', c) as never)
  const bd = bs.openapi(accRouteSet.bookDelete, (c) => handler('bookDelete', c) as never)
  const sq = bd.openapi(accRouteSet.subjectQuery, (c) => handler('subjectQuery', c) as never)
  const sg = sq.openapi(accRouteSet.subjectGet, (c) => handler('subjectGet', c) as never)
  const sc = sg.openapi(accRouteSet.subjectCreate, (c) => handler('subjectCreate', c) as never)
  const ss = sc.openapi(accRouteSet.subjectSave, (c) => handler('subjectSave', c) as never)
  const sd = ss.openapi(accRouteSet.subjectDelete, (c) => handler('subjectDelete', c) as never)
  const oq = sd.openapi(accRouteSet.openingQuery, (c) => handler('openingQuery', c) as never)
  const os = oq.openapi(accRouteSet.openingSubmit, (c) => handler('openingSubmit', c) as never)
  const oa = os.openapi(accRouteSet.openingApprove, (c) => handler('openingApprove', c) as never)
  const or = oa.openapi(accRouteSet.openingReject, (c) => handler('openingReject', c) as never)
  const our = or.openapi(accRouteSet.openingUnreject, (c) => handler('openingUnreject', c) as never)
  const oua = our.openapi(accRouteSet.openingUnapprove, (c) => handler('openingUnapprove', c) as never)
  const od = oua.openapi(accRouteSet.openingDelete, (c) => handler('openingDelete', c) as never)
  const pq = od.openapi(accRouteSet.periodQuery, (c) => handler('periodQuery', c) as never)
  const pl = pq.openapi(accRouteSet.periodLock, (c) => handler('periodLock', c) as never)
  return pl.openapi(accRouteSet.periodUnlock, (c) => handler('periodUnlock', c) as never)
}
