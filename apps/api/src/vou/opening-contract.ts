import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'
import { auxCurrentDataSchemas } from '../app/aux-contract.ts'
import type { TargetRouteEnvironment } from '../app/contract.ts'
const bookIdentity = z.object({ bookId: z.string().length(26) }).strict()
const revision = z.string().regex(/^[1-9]\d*$/)
const money = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/)
const nonNegativeMoney = money
const optionalId = z.string().length(26).optional()
const versionedCounterpartyReference = z
  .object({
    entity: z.enum(['customer', 'supplier', 'other-unit', 'sales-partner']),
    objectId: z.string().length(26),
    customerId: z.string().length(26).optional(),
    approvalEntryId: z.string().length(26),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
  })
  .strict()
const auxPeopleCounterpartyReference = z
  .object({
    entity: z.enum(['employee', 'operating-entity']),
    objectId: z.string().length(26),
    // The submit handler derives these fields. They are present in persisted views.
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200).optional(),
    snapshot: z
      .union([
        auxCurrentDataSchemas['employee'],
        auxCurrentDataSchemas['operating-entity'],
      ])
      .optional(),
  })
  .strict()
const historicalAuxPeopleCounterpartyReference = z
  .object({
    entity: z.enum(['employee', 'operating-entity']),
    objectId: z.string().length(26),
    approvalEntryId: z.string().length(26),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
  })
  .strict()
const archiveReference = z.union([
  versionedCounterpartyReference,
  auxPeopleCounterpartyReference,
  // Existing opening snapshots retain their old approved identity on read.
  historicalAuxPeopleCounterpartyReference,
])
const openingSubmitArchiveReference = z.union([
  versionedCounterpartyReference,
  auxPeopleCounterpartyReference,
])
const openingAsset = z
  .object({
    assetId: optionalId,
    assetNo: z.string().trim().max(64).optional(),
    name: z.string().trim().max(200).optional(),
    categoryId: optionalId,
    departmentId: optionalId,
    usefulLifeMonths: z.number().int().positive().max(1200).optional(),
    residualRate: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
      .optional(),
    acquiredOn: z.string().date().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    originalValue: money,
    accumulatedDepreciation: nonNegativeMoney,
  })
  .strict()
const openingBill = z
  .object({
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
  })
  .strict()
const openingSubmitBill = openingBill
  .extend({
    originatingCounterparty: openingSubmitArchiveReference.optional(),
  })
  .strict()
const openingContainer = z
  .object({
    subunit: z
      .object({
        entity: z.literal('customer-subunit'),
        objectId: z.string().length(26),
        customerId: z.string().length(26),
        approvalEntryId: z.string().length(26),
        code: z.string().min(1).max(64),
        name: z.string().min(1).max(200),
      })
      .strict(),
    containerType: z.enum(['SOLVENT', 'RESIN']),
    quantity: z
      .number()
      .int()
      .refine((value) => value !== 0),
  })
  .strict()
const opening = z
  .object({
    bookId: z.string().length(26),
    submissionId: z.string().length(26),
    idempotencyKey: z.string().min(1).max(128),
    lines: z.array(
      z
        .object({
          subjectId: z.string().length(26),
          currency: z.string().regex(/^[A-Z]{3}$/),
          direction: z.enum(['DEBIT', 'CREDIT']),
          amount: money,
          dimensions: z.record(z.string(), z.string().length(26)),
          quantity: z
            .string()
            .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/)
            .optional(),
        })
        .strict(),
    ),
    assets: z.array(openingAsset),
    bills: z.array(openingBill),
    containers: z.array(openingContainer),
  })
  .strict()
const openingSubmit = opening
  .extend({ bills: z.array(openingSubmitBill) })
  .strict()
const openingReview = z
  .object({
    bookId: z.string().length(26),
    submissionId: z.string().length(26),
    expectedRevision: z.string().regex(/^[1-9]\d*$/),
  })
  .strict()
const openingReason = openingReview
  .extend({ reason: z.string().trim().min(1).max(1000) })
  .strict()
const approvalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED'])
const approvalEntry = z
  .object({
    id: z.string().length(26),
    domain: z.literal('vou'),
    entity: z.literal('opening'),
    subjectId: z.string().length(26),
    versionNo: z.null(),
    status: approvalStatus,
    revision,
    metadata: z
      .object({
        submitted: z
          .object({
            actorId: z.string().length(26),
            occurredAt: z.string().datetime(),
          })
          .strict(),
        approved: z
          .object({
            actorId: z.string().length(26),
            occurredAt: z.string().datetime(),
          })
          .strict()
          .optional(),
        rejected: z
          .object({
            actorId: z.string().length(26),
            occurredAt: z.string().datetime(),
            reason: z.string(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict()
const openingView = z
  .object({
    bookId: z.string().length(26),
    documentId: z.string().length(26),
    documentNo: z.string().min(1),
    entity: z.literal('opening'),
    revision,
    status: approvalStatus,
    submittedBy: z.string(),
    submittedAt: z.string().datetime(),
    approvedBy: z.string().nullable(),
    approvedAt: z.string().datetime().nullable(),
    rejectedBy: z.string().nullable(),
    rejectedAt: z.string().datetime().nullable(),
    rejectionReason: z.string().nullable(),
    bookName: z.string(),
    businessDate: z.string().date(),
    submissionId: z.string().length(26),
    approval: approvalEntry,
    payload: opening,
    availableApprovalActions: z.array(
      z.enum(['reject', 'approve', 'unreject', 'unapprove']),
    ),
  })
  .strict()
const deletedSubmission = z
  .object({ submissionId: z.string().length(26), deleted: z.literal(true) })
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

const openingQuery = z
  .object({
    page: z.number().int().positive(),
    pageSize: z.literal(20),
    documentNo: z.string().trim().max(200).optional(),
    bookId: z.string().length(26).optional(),
    dateFrom: z.string().date().optional(),
    dateTo: z.string().date().optional(),
    status: approvalStatus.optional(),
  })
  .strict()
  .refine(
    (input) =>
      !input.dateFrom || !input.dateTo || input.dateFrom <= input.dateTo,
  )
const openingSummary = z
  .object({
    vouType: z.literal('opening'),
    documentId: z.string().length(26),
    documentNo: z.string().min(1),
    handlerName: z.null(),
    revision,
    status: approvalStatus,
    businessDate: z.string().date(),
    submittedDate: z.string().date(),
    bookName: z.string(),
    counterpartyName: z.null(),
    amount: z.null(),
    currency: z.string(),
  })
  .strict()
const audit = z
  .object({
    id: z.string(),
    submissionId: z.string(),
    action: z.string(),
    fromStatus: z.string().nullable(),
    toStatus: z.string().nullable(),
    fromRevision: z.string().nullable(),
    toRevision: z.string().nullable(),
    actorId: z.string(),
    reason: z.string().nullable(),
    requestId: z.string(),
    occurredAt: z.string().datetime(),
  })
  .strict()
export const openingRouteSet = {
  openingAudit: route(
    '/vou/opening/audit-history',
    bookIdentity,
    envelope(z.array(audit)),
  ),
  openingGet: route('/vou/opening/get', bookIdentity, envelope(openingView)),
  openingQuery: route(
    '/vou/opening/query',
    openingQuery,
    envelope(
      z
        .object({
          items: z.array(openingSummary),
          total: z.number().int().nonnegative(),
          page: z.number().int().positive(),
          pageSize: z.literal(20),
        })
        .strict(),
    ),
  ),
  openingSubmit: route(
    '/vou/opening/submit-new',
    openingSubmit,
    envelope(openingView),
  ),
  openingApprove: route(
    '/vou/opening/approve',
    openingReview,
    envelope(openingView),
  ),
  openingReject: route(
    '/vou/opening/reject',
    openingReason,
    envelope(openingView),
  ),
  openingUnreject: route(
    '/vou/opening/unreject',
    openingReview,
    envelope(openingView),
  ),
  openingUnapprove: route(
    '/vou/opening/unapprove',
    openingReason,
    envelope(openingView),
  ),
  openingDelete: route(
    '/vou/opening/delete',
    openingReview,
    envelope(deletedSubmission),
  ),
} as const
export const openingRouteMetadata = Object.values(openingRouteSet).map(
  (item) => ({
    method: item.method,
    path: item.path,
    permission: item.path,
    title: item.path,
  }),
)
export type OpeningRouteAction = keyof typeof openingRouteSet
export type OpeningRouteHandler = (
  action: OpeningRouteAction,
  context: any,
) => Promise<Response>
export function registerOpeningRoutes<
  AppSchema extends Schema,
  BasePath extends string,
>(
  app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>,
  handler: OpeningRouteHandler,
) {
  const ah = app.openapi(
    openingRouteSet.openingAudit,
    (c) => handler('openingAudit', c) as never,
  )
  const og = ah.openapi(
    openingRouteSet.openingGet,
    (c) => handler('openingGet', c) as never,
  )
  const oq = og.openapi(
    openingRouteSet.openingQuery,
    (c) => handler('openingQuery', c) as never,
  )
  const os = oq.openapi(
    openingRouteSet.openingSubmit,
    (c) => handler('openingSubmit', c) as never,
  )
  const oa = os.openapi(
    openingRouteSet.openingApprove,
    (c) => handler('openingApprove', c) as never,
  )
  const or = oa.openapi(
    openingRouteSet.openingReject,
    (c) => handler('openingReject', c) as never,
  )
  const our = or.openapi(
    openingRouteSet.openingUnreject,
    (c) => handler('openingUnreject', c) as never,
  )
  const oua = our.openapi(
    openingRouteSet.openingUnapprove,
    (c) => handler('openingUnapprove', c) as never,
  )
  const od = oua.openapi(
    openingRouteSet.openingDelete,
    (c) => handler('openingDelete', c) as never,
  )
  return od
}
