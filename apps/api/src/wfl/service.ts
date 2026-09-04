import { createHash } from 'node:crypto'

import {
  availableApprovalActions,
  decideApproval,
  type ApprovalAction,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
  type VouEntity,
} from '@zerp/model'
import type { WflStarlark, WflStarlarkGraph, WflStarlarkResult } from '@zerp/wfl-starlark'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { DB, JsonValue } from '../db/generated.ts'
import type { PlanExecutor, WflApplicationPlan } from '../platform/transaction-coordinator.ts'
import { readVouPersistence, VouApplicationError } from '../vou/service.ts'

type Executor = Kysely<DB> | Transaction<DB>

export interface WflSubmitInput {
  subjectId: string
  submissionId: string
  idempotencyKey: string
  expectedLatestApprovedSubmissionId: string | null
  expectedLatestApprovedRevision: string | null
  script: string
  trialDocument: { entity: VouEntity; documentId: string }
}

export interface WflReviewInput {
  subjectId: string
  submissionId: string
  expectedRevision: string
  reason?: string
}

export interface WflEnableInput {
  subjectId: string
  approvalEntryId: string
  expectedApprovalRevision: string
  expectedRuntimeRevision: string | null
}

export interface WflDefinitionView {
  subjectId: string
  code: string
  submissionId: string
  versionNo: number | null
  status: ApprovalStatus
  revision: string
  script: string
  compiledGraph: WflStarlarkGraph
  enabled: boolean
  runtimeRevision: string | null
  availableApprovalActions: ReturnType<typeof availableApprovalActions>
}

export interface WflDefinitionQueryView {
  subjectId: string
  code: string
  latestApproved: WflDefinitionView | null
  openCandidate: WflDefinitionView | null
}

export interface WflDefinitionAuditView {
  id: string
  submissionId: string
  versionNo: number
  action: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'UNREJECTED' | 'UNAPPROVED' | 'DELETED'
  fromStatus: ApprovalStatus | null
  toStatus: ApprovalStatus | null
  fromRevision: string | null
  toRevision: string | null
  actorId: string
  reason: string | null
  createdAt: string
}

export const wflNodeActions = [
  'OPEN_DOCUMENT',
  'CREATE_CHILD',
  'APPROVE_CHILD',
  'REJECT_CHILD',
  'RETRY_CHILD',
  'CANCEL_CHILD',
] as const

export type WflNodeAction = (typeof wflNodeActions)[number]

export interface WflInstanceQueryInput {
  page?: number
  pageSize?: number
  code?: string
  keyword?: string
}

export interface WflAvailableChildTarget {
  parentNodeId: string
  targetNodeKey: string
  targetNodeName: string
  targetEntity: VouEntity
  relation: string
  actionName: string
  initial: unknown
}

export interface WflInstanceNodeView {
  nodeId: string
  nodeKey: string
  nodeName: string
  documentId: string | null
  documentNo: string | null
  entity: VouEntity | null
  submissionId: string | null
  status: ApprovalStatus | null
  revision: string | null
  parentNodeId: string | null
  relation: string | null
  createdAt: string
  availableActions: WflNodeAction[]
}

export interface WflInstanceView {
  processId: string
  definitionSubjectId: string
  approvalEntryId: string
  definitionCode: string
  definitionName: string
  rootDocumentId: string
  rootDocumentNo: string
  rootEntity: VouEntity
  createdAt: string
  nodes: WflInstanceNodeView[]
  availableTargets: WflAvailableChildTarget[]
}

export interface WflNodeActionInput {
  processId: string
  nodeId: string
  action: WflNodeAction
  targetNodeKey?: string
  requestKey?: string
  expectedRevision?: string
  reason?: string
}

export interface WflVouPort {
  createChild(
    transaction: Transaction<DB>,
    input: {
      entity: VouEntity
      parent: { entity: VouEntity; documentId: string; submissionId: string }
      initial: unknown
      requestKey: string
      actor: ApprovalActor
      requestId: string
    },
  ): Promise<{ documentId: string; submissionId: string }>
  approveChild(
    transaction: Transaction<DB>,
    input: { entity: VouEntity; documentId: string; submissionId: string; expectedRevision: string; actor: ApprovalActor; requestId: string },
  ): Promise<void>
  rejectChild(
    transaction: Transaction<DB>,
    input: { entity: VouEntity; documentId: string; submissionId: string; expectedRevision: string; reason: string; actor: ApprovalActor; requestId: string },
  ): Promise<void>
  retryChild(
    transaction: Transaction<DB>,
    input: { entity: VouEntity; documentId: string; submissionId: string; expectedRevision: string; actor: ApprovalActor; requestId: string },
  ): Promise<void>
  cancelChild(
    transaction: Transaction<DB>,
    input: { entity: VouEntity; documentId: string; submissionId: string; expectedRevision: string; actor: ApprovalActor; requestId: string },
  ): Promise<void>
}

export class WflApplicationError extends Error {
  readonly errorKey: string
  readonly data: { blockers: unknown[] } | null

  constructor(errorKey: string, blockers: unknown[] = []) {
    super(errorKey)
    this.name = 'WflApplicationError'
    this.errorKey = errorKey
    this.data = blockers.length === 0 ? null : { blockers }
  }
}

function requirePermission(actor: ApprovalActor, permission: string): void {
  if (actor.trusted !== true && !actor.permissions.includes(permission))
    throw new WflApplicationError('approval_invalid_action')
}

function json(value: unknown): JsonValue {
  return JSON.stringify(value) as unknown as JsonValue
}

function approvalEntry(row: {
  id: string
  subject_id: string
  version_no: number | null
  status: string
  revision: string | number | bigint
  submitted_by: string
  submitted_at: Date
  approved_by: string | null
  approved_at: Date | null
  rejected_by: string | null
  rejected_at: Date | null
  rejection_reason: string | null
}): ApprovalEntry {
  const status = row.status as ApprovalStatus
  return {
    id: row.id, domain: 'dcl', entity: 'wfl-process-definition',
    subjectId: row.subject_id, versionNo: row.version_no,
    status, revision: String(row.revision),
    metadata: {
      submitted: { actorId: row.submitted_by, occurredAt: row.submitted_at.toISOString() },
      ...(status === 'APPROVED' && row.approved_by && row.approved_at
        ? { approved: { actorId: row.approved_by, occurredAt: row.approved_at.toISOString() } }
        : {}),
      ...(status === 'REJECTED' && row.rejected_by && row.rejected_at && row.rejection_reason
        ? { rejected: { actorId: row.rejected_by, occurredAt: row.rejected_at.toISOString(), reason: row.rejection_reason } }
        : {}),
    },
  }
}

