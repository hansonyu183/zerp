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
const definitionIdentity = z.object({ subjectId: z.string().length(26), approvalEntryId: z.string().length(26).optional() }).strict()
const definitionDelete = z.object({ subjectId: z.string().length(26), submissionId: z.string().length(26), expectedRevision: z.string().regex(/^[1-9]\d*$/) }).strict()
const instanceQuery = z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(200).default(20), code: z.string().min(1).max(64).optional(), keyword: z.string().trim().max(200).optional() }).strict()
const instanceIdentity = z.object({ processId: z.string().length(26) }).strict()
const nodeAction = z.object({
  processId: z.string().length(26), nodeId: z.string().length(26),
  action: z.enum(['OPEN_DOCUMENT', 'CREATE_CHILD', 'APPROVE_CHILD', 'REJECT_CHILD', 'RETRY_CHILD', 'CANCEL_CHILD']),
  targetNodeKey: z.string().min(1).max(64).optional(), requestKey: z.string().min(16).max(64).optional(),
  expectedRevision: z.string().regex(/^[1-9]\d*$/).optional(), reason: z.string().trim().min(1).max(1000).optional(),
}).strict()
function route<const Path extends string>(path: Path, request: z.ZodType) {
  return createRoute({ method: 'post', path, request: { body: { content: { 'application/json': { schema: request } } } }, responses: { 200: { description: path, content: { 'application/json': { schema: envelope } } } } })
}
export const wflRouteSet = {
  submitNew: route('/dcl/wfl-process-definition/submit-new', submit), submitChange: route('/dcl/wfl-process-definition/submit-change', submit),
  approve: route('/dcl/wfl-process-definition/approve', review), reject: route('/dcl/wfl-process-definition/reject', reason),
  unreject: route('/dcl/wfl-process-definition/unreject', review), unapprove: route('/dcl/wfl-process-definition/unapprove', reason),
  query: route('/dcl/wfl-process-definition/query', z.object({}).strict()), get: route('/dcl/wfl-process-definition/get', definitionIdentity),
  versions: route('/dcl/wfl-process-definition/versions', definitionIdentity.pick({ subjectId: true })),
  auditHistory: route('/dcl/wfl-process-definition/audit-history', definitionIdentity.pick({ subjectId: true })),
  delete: route('/dcl/wfl-process-definition/delete', definitionDelete),
  enable: route('/dcl/wfl-process-definition/enable', enable), disable: route('/dcl/wfl-process-definition/disable', enable),
  currentQuery: route('/wfl/process-definition/query', instanceQuery),
  current: route('/wfl/process-definition/get', z.object({ code: z.string().min(1).max(64) }).strict()),
  trial: route('/wfl/process-definition/trial', z.union([
    z.object({ script: z.string().min(1).max(65_536), document: trialDocument }).strict(),
    z.object({ approvalEntryId: z.string().length(26), document: trialDocument }).strict(),
  ])),
  instanceQuery: route('/wfl/process-instance/query', instanceQuery),
  instanceGet: route('/wfl/process-instance/get', instanceIdentity),
  instanceAuditHistory: route('/wfl/process-instance/audit-history', instanceIdentity),
  instanceAction: route('/wfl/process-instance/action', nodeAction),
} as const
export const wflRouteMetadata = [
  ...Object.entries(wflRouteSet).map(([action, item]) => action === 'instanceAction'
    ? { method: item.method, path: item.path, title: item.path }
    : { method: item.method, path: item.path, permission: item.path, title: item.path }),
]
export const wflCapabilityPermissionMetadata = [
  'open-document', 'create-child', 'approve-child', 'reject-child', 'retry-child', 'cancel-child',
].map((action) => ({ permission: `/wfl/process-instance/${action}`, title: `WFL ${action}` }))
export type WflRouteAction = keyof typeof wflRouteSet
export type WflRouteHandler = (action: WflRouteAction, context: any) => Promise<Response>
export function registerWflRoutes<AppSchema extends Schema, BasePath extends string>(app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>, handler: WflRouteHandler) {
  const sn = app.openapi(wflRouteSet.submitNew, (c) => handler('submitNew', c) as never)
  const sc = sn.openapi(wflRouteSet.submitChange, (c) => handler('submitChange', c) as never)
  const a = sc.openapi(wflRouteSet.approve, (c) => handler('approve', c) as never)
  const r = a.openapi(wflRouteSet.reject, (c) => handler('reject', c) as never)
  const ur = r.openapi(wflRouteSet.unreject, (c) => handler('unreject', c) as never)
  const ua = ur.openapi(wflRouteSet.unapprove, (c) => handler('unapprove', c) as never)
  const q = ua.openapi(wflRouteSet.query, (c) => handler('query', c) as never)
  const g = q.openapi(wflRouteSet.get, (c) => handler('get', c) as never)
  const v = g.openapi(wflRouteSet.versions, (c) => handler('versions', c) as never)
  const h = v.openapi(wflRouteSet.auditHistory, (c) => handler('auditHistory', c) as never)
  const remove = h.openapi(wflRouteSet.delete, (c) => handler('delete', c) as never)
  const e = remove.openapi(wflRouteSet.enable, (c) => handler('enable', c) as never)
  const d = e.openapi(wflRouteSet.disable, (c) => handler('disable', c) as never)
  const currentQuery = d.openapi(wflRouteSet.currentQuery, (c) => handler('currentQuery', c) as never)
  const current = currentQuery.openapi(wflRouteSet.current, (c) => handler('current', c) as never)
  const trial = current.openapi(wflRouteSet.trial, (c) => handler('trial', c) as never)
  const instanceQueryRoute = trial.openapi(wflRouteSet.instanceQuery, (c) => handler('instanceQuery', c) as never)
  const instanceGet = instanceQueryRoute.openapi(wflRouteSet.instanceGet, (c) => handler('instanceGet', c) as never)
  const instanceAudit = instanceGet.openapi(wflRouteSet.instanceAuditHistory, (c) => handler('instanceAuditHistory', c) as never)
  return instanceAudit.openapi(wflRouteSet.instanceAction, (c) => handler('instanceAction', c) as never)
}
