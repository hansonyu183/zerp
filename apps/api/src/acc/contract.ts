import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'
import { accBookTemplates, accSettlementPurposes, accSubjectDimensions } from '@zerp/model'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const identity = z.object({ id: z.string().length(26) }).strict()
const revisionIdentity = identity.extend({ expectedRevision: z.string().regex(/^[1-9]\d*$/) }).strict()
const accessUserIds = z.array(z.string().length(26)).max(500)
const accessUserIdsResponse = z.array(z.string().length(26))
const bookQuery = z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(200).default(20), keyword: z.string().trim().max(200).optional() }).strict()
const bookCreate = z.object({ id: z.string().length(26), name: z.string().trim().min(1).max(200), description: z.string().max(1000), startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), baseCurrency: z.string().regex(/^[A-Z]{3}$/), subjectTemplate: z.enum(accBookTemplates), queryUserIds: accessUserIds, operateUserIds: accessUserIds }).strict()
const bookSave = z.object({ id: z.string().length(26), expectedRevision: z.string().regex(/^[1-9]\d*$/), name: z.string().trim().min(1).max(200), description: z.string().max(1000), baseCurrency: z.string().regex(/^[A-Z]{3}$/), queryUserIds: accessUserIds, operateUserIds: accessUserIds }).strict()
const subject = z.object({ id: z.string().length(26), bookId: z.string().length(26), code: z.string().min(1).max(64), name: z.string().trim().min(1).max(200), parentId: z.string().length(26).nullable(), balanceDirection: z.enum(['DEBIT', 'CREDIT']), enabled: z.boolean(), requiredDimensions: z.array(z.enum(accSubjectDimensions)), inventoryQuantity: z.boolean(), settlementPurpose: z.enum(accSettlementPurposes) }).strict()
const subjectSave = subject.extend({ expectedRevision: z.string().regex(/^[1-9]\d*$/) }).strict()
const bookIdentity = z.object({ bookId: z.string().length(26) }).strict()
const subjectQuery = bookIdentity.extend({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(200).default(20), keyword: z.string().trim().max(200).optional() }).strict()
const money = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
const nonNegativeMoney = money
const optionalId = z.string().length(26).optional()
const archiveReference = z.object({
  entity: z.enum(['customer', 'supplier', 'other-unit', 'employee', 'sales-partner', 'operating-entity']),
  objectId: z.string().length(26),
  customerId: z.string().length(26).optional(),
  approvalEntryId: z.string().length(26),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
}).strict()
const openingAsset = z.object({
  assetId: optionalId,
  assetNo: z.string().trim().max(64).optional(),
  name: z.string().trim().max(200).optional(),
  categoryId: optionalId,
  departmentId: optionalId,
  usefulLifeMonths: z.number().int().positive().max(1200).optional(),
  residualRate: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/).optional(),
  acquiredOn: z.string().date().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  originalValue: money,
  accumulatedDepreciation: nonNegativeMoney,
}).strict()
const openingBill = z.object({
  billId: optionalId,
  billNo: z.string().trim().max(200).optional(),
  billType: z.string().trim().max(64).optional(),
  positionType: z.enum(['ASSET', 'LIABILITY']).optional(),
  medium: z.enum(['PAPER', 'ELECTRONIC']).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  faceAmount: nonNegativeMoney.optional(),
  issueDate: z.string().date().optional(),
  maturityDate: z.string().date().optional(),
  drawer: z.string().trim().max(200).optional(),
  acceptor: z.string().trim().max(200).optional(),
  payee: z.string().trim().max(200).optional(),
  annualRateBps: z.number().int().nonnegative().max(100000).optional(),
  interestDays: z.number().int().nonnegative().max(36500).optional(),
  interestAmount: nonNegativeMoney.optional(),
  customerCostAmount: nonNegativeMoney.optional(),
  valueAmount: money,
  originatingCounterparty: archiveReference.optional(),
}).strict()
const openingContainer = z.object({
  subunit: z.object({
    entity: z.literal('customer-subunit'),
    objectId: z.string().length(26),
    customerId: z.string().length(26),
    approvalEntryId: z.string().length(26),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
  }).strict(),
  containerType: z.enum(['SOLVENT', 'RESIN']),
  quantity: z.number().int().refine((value) => value !== 0),
}).strict()
const opening = z.object({
  bookId: z.string().length(26), submissionId: z.string().length(26), idempotencyKey: z.string().min(1).max(128),
  lines: z.array(z.object({ subjectId: z.string().length(26), currency: z.string().regex(/^[A-Z]{3}$/), direction: z.enum(['DEBIT', 'CREDIT']), amount: money, dimensions: z.record(z.string(), z.string().length(26)), quantity: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/).optional() }).strict()),
  assets: z.array(openingAsset), bills: z.array(openingBill), containers: z.array(openingContainer),
}).strict()
const openingReview = z.object({ bookId: z.string().length(26), submissionId: z.string().length(26), expectedRevision: z.string().regex(/^[1-9]\d*$/) }).strict()
const openingReason = openingReview.extend({ reason: z.string().trim().min(1).max(1000) }).strict()
const period = z.object({ bookId: z.string().length(26), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), expectedRevision: z.string().regex(/^[1-9]\d*$/).nullable() }).strict()

