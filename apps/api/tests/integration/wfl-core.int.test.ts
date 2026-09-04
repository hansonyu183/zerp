import assert from 'node:assert/strict'
import test from 'node:test'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import { ulid } from 'ulid'

import { createDatabase } from '../../src/db/database.ts'
import { VouService } from '../../src/vou/service.ts'
import { WflService } from '../../src/wfl/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const script = 'root = node(key="root", name="销售订单", entity="sale-order")\nchild = node(key="outbound", name="销售出库", entity="sale-outbound")\nworkflow(code="safe-flow", name="安全流程", root=root, edges=[edge(source=root, target=child, relation="outbound", action=sale_outbound(initial={}))])'

test('WFL definition compiles, trials against a real VOU, approves and becomes current', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const runtime = await createNodeWflStarlark()
  const vou = new VouService(db)
  const wfl = new WflService(db, runtime)
  const submitterId = ulid(), reviewerId = ulid()
  const submitter = { id: submitterId, permissions: [] as string[], trusted: true }
  const reviewer = { id: reviewerId, permissions: [] as string[], trusted: true }
  context.after(async () => {
    try {
      await db.deleteFrom('wfl_instances').execute()
      await db.deleteFrom('wfl_definition_runtime_states').execute()
      await db.deleteFrom('wfl_trials').execute()
      await db.deleteFrom('approval_events').where('entity', '=', 'wfl-process-definition').execute()
      await db.deleteFrom('approval_entries').where('entity', '=', 'wfl-process-definition').execute()
      await db.deleteFrom('dcl_subjects').where('entity', '=', 'wfl-process-definition').execute()
      await db.deleteFrom('approval_events').where('domain', '=', 'vou').execute()
      await db.deleteFrom('vou_idempotency').execute()
      await db.deleteFrom('approval_entries').where('domain', '=', 'vou').execute()
      await db.deleteFrom('vou_documents').execute()
      await db.deleteFrom('app_users').where('id', 'in', [submitterId, reviewerId]).execute()
    } finally { await db.destroy() }
  })
  await db.insertInto('app_users').values([submitterId, reviewerId].map((id) => ({
    id, username: `wfl-${id}`, display_name: 'WFL actor', password_hash: 'unused',
    status: 'ENABLED' as const, password_changed_at: new Date(), password_change_required: false,
  }))).execute()
  const documentId = ulid(), vouSubmissionId = ulid()
  await vou.submit('sale-order', 'submit-new', {
    documentId, submissionId: vouSubmissionId, idempotencyKey: vouSubmissionId,
    expectedRevision: null, payload: { businessDate: '2026-09-04', currency: 'CNY', amount: '1.00', lines: [], attachments: [] },
  }, submitter, 'wfl-vou')
  const subjectId = ulid(), submissionId = ulid()
  const pending = await wfl.submit('submit-new', {
    subjectId, submissionId, idempotencyKey: submissionId,
    expectedLatestApprovedSubmissionId: null, expectedLatestApprovedRevision: null,
    script, trialDocument: { entity: 'sale-order', documentId },
  }, submitter, 'wfl-submit')
  assert.equal(pending.status, 'PENDING')
  assert.equal(pending.compiledGraph.code, 'safe-flow')
  const approved = await wfl.review('approve', {
    subjectId, submissionId, expectedRevision: pending.revision,
  }, reviewer, 'wfl-approve')
  assert.equal(approved.status, 'APPROVED')
  const enabled = await wfl.setEnabled({
    subjectId, approvalEntryId: submissionId, expectedApprovalRevision: approved.revision,
    expectedRuntimeRevision: null,
  }, true, reviewer)
  assert.equal(enabled.enabled, true)
  assert.equal((await wfl.current('safe-flow', reviewer)).approvalEntryId, submissionId)
  const coordinatedVou = new VouService(db, { wfl })
  const approvedRoot = await coordinatedVou.review('sale-order', 'approve', {
    documentId, submissionId: vouSubmissionId, expectedRevision: '1',
  }, reviewer, 'wfl-root-approve')
  assert.equal(approvedRoot.status, 'APPROVED')
  const instance = await db.selectFrom('wfl_instances').selectAll().where('root_document_id', '=', documentId).executeTakeFirstOrThrow()
  assert.equal(instance.approval_entry_id, submissionId)
  assert.equal(instance.definition_code, 'safe-flow')
})