export class WflService implements PlanExecutor<WflApplicationPlan> {
  private readonly db: Kysely<DB>
  private readonly runtime: WflStarlark
  private readonly vouPort: WflVouPort

  constructor(db: Kysely<DB>, runtime: WflStarlark, vouPort: WflVouPort) {
    this.db = db
    this.runtime = runtime
    this.vouPort = vouPort
  }

  async query(actor: ApprovalActor): Promise<WflDefinitionQueryView[]> {
    requirePermission(actor, '/dcl/wfl-process-definition/query')
    const rows = await this.db.selectFrom('approval_entries as e')
      .innerJoin('dcl_subjects as s', 's.id', 'e.subject_id')
      .select(['e.id', 'e.subject_id', 'e.status', 'e.version_no', 's.code'])
      .where('e.domain', '=', 'dcl').where('e.entity', '=', 'wfl-process-definition')
      .orderBy('s.code', 'asc').orderBy('e.version_no', 'desc').execute()
    const subjects = new Map<string, { code: string; latestApprovedId: string | null; openCandidateId: string | null }>()
    for (const row of rows) {
      if (!row.code) throw new WflApplicationError('wfl_definition_not_found')
      const subject = subjects.get(row.subject_id) ?? { code: row.code, latestApprovedId: null, openCandidateId: null }
      if (row.status === 'APPROVED' && subject.latestApprovedId === null) subject.latestApprovedId = row.id
      if ((row.status === 'PENDING' || row.status === 'REJECTED') && subject.openCandidateId === null) subject.openCandidateId = row.id
      subjects.set(row.subject_id, subject)
    }
    return Promise.all([...subjects.entries()].map(async ([subjectId, subject]) => ({
      subjectId, code: subject.code,
      latestApproved: subject.latestApprovedId ? await this.readDefinition(this.db, subject.latestApprovedId, actor) : null,
      openCandidate: subject.openCandidateId ? await this.readDefinition(this.db, subject.openCandidateId, actor) : null,
    })))
  }

  async get(subjectId: string, actor: ApprovalActor, approvalEntryId?: string): Promise<WflDefinitionView> {
    requirePermission(actor, '/dcl/wfl-process-definition/get')
    let query = this.db.selectFrom('approval_entries').select('id')
      .where('domain', '=', 'dcl').where('entity', '=', 'wfl-process-definition').where('subject_id', '=', subjectId)
    if (approvalEntryId) query = query.where('id', '=', approvalEntryId)
    else query = query.orderBy(sql`CASE WHEN status IN ('PENDING', 'REJECTED') THEN 0 ELSE 1 END`).orderBy('version_no', 'desc')
    const row = await query.executeTakeFirst()
    if (!row) throw new WflApplicationError('approval_not_found')
    return this.readDefinition(this.db, row.id, actor)
  }

  async versions(subjectId: string, actor: ApprovalActor): Promise<WflDefinitionView[]> {
    requirePermission(actor, '/dcl/wfl-process-definition/versions')
    const rows = await this.db.selectFrom('approval_entries').select('id')
      .where('domain', '=', 'dcl').where('entity', '=', 'wfl-process-definition').where('subject_id', '=', subjectId)
      .orderBy('version_no', 'desc').execute()
    return Promise.all(rows.map((row) => this.readDefinition(this.db, row.id, actor)))
  }

  async auditHistory(subjectId: string, actor: ApprovalActor): Promise<WflDefinitionAuditView[]> {
    requirePermission(actor, '/dcl/wfl-process-definition/audit-history')
    const rows = await this.db.selectFrom('approval_events').selectAll()
      .where('domain', '=', 'dcl').where('entity', '=', 'wfl-process-definition').where('subject_id', '=', subjectId)
      .orderBy('created_at', 'asc').orderBy('id', 'asc').execute()
    return rows.map((row) => ({
      id: row.id, submissionId: row.entry_id, versionNo: row.version_no ?? 1,
      action: row.action as WflDefinitionAuditView['action'], fromStatus: row.from_status as ApprovalStatus | null,
      toStatus: row.to_status as ApprovalStatus | null,
      fromRevision: row.from_revision === null ? null : String(row.from_revision),
      toRevision: row.to_revision === null ? null : String(row.to_revision),
      actorId: row.actor_id, reason: row.reason, createdAt: row.created_at.toISOString(),
    }))
  }