const revision = z.string().regex(/^[1-9]\d*$/)
const bookView = z.object({
  id: z.string().length(26), code: z.string().regex(/^ACC-\d{4}$/), name: z.string(), description: z.string(),
  startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  controlBook: z.boolean(), revision, queryUserIds: accessUserIdsResponse, operateUserIds: accessUserIdsResponse,
}).strict()
const subjectView = subject.extend({ revision }).strict()
const approvalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED'])
const approvalEntry = z.object({
  id: z.string().length(26), domain: z.literal('acc'), entity: z.literal('opening'), subjectId: z.string().length(26),
  versionNo: z.null(), status: approvalStatus, revision,
  metadata: z.object({
    submitted: z.object({ actorId: z.string().length(26), occurredAt: z.string().datetime() }).strict(),
    approved: z.object({ actorId: z.string().length(26), occurredAt: z.string().datetime() }).strict().optional(),
    rejected: z.object({ actorId: z.string().length(26), occurredAt: z.string().datetime(), reason: z.string() }).strict().optional(),
  }).strict(),
}).strict()
const openingView = z.object({
  bookId: z.string().length(26), submissionId: z.string().length(26), approval: approvalEntry, payload: opening,
  availableApprovalActions: z.array(z.enum(['reject', 'approve', 'unreject', 'unapprove'])),
}).strict()
const periodView = z.object({ bookId: z.string().length(26), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), locked: z.boolean(), revision }).strict()
const deleted = z.object({ id: z.string().length(26), deleted: z.literal(true) }).strict()
const deletedSubmission = z.object({ submissionId: z.string().length(26), deleted: z.literal(true) }).strict()
const failureEnvelope = z.object({
  code: z.number().int().refine((value) => value !== 0), errorKey: z.string().min(1), message: z.string(),
  data: z.union([z.null(), z.object({ blockers: z.array(z.unknown()) }).strict()]), requestId: z.string(),
}).strict()
function envelope<Data extends z.ZodType>(data: Data) {
  return z.union([
    z.object({ code: z.literal(0), errorKey: z.literal(''), message: z.literal('ok'), data, requestId: z.string() }).strict(),
    failureEnvelope,
  ])
}

function route<const Path extends string, Request extends z.ZodType, Response extends z.ZodType>(path: Path, request: Request, response: Response) {
  return createRoute({ method: 'post', path, request: { body: { content: { 'application/json': { schema: request } } } }, responses: { 200: { description: path, content: { 'application/json': { schema: response } } } } })
}

export const accRouteSet = {
  bookQuery: route('/acc/book/query', bookQuery, envelope(z.object({ items: z.array(bookView), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive() }).strict())), bookGet: route('/acc/book/get', identity, envelope(bookView)),
  bookCreate: route('/acc/book/create', bookCreate, envelope(bookView)), bookSave: route('/acc/book/save', bookSave, envelope(bookView)), bookDelete: route('/acc/book/delete', revisionIdentity, envelope(deleted)),
  subjectQuery: route('/acc/subject/query', subjectQuery, envelope(z.object({ items: z.array(subjectView), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize: z.number().int().positive() }).strict())), subjectGet: route('/acc/subject/get', identity, envelope(subjectView)),
  subjectCreate: route('/acc/subject/create', subject, envelope(subjectView)), subjectSave: route('/acc/subject/save', subjectSave, envelope(subjectView)), subjectDelete: route('/acc/subject/delete', revisionIdentity, envelope(deleted)),
  openingQuery: route('/acc/opening/query', bookIdentity, envelope(openingView)), openingSubmit: route('/acc/opening/submit-new', opening, envelope(openingView)),
  openingApprove: route('/acc/opening/approve', openingReview, envelope(openingView)), openingReject: route('/acc/opening/reject', openingReason, envelope(openingView)), openingUnreject: route('/acc/opening/unreject', openingReview, envelope(openingView)), openingUnapprove: route('/acc/opening/unapprove', openingReason, envelope(openingView)), openingDelete: route('/acc/opening/delete', openingReview, envelope(deletedSubmission)),
  periodQuery: route('/acc/period/query', bookIdentity, envelope(z.array(periodView))), periodLock: route('/acc/period/lock', period, envelope(periodView)), periodUnlock: route('/acc/period/unlock', period, envelope(periodView)),
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
