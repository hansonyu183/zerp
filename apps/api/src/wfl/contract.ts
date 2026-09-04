import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'
import { vouEntities } from '@zerp/model'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const envelope = z.object({ code: z.number().int(), errorKey: z.string(), message: z.string(), data: z.unknown().nullable(), requestId: z.string() })
const trialDocument = z.object({ entity: z.enum(vouEntities), documentId: z.string().length(26) }).strict()
const submit = z.object({
  subjectId: z.string().length(26), submissionId: z.string().length(26), idempotencyKey: z.string().min(1).max(128),
  expectedLatestApprovedSubmissionId: z.string().length(26).nullable(), expectedLatestApprovedRevision: z.string().regex(/^[1-9]\d*$/).nullable(),
  script: z.string().min(1).max(65_536), trialDocument,
}).strict()
const review = z.object({ subjectId: z.string().length(26), submissionId: z.string().length(26), expectedRevision: z.string().regex(/^[1-9]\d*$/) }).strict()
const reason = review.extend({ reason: z.string().trim().min(1).max(1000) }).strict()
const enable = z.object({ subjectId: z.string().length(26), approvalEntryId: z.string().length(26), expectedApprovalRevision: z.string().regex(/^[1-9]\d*$/), expectedRuntimeRevision: z.string().regex(/^[1-9]\d*$/).nullable() }).strict()
function route<const Path extends string>(path: Path, request: z.ZodType) {
  return createRoute({ method: 'post', path, request: { body: { content: { 'application/json': { schema: request } } } }, responses: { 200: { description: path, content: { 'application/json': { schema: envelope } } } } })
}
export const wflRouteSet = {
  submitNew: route('/dcl/wfl-process-definition/submit-new', submit), submitChange: route('/dcl/wfl-process-definition/submit-change', submit),
  approve: route('/dcl/wfl-process-definition/approve', review), reject: route('/dcl/wfl-process-definition/reject', reason),
  unreject: route('/dcl/wfl-process-definition/unreject', review), unapprove: route('/dcl/wfl-process-definition/unapprove', reason),
  enable: route('/dcl/wfl-process-definition/enable', enable), disable: route('/dcl/wfl-process-definition/disable', enable),
  current: route('/wfl/process-definition/get', z.object({ code: z.string().min(1).max(64) }).strict()),
  trial: route('/wfl/process-definition/trial', z.object({ approvalEntryId: z.string().length(26), document: trialDocument }).strict()),
} as const
export const wflRouteMetadata = Object.values(wflRouteSet).map((item) => ({ method: item.method, path: item.path, permission: item.path, title: item.path }))
export type WflRouteAction = keyof typeof wflRouteSet
export type WflRouteHandler = (action: WflRouteAction, context: any) => Promise<Response>
export function registerWflRoutes<AppSchema extends Schema, BasePath extends string>(app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>, handler: WflRouteHandler) {
  const sn = app.openapi(wflRouteSet.submitNew, (c) => handler('submitNew', c) as never)
  const sc = sn.openapi(wflRouteSet.submitChange, (c) => handler('submitChange', c) as never)
  const a = sc.openapi(wflRouteSet.approve, (c) => handler('approve', c) as never)
  const r = a.openapi(wflRouteSet.reject, (c) => handler('reject', c) as never)
  const ur = r.openapi(wflRouteSet.unreject, (c) => handler('unreject', c) as never)
  const ua = ur.openapi(wflRouteSet.unapprove, (c) => handler('unapprove', c) as never)
  const e = ua.openapi(wflRouteSet.enable, (c) => handler('enable', c) as never)
  const d = e.openapi(wflRouteSet.disable, (c) => handler('disable', c) as never)
  const current = d.openapi(wflRouteSet.current, (c) => handler('current', c) as never)
  return current.openapi(wflRouteSet.trial, (c) => handler('trial', c) as never)
}