  async delete(
    input: Omit<WflReviewInput, 'reason'>,
    actor: ApprovalActor,
    requestId: string,
  ): Promise<{ submissionId: string; deleted: true }> {
    requirePermission(actor, '/dcl/wfl-process-definition/delete')
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wfl:definition:${input.subjectId}`}, 0))`.execute(tx)
      const entry = await tx.selectFrom('approval_entries').selectAll()
        .where('id', '=', input.submissionId).where('domain', '=', 'dcl').where('entity', '=', 'wfl-process-definition')
        .where('subject_id', '=', input.subjectId).forUpdate().executeTakeFirst()
      if (!entry) throw new WflApplicationError('approval_not_found')
      if (String(entry.revision) !== input.expectedRevision) throw new WflApplicationError('approval_stale_revision')
      if (entry.status !== 'PENDING' && entry.status !== 'REJECTED') throw new WflApplicationError('approval_invalid_transition')
      if (actor.trusted !== true && entry.submitted_by !== actor.id) throw new WflApplicationError('approval_invalid_actor')
      const blocker = await tx.selectFrom('wfl_instances').select('id').where('approval_entry_id', '=', entry.id).executeTakeFirst()
      if (blocker) throw new WflApplicationError('wfl_definition_in_use', [{ kind: 'WFL_INSTANCE', id: blocker.id, approvalEntryId: entry.id }])
      const now = new Date()
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: entry.id, domain: 'dcl', entity: 'wfl-process-definition', subject_id: entry.subject_id,
        version_no: entry.version_no, action: 'DELETED', from_status: entry.status, to_status: null,
        from_revision: entry.revision, to_revision: null, actor_id: actor.id, reason: null, request_id: requestId, created_at: now,
      }).execute()
      const deleted = await tx.deleteFrom('approval_entries').where('id', '=', entry.id).where('revision', '=', entry.revision).executeTakeFirst()
      if (Number(deleted.numDeletedRows) !== 1) throw new WflApplicationError('approval_stale_revision')
      const remaining = await tx.selectFrom('approval_entries').select('id').where('subject_id', '=', input.subjectId).executeTakeFirst()
      if (!remaining) await tx.deleteFrom('dcl_subjects').where('id', '=', input.subjectId).execute()
      return { submissionId: entry.id, deleted: true as const }
    })
  }

  async queryInstances(input: WflInstanceQueryInput, actor: ApprovalActor): Promise<{ items: WflInstanceView[]; total: number }> {
    requirePermission(actor, '/wfl/process-instance/query')
    const rows = await this.db.selectFrom('wfl_instances as i')
      .select(['i.id', 'i.definition_code', 'i.definition_name', 'i.root_document_id'])
      .orderBy('i.created_at', 'desc').execute()
    const keyword = input.keyword?.trim().toLowerCase()
    const filtered = rows.filter((row) =>
      (!input.code || row.definition_code === input.code) &&
      (!keyword || row.definition_code.toLowerCase().includes(keyword) || row.definition_name.toLowerCase().includes(keyword)),
    )
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const ids = filtered.slice((page - 1) * pageSize, page * pageSize).map((row) => row.id)
    return { items: await Promise.all(ids.map((id) => this.readInstance(this.db, id, actor))), total: filtered.length }
  }

  async queryCurrentDefinitions(input: WflInstanceQueryInput, actor: ApprovalActor) {
    requirePermission(actor, '/wfl/process-definition/query')
    const rows = await sql<{ id: string; code: string; name: string; enabled: boolean }>`
      SELECT DISTINCT ON (s.id) e.id, v.compiled_graph->>'code' AS code,
        v.compiled_graph->>'name' AS name, r.enabled
      FROM dcl_subjects s
      JOIN wfl_definition_runtime_states r ON r.subject_id = s.id
      JOIN approval_entries e ON e.subject_id = s.id AND e.domain = 'dcl'
        AND e.entity = 'wfl-process-definition' AND e.status = 'APPROVED'
      JOIN wfl_definition_versions v ON v.approval_entry_id = e.id
      ORDER BY s.id, e.version_no DESC
    `.execute(this.db)
    const keyword = input.keyword?.trim().toLowerCase()
    const filtered = rows.rows.filter((row) =>
      (!input.code || row.code === input.code) &&
      (!keyword || row.code.toLowerCase().includes(keyword) || row.name.toLowerCase().includes(keyword)),
    )
    const page = input.page ?? 1
    const pageSize = input.pageSize ?? 20
    const selected = filtered.slice((page - 1) * pageSize, page * pageSize)
    return {
      items: await Promise.all(selected.map(async (row) => {
        const view = await this.readDefinition(this.db, row.id, actor)
        return { subjectId: view.subjectId, approvalEntryId: view.submissionId, code: row.code, name: row.name, enabled: row.enabled, compiledGraph: view.compiledGraph }
      })),
      total: filtered.length,
    }
  }

  async getInstance(processId: string, actor: ApprovalActor): Promise<WflInstanceView> {
    requirePermission(actor, '/wfl/process-instance/get')
    return this.readInstance(this.db, processId, actor)
  }

  async instanceAuditHistory(processId: string, actor: ApprovalActor) {
    requirePermission(actor, '/wfl/process-instance/audit-history')
    const rows = await this.db.selectFrom('wfl_runtime_audits').selectAll()
      .where('instance_id', '=', processId).orderBy('created_at', 'asc').orderBy('id', 'asc').execute()
    return rows.map((row) => ({
      id: row.id, action: row.action, actorId: row.actor_id, details: row.details,
      createdAt: row.created_at.toISOString(),
    }))
  }

  async executeNodeAction(input: WflNodeActionInput, actor: ApprovalActor, requestId: string): Promise<WflInstanceView> {
    const permission = `/wfl/process-instance/${input.action.toLowerCase().replaceAll('_', '-')}`
    requirePermission(actor, permission)
    return this.db.transaction().execute(async (tx) => {
      const instance = await tx.selectFrom('wfl_instances').select('id').where('id', '=', input.processId).forUpdate().executeTakeFirst()
      if (!instance) throw new WflApplicationError('wfl_instance_not_found')
      const view = await this.readInstance(tx, input.processId, actor)
      const node = view.nodes.find((item) => item.nodeId === input.nodeId)
      if (!node || !node.documentId || !node.entity || !node.submissionId || !node.status || !node.revision)
        throw new WflApplicationError('wfl_node_not_found')
      if (input.action === 'CREATE_CHILD' && input.targetNodeKey && input.requestKey) {
        const fingerprint = this.actionFingerprint('CREATE_CHILD', node.nodeId, input.targetNodeKey, input.requestKey)
        const prior = await tx.selectFrom('wfl_action_results').select(['fingerprint', 'active'])
          .where('instance_id', '=', input.processId).where('source_node_id', '=', node.nodeId)
          .where('script_position', 'like', `edge:${node.nodeKey}:${input.targetNodeKey}:%`).forUpdate().executeTakeFirst()
        if (prior?.active && prior.fingerprint === fingerprint) return view
        if (prior?.active) throw new WflApplicationError('wfl_action_conflict')
      }
      if (!node.availableActions.includes(input.action)) throw new WflApplicationError('wfl_action_unavailable')
      if (input.action === 'OPEN_DOCUMENT') {
        const position = `node:${node.nodeId}:OPEN_DOCUMENT:${node.submissionId}`
        const fingerprint = this.actionFingerprint('OPEN_DOCUMENT', node.nodeId, node.submissionId)
        const prior = await tx.selectFrom('wfl_action_results').select('fingerprint')
          .where('instance_id', '=', input.processId).where('source_node_id', '=', node.nodeId)
          .where('script_position', '=', position).forUpdate().executeTakeFirst()
        if (!prior) {
          await tx.insertInto('wfl_action_results').values({ id: ulid(), instance_id: input.processId, source_node_id: node.nodeId, script_position: position, fingerprint, target_document_id: null, active: true, created_at: new Date() }).execute()
          await this.audit(tx, input.processId, 'OPEN_DOCUMENT', actor.id, { nodeId: node.nodeId, documentId: node.documentId, requestId }, new Date())
        } else if (prior.fingerprint !== fingerprint) throw new WflApplicationError('wfl_action_conflict')
        return this.readInstance(tx, input.processId, actor)
      }
      if (input.action === 'CREATE_CHILD')
        return this.createChild(tx, view, node, input, actor, requestId, this.vouPort)
      if (!input.expectedRevision) throw new WflApplicationError('approval_stale_revision')
      if (input.expectedRevision !== node.revision) throw new WflApplicationError('approval_stale_revision')
      const fingerprint = this.actionFingerprint(input.action, node.nodeId, node.submissionId, input.expectedRevision)
      const position = `node:${node.nodeId}:${input.action}:${node.submissionId}`
      const prior = await tx.selectFrom('wfl_action_results').select(['fingerprint', 'active'])
        .where('instance_id', '=', input.processId).where('source_node_id', '=', node.nodeId)
        .where('script_position', '=', position).forUpdate().executeTakeFirst()
      if (prior?.active && prior.fingerprint === fingerprint) return this.readInstance(tx, input.processId, actor)
      const portInput = {
        entity: node.entity, documentId: node.documentId, submissionId: node.submissionId,
        expectedRevision: input.expectedRevision, actor, requestId,
      }
      if (input.action === 'APPROVE_CHILD') await this.vouPort.approveChild(tx, portInput)
      else if (input.action === 'REJECT_CHILD') {
        if (!input.reason?.trim()) throw new WflApplicationError('approval_reason_required')
        await this.vouPort.rejectChild(tx, { ...portInput, reason: input.reason.trim() })
      } else if (input.action === 'RETRY_CHILD') await this.vouPort.retryChild(tx, portInput)
      else {
        await tx.updateTable('wfl_action_results').set({ active: false, target_document_id: null })
          .where('target_document_id', '=', node.documentId).execute()
        await tx.updateTable('wfl_instance_nodes').set({ document_id: null })
          .where('id', '=', node.nodeId).execute()
        await this.vouPort.cancelChild(tx, portInput)
      }
      const now = new Date()
      if (prior) await tx.updateTable('wfl_action_results').set({ fingerprint, target_document_id: input.action === 'CANCEL_CHILD' ? null : node.documentId, active: input.action !== 'CANCEL_CHILD', created_at: now })
        .where('instance_id', '=', input.processId).where('source_node_id', '=', node.nodeId).where('script_position', '=', position).execute()
      else await tx.insertInto('wfl_action_results').values({ id: ulid(), instance_id: input.processId, source_node_id: node.nodeId, script_position: position, fingerprint, target_document_id: input.action === 'CANCEL_CHILD' ? null : node.documentId, active: input.action !== 'CANCEL_CHILD', created_at: now }).execute()
      await this.audit(tx, input.processId, input.action, actor.id, { nodeId: node.nodeId, documentId: node.documentId, requestId }, now)
      return this.readInstance(tx, input.processId, actor)
    })
  }

  async apply(tx: Transaction<DB>, plan: WflApplicationPlan): Promise<void> {
    if (plan.action === 'NONE') return
    if (plan.action === 'unapprove') {
      const instance = await tx.selectFrom('wfl_instances').select('id').where('root_document_id', '=', plan.documentId).executeTakeFirst()
      if (!instance) return
      const child = await tx.selectFrom('wfl_instance_nodes').select(['id', 'document_id'])
        .where('instance_id', '=', instance.id).where('parent_node_id', 'is not', null).where('document_id', 'is not', null).executeTakeFirst()
      if (child) throw new WflApplicationError('wfl_downstream_blocker', [{ kind: 'WFL_DOCUMENT', id: child.document_id }])
      await tx.updateTable('wfl_action_results').set({ active: false }).where('instance_id', '=', instance.id).execute()
      await tx.insertInto('wfl_runtime_audits').values({
        id: ulid(), instance_id: instance.id, action: 'ROOT_UNAPPROVED', actor_id: plan.actorId,
        details: json({ documentId: plan.documentId, approvalEntryId: plan.approvalEntryId }), created_at: new Date(plan.occurredAt),
      }).execute()
      return
    }
    const candidates = await sql<{
      subject_id: string; approval_entry_id: string; code: string; script: string; compiled_graph: JsonValue
    }>`
      SELECT s.id AS subject_id, e.id AS approval_entry_id, s.code, v.script, v.compiled_graph
      FROM dcl_subjects s
      JOIN wfl_definition_runtime_states runtime ON runtime.subject_id = s.id AND runtime.enabled
      JOIN LATERAL (
        SELECT * FROM approval_entries candidate WHERE candidate.domain = 'dcl'
          AND candidate.entity = 'wfl-process-definition' AND candidate.subject_id = s.id
          AND candidate.status = 'APPROVED' ORDER BY candidate.version_no DESC LIMIT 1
      ) e ON TRUE
      JOIN wfl_definition_versions v ON v.approval_entry_id = e.id
      WHERE v.compiled_graph->'nodes' @> ${json([{ entity: plan.entity }])}::jsonb
    `.execute(tx)
    const matches: typeof candidates.rows = []
    for (const candidate of candidates.rows) {
      const graph = candidate.compiled_graph as unknown as WflStarlarkGraph
      const root = graph.nodes.find((node) => node.key === graph.rootKey)
      if (root?.entity !== plan.entity) continue
      const result = await this.runtime.run({ source: candidate.script, operation: 'evaluate', sourceNodeKey: graph.rootKey, input: plan.payload })
      if (!result.ok) throw new WflApplicationError('wfl_runtime_failed')
      if (result.evaluation?.rootMatched) matches.push(candidate)
    }
    if (matches.length > 1) throw new WflApplicationError('wfl_multiple_definitions_match')
    const match = matches[0]
    if (!match) return
    const existing = await tx.selectFrom('wfl_instances').select('id')
      .where('definition_subject_id', '=', match.subject_id).where('root_document_id', '=', plan.documentId).executeTakeFirst()
    if (existing) return
    const graph = match.compiled_graph as unknown as WflStarlarkGraph
    const instanceId = ulid(), rootNodeId = ulid()
    await tx.insertInto('wfl_instances').values({
      id: instanceId, definition_subject_id: match.subject_id, approval_entry_id: match.approval_entry_id,
      definition_code: graph.code, definition_name: graph.name, root_document_id: plan.documentId, created_at: new Date(plan.occurredAt),
    }).execute()
    await tx.insertInto('wfl_instance_nodes').values({
      id: rootNodeId, instance_id: instanceId, node_key: graph.rootKey, document_id: plan.documentId,
      parent_node_id: null, relation: null, created_at: new Date(plan.occurredAt),
    }).execute()
    await tx.insertInto('wfl_runtime_audits').values({
      id: ulid(), instance_id: instanceId, action: 'ROOT_APPROVED', actor_id: plan.actorId,
      details: json({ documentId: plan.documentId, approvalEntryId: plan.approvalEntryId }), created_at: new Date(plan.occurredAt),
    }).execute()
  }

  async submit(
    action: 'submit-new' | 'submit-change',
    input: WflSubmitInput,
    actor: ApprovalActor,
    requestId: string,
  ) {
    requirePermission(actor, `/dcl/wfl-process-definition/${action}`)
    const prepared = await this.compileAndTrial(this.db, input.script, input.trialDocument, actor)
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wfl:definition:${input.subjectId}`}, 0))`.execute(tx)
      const subject = await tx.selectFrom('dcl_subjects').selectAll()
        .where('id', '=', input.subjectId).where('entity', '=', 'wfl-process-definition')
        .executeTakeFirst()
      const history = await tx.selectFrom('approval_entries').select(['id', 'version_no', 'status', 'revision'])
        .where('domain', '=', 'dcl').where('entity', '=', 'wfl-process-definition')
        .where('subject_id', '=', input.subjectId).orderBy('version_no', 'asc').forUpdate().execute()
      const latestApproved = history.filter((row) => row.status === 'APPROVED').at(-1)
      if (action === 'submit-new' && subject) throw new WflApplicationError('vou_submit_mode_mismatch')
      if (action === 'submit-change' && !subject) throw new WflApplicationError('vou_submit_mode_mismatch')
      if (history.some((row) => row.status !== 'APPROVED'))
        throw new WflApplicationError('approval_open_version_exists')
      if (
        (latestApproved?.id ?? null) !== input.expectedLatestApprovedSubmissionId ||
        (latestApproved ? String(latestApproved.revision) : null) !== input.expectedLatestApprovedRevision
      ) throw new WflApplicationError('approval_stale_revision')
      const duplicateCode = await sql<{ subject_id: string }>`
        SELECT e.subject_id
        FROM wfl_definition_versions v
        JOIN approval_entries e ON e.id = v.approval_entry_id
        WHERE v.compiled_graph->>'code' = ${prepared.graph.code}
          AND e.subject_id <> ${input.subjectId}
        LIMIT 1
      `.execute(tx)
      if (duplicateCode.rows.length > 0) throw new WflApplicationError('wfl_definition_code_conflict')
      const now = new Date()
      if (!subject) {
        const counter = await tx.updateTable('dcl_code_counters')
          .set((eb) => ({ next_value: eb('next_value', '+', 1) }))
          .where('entity', '=', 'wfl-process-definition').returning('next_value').executeTakeFirstOrThrow()
        await tx.insertInto('dcl_subjects').values({
          id: input.subjectId, entity: 'wfl-process-definition',
          code: `wfl-${String(counter.next_value - 1).padStart(6, '0')}`,
          created_at: now, created_by: actor.id,
        }).execute()
      }
      const versionNo = history.length + 1
      await tx.insertInto('approval_entries').values({
        id: input.submissionId, domain: 'dcl', entity: 'wfl-process-definition',
        subject_id: input.subjectId, version_no: versionNo, status: 'PENDING', revision: 1,
        submitted_by: actor.id, submitted_at: now, updated_by: actor.id, updated_at: now,
      }).execute()
      await tx.insertInto('wfl_definition_versions').values({
        approval_entry_id: input.submissionId, script: input.script,
        compiled_graph: json(prepared.graph),
      }).execute()
      await tx.insertInto('wfl_trials').values({
        approval_entry_id: input.submissionId, document_id: input.trialDocument.documentId,
        payload_digest: prepared.payloadDigest, result: json(prepared.result),
        created_at: now, created_by: actor.id,
      }).execute()
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: input.submissionId, domain: 'dcl', entity: 'wfl-process-definition',
        subject_id: input.subjectId, version_no: versionNo, action: 'SUBMITTED',
        from_status: null, to_status: 'PENDING', from_revision: null, to_revision: 1,
        actor_id: actor.id, reason: null, request_id: requestId, created_at: now,
      }).execute()
      return this.readDefinition(tx, input.submissionId, actor)
    })
  }

  async review(action: ApprovalAction, input: WflReviewInput, actor: ApprovalActor, requestId: string) {
    requirePermission(actor, `/dcl/wfl-process-definition/${action}`)
    return this.db.transaction().execute(async (tx) => {
      const row = await tx.selectFrom('approval_entries').selectAll()
        .where('id', '=', input.submissionId).where('domain', '=', 'dcl')
        .where('entity', '=', 'wfl-process-definition').where('subject_id', '=', input.subjectId)
        .forUpdate().executeTakeFirst()
      if (!row) throw new WflApplicationError('approval_not_found')
      if (action === 'approve') {
        const definition = await tx.selectFrom('wfl_definition_versions').select('script')
          .where('approval_entry_id', '=', row.id).executeTakeFirstOrThrow()
        const trial = await tx.selectFrom('wfl_trials').select('document_id')
          .where('approval_entry_id', '=', row.id).orderBy('created_at', 'desc').executeTakeFirst()
        if (!trial) throw new WflApplicationError('wfl_trial_required')
        const document = await tx.selectFrom('vou_documents').select('entity').where('id', '=', trial.document_id).executeTakeFirst()
        if (!document) throw new WflApplicationError('wfl_trial_document_not_found')
        await this.compileAndTrial(tx, definition.script, { entity: document.entity as VouEntity, documentId: trial.document_id }, actor)
      }
      if (action === 'unapprove') {
        const blocker = await tx.selectFrom('wfl_instances').select('id')
          .where('approval_entry_id', '=', row.id).executeTakeFirst()
        if (blocker) throw new WflApplicationError('wfl_definition_in_use', [{ kind: 'WFL_INSTANCE', id: blocker.id }])
      }
      const now = new Date()
      const decision = decideApproval({
        action, entry: approvalEntry(row), actor,
        expectedRevision: input.expectedRevision, occurredAt: now.toISOString(), requestId,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      })
      if (!decision.ok) throw new WflApplicationError(decision.error.errorKey)
      const plan = decision.plan
      await tx.updateTable('approval_entries').set({
        status: plan.toStatus, revision: BigInt(plan.toRevision), updated_by: actor.id, updated_at: now,
        approved_by: plan.metadata.approved?.actorId ?? null,
        approved_at: plan.metadata.approved ? new Date(plan.metadata.approved.occurredAt) : null,
        rejected_by: plan.metadata.rejected?.actorId ?? null,
        rejected_at: plan.metadata.rejected ? new Date(plan.metadata.rejected.occurredAt) : null,
        rejection_reason: plan.metadata.rejected?.reason ?? null,
      }).where('id', '=', row.id).where('revision', '=', plan.fromRevision).executeTakeFirstOrThrow()
      await tx.insertInto('approval_events').values({
        id: ulid(), entry_id: row.id, domain: 'dcl', entity: 'wfl-process-definition',
        subject_id: row.subject_id, version_no: row.version_no, action: plan.event.action,
        from_status: plan.fromStatus, to_status: plan.toStatus,
        from_revision: BigInt(plan.fromRevision), to_revision: BigInt(plan.toRevision),
        actor_id: actor.id, reason: plan.reason ?? null, request_id: requestId, created_at: now,
      }).execute()
      return this.readDefinition(tx, row.id, actor)
    })
  }

  async setEnabled(input: WflEnableInput, enabled: boolean, actor: ApprovalActor) {
    requirePermission(actor, `/dcl/wfl-process-definition/${enabled ? 'enable' : 'disable'}`)
    return this.db.transaction().execute(async (tx) => {
      const entry = await tx.selectFrom('approval_entries').select(['id', 'revision'])
        .where('id', '=', input.approvalEntryId).where('domain', '=', 'dcl')
        .where('entity', '=', 'wfl-process-definition').where('subject_id', '=', input.subjectId)
        .where('status', '=', 'APPROVED').executeTakeFirst()
      if (!entry || String(entry.revision) !== input.expectedApprovalRevision)
        throw new WflApplicationError('approval_stale_revision')
      const latest = await tx.selectFrom('approval_entries').select('id')
        .where('domain', '=', 'dcl').where('entity', '=', 'wfl-process-definition')
        .where('subject_id', '=', input.subjectId).where('status', '=', 'APPROVED')
        .orderBy('version_no', 'desc').executeTakeFirst()
      if (latest?.id !== input.approvalEntryId) throw new WflApplicationError('approval_not_latest_approved')
      const runtime = await tx.selectFrom('wfl_definition_runtime_states').selectAll()
        .where('subject_id', '=', input.subjectId).forUpdate().executeTakeFirst()
      const now = new Date()
      if (!runtime) {
        if (input.expectedRuntimeRevision !== null) throw new WflApplicationError('approval_stale_revision')
        await tx.insertInto('wfl_definition_runtime_states').values({
          subject_id: input.subjectId, enabled, updated_at: now, updated_by: actor.id,
        }).execute()
        return { subjectId: input.subjectId, approvalEntryId: entry.id, enabled, revision: '1' }
      }
      if (String(runtime.revision) !== input.expectedRuntimeRevision)
        throw new WflApplicationError('approval_stale_revision')
      const revision = BigInt(runtime.revision) + 1n
      await tx.updateTable('wfl_definition_runtime_states').set({ enabled, revision, updated_at: now, updated_by: actor.id })
        .where('subject_id', '=', input.subjectId).where('revision', '=', runtime.revision).executeTakeFirstOrThrow()
      return { subjectId: input.subjectId, approvalEntryId: entry.id, enabled, revision: String(revision) }
    })
  }

  async current(code: string, actor: ApprovalActor) {
    requirePermission(actor, '/wfl/process-definition/get')
    const row = await sql<{ id: string; enabled: boolean }>`
      SELECT e.id, r.enabled
      FROM dcl_subjects s
      JOIN wfl_definition_runtime_states r ON r.subject_id = s.id AND r.enabled
      JOIN approval_entries e ON e.subject_id = s.id AND e.domain = 'dcl'
        AND e.entity = 'wfl-process-definition' AND e.status = 'APPROVED'
      JOIN wfl_definition_versions v ON v.approval_entry_id = e.id
      WHERE v.compiled_graph->>'code' = ${code}
      ORDER BY e.version_no DESC
      LIMIT 1
    `.execute(this.db)
    if (!row.rows[0]) throw new WflApplicationError('wfl_definition_not_found')
    const view = await this.readDefinition(this.db, row.rows[0].id, actor)
    return { subjectId: view.subjectId, approvalEntryId: view.submissionId, code: view.compiledGraph.code, name: view.compiledGraph.name, enabled: row.rows[0].enabled, compiledGraph: view.compiledGraph }
  }

  async trial(
    input:
      | { script: string; document: { entity: VouEntity; documentId: string } }
      | { approvalEntryId: string; document: { entity: VouEntity; documentId: string } },
    actor: ApprovalActor,
  ) {
    requirePermission(actor, '/wfl/process-definition/trial')
    if ('script' in input)
      return this.compileAndTrial(this.db, input.script, input.document, actor)
    const definition = await this.db.selectFrom('wfl_definition_versions').select('script')
      .where('approval_entry_id', '=', input.approvalEntryId).executeTakeFirst()
    if (!definition) throw new WflApplicationError('wfl_definition_not_found')
    return this.compileAndTrial(this.db, definition.script, input.document, actor)
  }

  private async createChild(
    tx: Transaction<DB>,
    view: WflInstanceView,
    node: WflInstanceNodeView,
    input: WflNodeActionInput,
    actor: ApprovalActor,
    requestId: string,
    port: WflVouPort,
  ): Promise<WflInstanceView> {
    if (!input.targetNodeKey || !input.requestKey || input.requestKey.length < 16 || input.requestKey.length > 64)
      throw new WflApplicationError('wfl_request_key_invalid')
    const target = view.availableTargets.find((item) => item.parentNodeId === node.nodeId && item.targetNodeKey === input.targetNodeKey)
    if (!target) throw new WflApplicationError('wfl_child_target_unavailable')
    const position = `edge:${node.nodeKey}:${target.targetNodeKey}:${target.relation}`
    const fingerprint = this.actionFingerprint('CREATE_CHILD', node.nodeId, target.targetNodeKey, input.requestKey)
    const existing = await tx.selectFrom('wfl_action_results').selectAll()
      .where('instance_id', '=', input.processId).where('source_node_id', '=', node.nodeId)
      .where('script_position', '=', position).forUpdate().executeTakeFirst()
    if (existing?.active) {
      if (existing.fingerprint !== fingerprint) throw new WflApplicationError('wfl_action_conflict')
      return this.readInstance(tx, input.processId, actor)
    }
    if (existing) {
      const consumed = await sql<{ id: string }>`
        SELECT id FROM wfl_runtime_audits
        WHERE instance_id = ${input.processId} AND action = 'CREATE_CHILD'
          AND details->>'requestKey' = ${input.requestKey}
        LIMIT 1
      `.execute(tx)
      if (consumed.rows[0]) throw new WflApplicationError('wfl_request_key_consumed')
    }
    const child = await port.createChild(tx, {
      entity: target.targetEntity,
      parent: { entity: node.entity!, documentId: node.documentId!, submissionId: node.submissionId! },
      initial: target.initial, requestKey: input.requestKey, actor, requestId,
    })
    if (!child.documentId || !child.submissionId) throw new WflApplicationError('wfl_vou_port_invalid_result')
    const now = new Date()
    if (existing) await tx.updateTable('wfl_action_results').set({ fingerprint, target_document_id: child.documentId, active: true, created_at: now })
      .where('id', '=', existing.id).execute()
    else await tx.insertInto('wfl_action_results').values({
      id: ulid(), instance_id: input.processId, source_node_id: node.nodeId, script_position: position,
      fingerprint, target_document_id: child.documentId, active: true, created_at: now,
    }).execute()
    await tx.insertInto('wfl_instance_nodes').values({
      id: ulid(), instance_id: input.processId, node_key: target.targetNodeKey, document_id: child.documentId,
      parent_node_id: node.nodeId, relation: target.relation, created_at: now,
    }).execute()
    await this.audit(tx, input.processId, 'CREATE_CHILD', actor.id, {
      nodeId: node.nodeId, targetNodeKey: target.targetNodeKey, documentId: child.documentId,
      submissionId: child.submissionId, requestKey: input.requestKey,
    }, now)
    return this.readInstance(tx, input.processId, actor)
  }

  private actionFingerprint(...parts: string[]): string {
    return createHash('sha256').update(parts.join('\u0000')).digest('hex')
  }

  private async audit(
    tx: Transaction<DB>,
    instanceId: string,
    action: string,
    actorId: string,
    details: Record<string, unknown>,
    createdAt: Date,
  ): Promise<void> {
    await tx.insertInto('wfl_runtime_audits').values({
      id: ulid(), instance_id: instanceId, action, actor_id: actorId, details: json(details), created_at: createdAt,
    }).execute()
  }

  private async readInstance(executor: Executor, processId: string, actor: ApprovalActor): Promise<WflInstanceView> {
    const instance = await executor.selectFrom('wfl_instances as i')
      .innerJoin('vou_documents as root', 'root.id', 'i.root_document_id')
      .innerJoin('wfl_definition_versions as v', 'v.approval_entry_id', 'i.approval_entry_id')
      .select(['i.id', 'i.definition_subject_id', 'i.approval_entry_id', 'i.definition_code', 'i.definition_name', 'i.root_document_id', 'i.created_at',
        'root.document_no as root_document_no', 'root.entity as root_entity', 'v.script', 'v.compiled_graph'])
      .where('i.id', '=', processId).executeTakeFirst()
    if (!instance) throw new WflApplicationError('wfl_instance_not_found')
    const graph = instance.compiled_graph as unknown as WflStarlarkGraph
    const rawNodes = await executor.selectFrom('wfl_instance_nodes as n')
      .leftJoin('vou_documents as d', 'd.id', 'n.document_id')
      .leftJoin('approval_entries as e', (join) => join.onRef('e.subject_id', '=', 'd.id').on('e.domain', '=', 'vou'))
      .select(['n.id', 'n.node_key', 'n.document_id', 'n.parent_node_id', 'n.relation', 'n.created_at',
        'd.document_no', 'd.entity', 'e.id as submission_id', 'e.status', 'e.revision'])
      .where('n.instance_id', '=', processId).orderBy('n.created_at', 'asc').orderBy('n.id', 'asc').execute()
    const activeRows = await executor.selectFrom('wfl_action_results').select(['source_node_id', 'script_position'])
      .where('instance_id', '=', processId).where('active', '=', true).execute()
    const active = new Set(activeRows.map((row) => `${row.source_node_id}:${row.script_position}`))
    const targetMap = new Map<string, WflAvailableChildTarget[]>()
    for (const row of rawNodes) {
      if (!row.document_id || !row.entity || row.status !== 'APPROVED') continue
      const persisted = await readVouPersistence(executor, { approvalEntryId: row.submission_id! })
      const evaluated = await this.runtime.run({ source: instance.script, operation: 'evaluate', sourceNodeKey: row.node_key, input: persisted.payload })
      if (!evaluated.ok || !evaluated.evaluation) throw new WflApplicationError('wfl_runtime_failed')
      const targets = evaluated.evaluation.branches.flatMap((branch) => {
        if (!branch.matched) return []
        const edge = graph.edges.find((item) => item.sourceKey === row.node_key && item.targetKey === branch.targetKey)
        const targetNode = graph.nodes.find((item) => item.key === branch.targetKey)
        if (!edge || !targetNode || !this.can(actor, '/wfl/process-instance/create-child')) return []
        const position = `edge:${row.node_key}:${targetNode.key}:${edge.relation}`
        if (active.has(`${row.id}:${position}`)) return []
        return [{ parentNodeId: row.id, targetNodeKey: targetNode.key, targetNodeName: targetNode.name,
          targetEntity: targetNode.entity as VouEntity, relation: edge.relation, actionName: edge.actionName,
          initial: branch.initial ?? {} } satisfies WflAvailableChildTarget]
      })
      targetMap.set(row.id, targets)
    }
    const availableTargets = [...targetMap.values()].flat()
    const nodes: WflInstanceNodeView[] = rawNodes.map((row) => {
      const graphNode = graph.nodes.find((item) => item.key === row.node_key)
      const entity = row.entity as VouEntity | null
      const actions: WflNodeAction[] = []
      if (entity && row.document_id && this.can(actor, `/vou/${entity}/get`)) actions.push('OPEN_DOCUMENT')
      if (targetMap.get(row.id)?.length) actions.push('CREATE_CHILD')
      if (row.parent_node_id && entity && row.status === 'PENDING') {
        if (this.can(actor, '/wfl/process-instance/approve-child')) actions.push('APPROVE_CHILD')
        if (this.can(actor, '/wfl/process-instance/reject-child')) actions.push('REJECT_CHILD')
        if (this.can(actor, '/wfl/process-instance/cancel-child')) actions.push('CANCEL_CHILD')
      }
      if (row.parent_node_id && entity && row.status === 'REJECTED') {
        if (this.can(actor, '/wfl/process-instance/retry-child')) actions.push('RETRY_CHILD')
        if (this.can(actor, '/wfl/process-instance/cancel-child')) actions.push('CANCEL_CHILD')
      }
      return { nodeId: row.id, nodeKey: row.node_key, nodeName: graphNode?.name ?? row.node_key,
        documentId: row.document_id, documentNo: row.document_no, entity, submissionId: row.submission_id,
        status: row.status as ApprovalStatus | null, revision: row.revision === null ? null : String(row.revision),
        parentNodeId: row.parent_node_id, relation: row.relation, createdAt: row.created_at.toISOString(), availableActions: actions }
    })
    return { processId: instance.id, definitionSubjectId: instance.definition_subject_id, approvalEntryId: instance.approval_entry_id,
      definitionCode: instance.definition_code, definitionName: instance.definition_name, rootDocumentId: instance.root_document_id,
      rootDocumentNo: instance.root_document_no, rootEntity: instance.root_entity as VouEntity, createdAt: instance.created_at.toISOString(),
      nodes, availableTargets }
  }

  private can(actor: ApprovalActor, permission: string): boolean {
    return actor.trusted === true || actor.permissions.includes(permission)
  }

  private async compileAndTrial(executor: Executor, script: string, document: { entity: VouEntity; documentId: string }, actor: ApprovalActor) {
    if (script.length > 65_536) throw new WflApplicationError('wfl_script_too_large')
    const compiled = await this.runtime.run({ source: script, operation: 'compile' })
    if (!compiled.ok || !compiled.graph) throw new WflApplicationError('wfl_compile_failed')
    if (compiled.graph.nodes.length > 128 || compiled.graph.edges.length > 127)
      throw new WflApplicationError('wfl_resource_limit')
    const root = compiled.graph.nodes.find((node) => node.key === compiled.graph?.rootKey)
    if (!root || root.entity !== document.entity) throw new WflApplicationError('wfl_trial_entity_mismatch')
    let persisted
    try {
      persisted = await readVouPersistence(executor, { documentId: document.documentId })
    } catch (error) {
      if (!(error instanceof VouApplicationError) || error.errorKey !== 'vou_not_found') throw error
      throw new WflApplicationError('wfl_trial_document_not_found')
    }
    if (persisted.entity !== document.entity) throw new WflApplicationError('wfl_trial_document_not_found')
    const result = await this.runtime.run({ source: script, operation: 'evaluate', sourceNodeKey: compiled.graph.rootKey, input: persisted.payload })
    if (!result.ok) throw new WflApplicationError('wfl_trial_failed')
    const payloadDigest = createHash('sha256').update(JSON.stringify(persisted.payload)).digest('hex')
    return { graph: compiled.graph, result: result as WflStarlarkResult, payloadDigest, actorId: actor.id }
  }

  private async readDefinition(executor: Executor, entryId: string, actor: ApprovalActor) {
    const row = await executor.selectFrom('approval_entries as e')
      .innerJoin('wfl_definition_versions as v', 'v.approval_entry_id', 'e.id')
      .innerJoin('dcl_subjects as s', 's.id', 'e.subject_id')
      .leftJoin('wfl_definition_runtime_states as r', 'r.subject_id', 's.id')
      .select(['e.id', 'e.subject_id', 'e.version_no', 'e.status', 'e.revision', 'e.submitted_by', 'e.submitted_at',
        'e.approved_by', 'e.approved_at', 'e.rejected_by', 'e.rejected_at', 'e.rejection_reason',
        's.code', 'v.script', 'v.compiled_graph', 'r.enabled', 'r.revision as runtime_revision'])
      .where('e.id', '=', entryId).executeTakeFirst()
    if (!row) throw new WflApplicationError('wfl_definition_not_found')
    if (!row.code) throw new WflApplicationError('wfl_definition_not_found')
    const entry = approvalEntry(row)
    return {
      subjectId: row.subject_id, code: row.code, submissionId: row.id,
      versionNo: row.version_no, status: row.status as ApprovalStatus, revision: String(row.revision),
      script: row.script, compiledGraph: row.compiled_graph as unknown as WflStarlarkGraph,
      enabled: row.enabled ?? false, runtimeRevision: row.runtime_revision === null ? null : String(row.runtime_revision),
      availableApprovalActions: availableApprovalActions(entry, actor),
    }
  }
}
