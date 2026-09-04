import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'
import { vouEntities, userCreatableVouEntities } from '@zerp/model'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const entityParameter = z.object({ entity: z.enum(vouEntities) })
const identity = z.object({ documentId: z.string().length(26) }).strict()
const payload = z.object({
  businessDate: z.string().date(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/),
  lines: z.array(z.unknown()),
  attachments: z.array(z.object({
    id: z.string().length(26), fileName: z.string().min(1).max(255),
    contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    sizeBytes: z.number().int().positive().max(10_485_760),
    sha256: z.string().regex(/^[0-9a-f]{64}$/), stagingId: z.string().length(26),
  }).strict()),
  parentEntity: z.enum(vouEntities).optional(),
  parentDocumentId: z.string().length(26).optional(),
}).catchall(z.unknown())
const submit = z.object({
  documentId: z.string().length(26), submissionId: z.string().length(26),
  idempotencyKey: z.string().min(1).max(128), expectedRevision: z.string().regex(/^[1-9]\d*$/).nullable(), payload,
}).strict()
const review = z.object({
  documentId: z.string().length(26), submissionId: z.string().length(26),
  expectedRevision: z.string().regex(/^[1-9]\d*$/),
}).strict()
const reviewReason = review.extend({ reason: z.string().trim().min(1).max(1000) }).strict()
const stage = z.object({
  stagingId: z.string().length(26), fileId: z.string().length(26),
  fileName: z.string().min(1).max(255), mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
  size: z.number().int().positive().max(10_485_760), digest: z.string().regex(/^[0-9a-f]{64}$/),
  contentBase64: z.string().min(1),
}).strict()
const envelope = z.object({
  code: z.number().int(), errorKey: z.string(), message: z.string(),
  data: z.unknown().nullable(), requestId: z.string(),
})

function route(action: string, request: z.ZodType) {
  return createRoute({
    method: 'post', path: `/vou/{entity}/${action}`,
    request: { params: entityParameter, body: { content: { 'application/json': { schema: request } } } },
    responses: { 200: { description: `VOU ${action}`, content: { 'application/json': { schema: envelope } } } },
  })
}

export const vouRouteSet = {
  query: route('query', z.object({ page: z.literal(1).default(1), pageSize: z.literal(20).default(20) }).strict()),
  get: route('get', identity),
  'audit-history': route('audit-history', identity),
  'submit-new': route('submit-new', submit),
  'submit-change': route('submit-change', submit),
  approve: route('approve', review), reject: route('reject', reviewReason),
  unreject: route('unreject', review), unapprove: route('unapprove', reviewReason),
  delete: route('delete', review), 'attachment-stage': route('attachment-stage', stage),
  'attachment-cleanup': route('attachment-cleanup', z.object({}).strict()),
} as const

export const vouRouteMetadata = Object.keys(vouRouteSet).map((action) => ({
  method: 'post', path: `/vou/{entity}/${action}`,
  title: `VOU ${action}`,
}))

const publicActions = ['query', 'get', 'audit-history', 'approve', 'reject', 'unreject', 'unapprove', 'delete', 'attachment-stage'] as const
export const vouCapabilityPermissionMetadata = [
  ...vouEntities.flatMap((entity) => publicActions.map((action) => ({ permission: `/vou/${entity}/${action}`, title: `${entity} ${action}` }))),
  ...userCreatableVouEntities.flatMap((entity) => ['submit-new', 'submit-change'].map((action) => ({ permission: `/vou/${entity}/${action}`, title: `${entity} ${action}` }))),
]

export type VouRouteAction = keyof typeof vouRouteSet
export type VouRouteHandler = (action: VouRouteAction, context: any) => Promise<Response>

export function registerVouRoutes<
  AppSchema extends Schema,
  BasePath extends string,
>(
  app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>,
  handler: VouRouteHandler,
) {
  const query = app.openapi(vouRouteSet.query, (c) => handler('query', c) as never)
  const get = query.openapi(vouRouteSet.get, (c) => handler('get', c) as never)
  const audit = get.openapi(vouRouteSet['audit-history'], (c) => handler('audit-history', c) as never)
  const submitNew = audit.openapi(vouRouteSet['submit-new'], (c) => handler('submit-new', c) as never)
  const submitChange = submitNew.openapi(vouRouteSet['submit-change'], (c) => handler('submit-change', c) as never)
  const approve = submitChange.openapi(vouRouteSet.approve, (c) => handler('approve', c) as never)
  const reject = approve.openapi(vouRouteSet.reject, (c) => handler('reject', c) as never)
  const unreject = reject.openapi(vouRouteSet.unreject, (c) => handler('unreject', c) as never)
  const unapprove = unreject.openapi(vouRouteSet.unapprove, (c) => handler('unapprove', c) as never)
  const remove = unapprove.openapi(vouRouteSet.delete, (c) => handler('delete', c) as never)
  const staged = remove.openapi(vouRouteSet['attachment-stage'], (c) => handler('attachment-stage', c) as never)
  return staged.openapi(vouRouteSet['attachment-cleanup'], (c) => handler('attachment-cleanup', c) as never)
}
