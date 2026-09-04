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

  constructor(db: Kysely<DB>, runtime: WflStarlark) {
    this.db = db
    this.runtime = runtime
  }

  async apply(tx: Transaction<DB>, plan: WflApplicationPlan): Promise<void> {
    if (!plan.action || !plan.entity || !plan.documentId || !plan.approvalEntryId || !plan.payload || !plan.actorId || !plan.occurredAt) return
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
    const row = await sql<{ id: string }>`
      SELECT e.id
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
    return { subjectId: view.subjectId, approvalEntryId: view.submissionId, code: view.compiledGraph.code, name: view.compiledGraph.name, compiledGraph: view.compiledGraph }
  }

  async trial(approvalEntryId: string, document: { entity: VouEntity; documentId: string }, actor: ApprovalActor) {
    requirePermission(actor, '/wfl/process-definition/trial')
    const definition = await this.db.selectFrom('wfl_definition_versions').select('script')
      .where('approval_entry_id', '=', approvalEntryId).executeTakeFirst()
    if (!definition) throw new WflApplicationError('wfl_definition_not_found')
    return this.compileAndTrial(this.db, definition.script, document, actor)
  }

  private async compileAndTrial(executor: Executor, script: string, document: { entity: VouEntity; documentId: string }, actor: ApprovalActor) {
    if (script.length > 65_536) throw new WflApplicationError('wfl_script_too_large')
    const compiled = await this.runtime.run({ source: script, operation: 'compile' })
    if (!compiled.ok || !compiled.graph) throw new WflApplicationError('wfl_compile_failed')
    if (compiled.graph.nodes.length > 128 || compiled.graph.edges.length > 127)
      throw new WflApplicationError('wfl_resource_limit')
    const root = compiled.graph.nodes.find((node) => node.key === compiled.graph?.rootKey)
    if (!root || root.entity !== document.entity) throw new WflApplicationError('wfl_trial_entity_mismatch')
    const row = await executor.selectFrom('vou_document_payloads as p')
      .innerJoin('vou_documents as d', 'd.id', 'p.document_id')
      .select(['d.entity', 'p.payload']).where('d.id', '=', document.documentId).executeTakeFirst()
    if (!row || row.entity !== document.entity) throw new WflApplicationError('wfl_trial_document_not_found')
    const result = await this.runtime.run({ source: script, operation: 'evaluate', sourceNodeKey: compiled.graph.rootKey, input: row.payload })
    if (!result.ok) throw new WflApplicationError('wfl_trial_failed')
    const payloadDigest = createHash('sha256').update(JSON.stringify(row.payload)).digest('hex')
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
