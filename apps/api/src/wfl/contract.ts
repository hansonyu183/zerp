import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'
import { vouEntities } from '@zerp/model'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const trialDocument = z
  .object({ entity: z.enum(vouEntities), documentId: z.string().length(26) })
  .strict()
const submit = z
  .object({
    subjectId: z.string().length(26),
    submissionId: z.string().length(26),
    idempotencyKey: z.string().min(1).max(128),
    expectedLatestApprovedSubmissionId: z.string().length(26).nullable(),
    expectedLatestApprovedRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .nullable(),
    script: z.string().min(1).max(65_536),
    trialDocument,
  })
  .strict()
const review = z
  .object({
    subjectId: z.string().length(26),
    submissionId: z.string().length(26),
    expectedRevision: z.string().regex(/^[1-9]\d*$/),
  })
  .strict()
const reason = review
  .extend({ reason: z.string().trim().min(1).max(1000) })
  .strict()
const enable = z
  .object({
    subjectId: z.string().length(26),
    approvalEntryId: z.string().length(26),
    expectedApprovalRevision: z.string().regex(/^[1-9]\d*$/),
    expectedRuntimeRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .nullable(),
  })
  .strict()
const definitionIdentity = z
  .object({
    subjectId: z.string().length(26),
    approvalEntryId: z.string().length(26).optional(),
  })
  .strict()
const definitionDelete = z
  .object({
    subjectId: z.string().length(26),
    submissionId: z.string().length(26),
    expectedRevision: z.string().regex(/^[1-9]\d*$/),
  })
  .strict()
const instanceQuery = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(20),
    code: z.string().min(1).max(64).optional(),
    keyword: z.string().trim().max(200).optional(),
  })
  .strict()
const instanceIdentity = z.object({ processId: z.string().length(26) }).strict()
const nodeAction = z
  .object({
    processId: z.string().length(26),
    nodeId: z.string().length(26),
    action: z.enum([
      'OPEN_DOCUMENT',
      'CREATE_CHILD',
      'APPROVE_CHILD',
      'REJECT_CHILD',
      'RETRY_CHILD',
      'CANCEL_CHILD',
    ]),
    targetNodeKey: z.string().min(1).max(64).optional(),
    requestKey: z.string().min(16).max(64).optional(),
    expectedRevision: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()

const revision = z.string().regex(/^[1-9]\d*$/)
const approvalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED'])
const approvalAction = z.enum(['reject', 'approve', 'unreject', 'unapprove'])
const runtimeAction = z.enum(['enable', 'disable'])
const graph = z
  .object({
    code: z.string(),
    name: z.string(),
    rootKey: z.string(),
    nodes: z.array(
      z
        .object({ key: z.string(), name: z.string(), entity: z.string() })
        .strict(),
    ),
    edges: z.array(
      z
        .object({
          sourceKey: z.string(),
          targetKey: z.string(),
          actionName: z.string(),
          relation: z.string(),
        })
        .strict(),
    ),
  })
  .strict()
const definitionView = z
  .object({
    subjectId: z.string().length(26),
    code: z.string(),
    submissionId: z.string().length(26),
    versionNo: z.number().int().positive().nullable(),
    status: approvalStatus,
    revision,
    script: z.string(),
    compiledGraph: graph,
    enabled: z.boolean(),
    runtimeRevision: revision.nullable(),
    availableApprovalActions: z.array(approvalAction),
    availableRuntimeActions: z.array(runtimeAction),
    canDelete: z.boolean(),
  })
  .strict()
const definitionQueryItem = z
  .object({
    subjectId: z.string().length(26),
    code: z.string(),
    latestApproved: definitionView.nullable(),
    openCandidate: definitionView.nullable(),
  })
  .strict()
const definitionAudit = z
  .object({
    id: z.string().length(26),
    submissionId: z.string().length(26),
    versionNo: z.number().int().positive(),
    action: z.enum([
      'SUBMITTED',
      'APPROVED',
      'REJECTED',
      'UNREJECTED',
      'UNAPPROVED',
      'DELETED',
    ]),
    fromStatus: approvalStatus.nullable(),
    toStatus: approvalStatus.nullable(),
    fromRevision: revision.nullable(),
    toRevision: revision.nullable(),
    actorId: z.string().length(26),
    reason: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()
const currentDefinition = z
  .object({
    subjectId: z.string().length(26),
    approvalEntryId: z.string().length(26),
    code: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    compiledGraph: graph,
  })
  .strict()
const starlarkResult = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
    graph: graph.optional(),
    evaluation: z
      .object({
        rootMatched: z.boolean(),
        branches: z.array(
          z
            .object({
              targetKey: z.string(),
              matched: z.boolean(),
              initial: z.unknown().optional(),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict()
const trialResult = z
  .object({
    graph,
    result: starlarkResult,
    payloadDigest: z.string().regex(/^[0-9a-f]{64}$/),
    actorId: z.string().length(26),
  })
  .strict()
const nodeActionValue = z.enum([
  'OPEN_DOCUMENT',
  'CREATE_CHILD',
  'APPROVE_CHILD',
  'REJECT_CHILD',
  'RETRY_CHILD',
  'CANCEL_CHILD',
])
const instanceNode = z
  .object({
    nodeId: z.string().length(26),
    nodeKey: z.string(),
    nodeName: z.string(),
    documentId: z.string().length(26).nullable(),
    documentNo: z.string().nullable(),
    entity: z.enum(vouEntities).nullable(),
    submissionId: z.string().length(26).nullable(),
    status: approvalStatus.nullable(),
    revision: revision.nullable(),
    parentNodeId: z.string().length(26).nullable(),
    relation: z.string().nullable(),
    createdAt: z.string().datetime(),
    availableActions: z.array(nodeActionValue),
  })
  .strict()
const availableTarget = z
  .object({
    parentNodeId: z.string().length(26),
    targetNodeKey: z.string(),
    targetNodeName: z.string(),
    targetEntity: z.enum(vouEntities),
    relation: z.string(),
    actionName: z.string(),
    initial: z.unknown(),
  })
  .strict()
const instanceView = z
  .object({
    processId: z.string().length(26),
    definitionSubjectId: z.string().length(26),
    approvalEntryId: z.string().length(26),
    definitionCode: z.string(),
    definitionName: z.string(),
    rootDocumentId: z.string().length(26),
    rootDocumentNo: z.string(),
    rootEntity: z.enum(vouEntities),
    createdAt: z.string().datetime(),
    nodes: z.array(instanceNode),
    availableTargets: z.array(availableTarget),
  })
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
const page = <Item extends z.ZodType>(item: Item) =>
  z
    .object({
      items: z.array(item),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.number().int().positive(),
    })
    .strict()
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
export const wflRouteSet = {
  submitNew: route(
    '/dcl/wfl-process-definition/submit-new',
    submit,
    envelope(definitionView),
  ),
  submitChange: route(
    '/dcl/wfl-process-definition/submit-change',
    submit,
    envelope(definitionView),
  ),
  approve: route(
    '/dcl/wfl-process-definition/approve',
    review,
    envelope(definitionView),
  ),
  reject: route(
    '/dcl/wfl-process-definition/reject',
    reason,
    envelope(definitionView),
  ),
  unreject: route(
    '/dcl/wfl-process-definition/unreject',
    review,
    envelope(definitionView),
  ),
  unapprove: route(
    '/dcl/wfl-process-definition/unapprove',
    reason,
    envelope(definitionView),
  ),
  query: route(
    '/dcl/wfl-process-definition/query',
    instanceQuery,
    envelope(page(definitionQueryItem)),
  ),
  get: route(
    '/dcl/wfl-process-definition/get',
    definitionIdentity,
    envelope(definitionView),
  ),
  versions: route(
    '/dcl/wfl-process-definition/versions',
    definitionIdentity.pick({ subjectId: true }),
    envelope(z.array(definitionView)),
  ),
  auditHistory: route(
    '/dcl/wfl-process-definition/audit-history',
    definitionIdentity.pick({ subjectId: true }),
    envelope(z.array(definitionAudit)),
  ),
  delete: route(
    '/dcl/wfl-process-definition/delete',
    definitionDelete,
    envelope(
      z
        .object({
          submissionId: z.string().length(26),
          deleted: z.literal(true),
        })
        .strict(),
    ),
  ),
  enable: route(
    '/dcl/wfl-process-definition/enable',
    enable,
    envelope(
      z
        .object({
          subjectId: z.string().length(26),
          approvalEntryId: z.string().length(26),
          enabled: z.boolean(),
          revision,
        })
        .strict(),
    ),
  ),
  disable: route(
    '/dcl/wfl-process-definition/disable',
    enable,
    envelope(
      z
        .object({
          subjectId: z.string().length(26),
          approvalEntryId: z.string().length(26),
          enabled: z.boolean(),
          revision,
        })
        .strict(),
    ),
  ),
  currentQuery: route(
    '/wfl/process-definition/query',
    instanceQuery,
    envelope(page(currentDefinition)),
  ),
  current: route(
    '/wfl/process-definition/get',
    z.object({ code: z.string().min(1).max(64) }).strict(),
    envelope(currentDefinition),
  ),
  trial: route(
    '/wfl/process-definition/trial',
    z.union([
      z
        .object({
          script: z.string().min(1).max(65_536),
          document: trialDocument,
        })
        .strict(),
      z
        .object({
          approvalEntryId: z.string().length(26),
          document: trialDocument,
        })
        .strict(),
    ]),
    envelope(trialResult),
  ),
  instanceQuery: route(
    '/wfl/process-instance/query',
    instanceQuery,
    envelope(page(instanceView)),
  ),
  instanceGet: route(
    '/wfl/process-instance/get',
    instanceIdentity,
    envelope(instanceView),
  ),
  instanceAuditHistory: route(
    '/wfl/process-instance/audit-history',
    instanceIdentity,
    envelope(
      z.array(
        z
          .object({
            id: z.string().length(26),
            action: z.string(),
            actorId: z.string().length(26),
            details: z.unknown(),
            createdAt: z.string().datetime(),
          })
          .strict(),
      ),
    ),
  ),
  instanceAction: route(
    '/wfl/process-instance/action',
    nodeAction,
    envelope(instanceView),
  ),
} as const
export const wflRouteMetadata = [
  ...Object.entries(wflRouteSet).map(([action, item]) =>
    action === 'instanceAction'
      ? { method: item.method, path: item.path, title: item.path }
      : {
          method: item.method,
          path: item.path,
          permission: item.path,
          title: item.path,
        },
  ),
]
export const wflCapabilityPermissionMetadata = [
  'open-document',
  'create-child',
  'approve-child',
  'reject-child',
  'retry-child',
  'cancel-child',
].map((action) => ({
  permission: `/wfl/process-instance/${action}`,
  title: `WFL ${action}`,
}))
export type WflRouteAction = keyof typeof wflRouteSet
export type WflRouteHandler = (
  action: WflRouteAction,
  context: any,
) => Promise<Response>
export function registerWflRoutes<
  AppSchema extends Schema,
  BasePath extends string,
>(
  app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>,
  handler: WflRouteHandler,
) {
  const sn = app.openapi(
    wflRouteSet.submitNew,
    (c) => handler('submitNew', c) as never,
  )
  const sc = sn.openapi(
    wflRouteSet.submitChange,
    (c) => handler('submitChange', c) as never,
  )
  const a = sc.openapi(
    wflRouteSet.approve,
    (c) => handler('approve', c) as never,
  )
  const r = a.openapi(wflRouteSet.reject, (c) => handler('reject', c) as never)
  const ur = r.openapi(
    wflRouteSet.unreject,
    (c) => handler('unreject', c) as never,
  )
  const ua = ur.openapi(
    wflRouteSet.unapprove,
    (c) => handler('unapprove', c) as never,
  )
  const q = ua.openapi(wflRouteSet.query, (c) => handler('query', c) as never)
  const g = q.openapi(wflRouteSet.get, (c) => handler('get', c) as never)
  const v = g.openapi(
    wflRouteSet.versions,
    (c) => handler('versions', c) as never,
  )
  const h = v.openapi(
    wflRouteSet.auditHistory,
    (c) => handler('auditHistory', c) as never,
  )
  const remove = h.openapi(
    wflRouteSet.delete,
    (c) => handler('delete', c) as never,
  )
  const e = remove.openapi(
    wflRouteSet.enable,
    (c) => handler('enable', c) as never,
  )
  const d = e.openapi(
    wflRouteSet.disable,
    (c) => handler('disable', c) as never,
  )
  const currentQuery = d.openapi(
    wflRouteSet.currentQuery,
    (c) => handler('currentQuery', c) as never,
  )
  const current = currentQuery.openapi(
    wflRouteSet.current,
    (c) => handler('current', c) as never,
  )
  const trial = current.openapi(
    wflRouteSet.trial,
    (c) => handler('trial', c) as never,
  )
  const instanceQueryRoute = trial.openapi(
    wflRouteSet.instanceQuery,
    (c) => handler('instanceQuery', c) as never,
  )
  const instanceGet = instanceQueryRoute.openapi(
    wflRouteSet.instanceGet,
    (c) => handler('instanceGet', c) as never,
  )
  const instanceAudit = instanceGet.openapi(
    wflRouteSet.instanceAuditHistory,
    (c) => handler('instanceAuditHistory', c) as never,
  )
  return instanceAudit.openapi(
    wflRouteSet.instanceAction,
    (c) => handler('instanceAction', c) as never,
  )
}
