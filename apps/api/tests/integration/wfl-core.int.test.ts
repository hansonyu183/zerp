import assert from 'node:assert/strict'
import test from 'node:test'
import type { VouPayload } from '@zerp/model'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import { ulid } from 'ulid'

import { createDatabase } from '../../src/db/database.ts'
import { VouApplicationError, VouService } from '../../src/vou/service.ts'
import { WflService, type WflVouPort } from '../../src/wfl/service.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const sourceOrderLineId = '01J00000000000000000000005'
const script = `root = node(key="root", name="销售订单", entity="sale-order")\nchild = node(key="outbound", name="销售出库", entity="sale-outbound")\nworkflow(code="safe-flow", name="安全流程", root=root, edges=[edge(source=root, target=child, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"1"}]}))])`

function createWflAndVou(db: ReturnType<typeof createDatabase>, runtime: Awaited<ReturnType<typeof createNodeWflStarlark>>) {
  let vou!: VouService
  const port: WflVouPort = {
    createChild: (...args) => vou.createChild(...args),
    approveChild: (...args) => vou.approveChild(...args),
    rejectChild: (...args) => vou.rejectChild(...args),
    retryChild: (...args) => vou.retryChild(...args),
    cancelChild: (...args) => vou.cancelChild(...args),
  }
  const wfl = new WflService(db, runtime, port)
  vou = new VouService(db, {
    acc: {
      async apply() {},
      async partyBalance() { return 0n },
      async customerCreditOccupancy() { return 0n },
    },
    wfl,
  })
  return { wfl, vou }
}

async function seedSaleOrderReferences(db: ReturnType<typeof createDatabase>, actorId: string) {
  const codeSuffix = String(
    [...actorId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 10_000,
  ).padStart(4, '0')
  const fixtures = [
    { entity: 'customer', field: 'customer', code: `CUS-${codeSuffix}`, name: 'WFL 客户' },
    { entity: 'employee', field: 'salesperson', code: `EMP-${codeSuffix}`, name: 'WFL 销售员' },
    { entity: 'warehouse', field: 'warehouse', code: `WHS-${codeSuffix}`, name: 'WFL 仓库' },
    { entity: 'product', field: 'product', code: `PRD-${codeSuffix}`, name: 'WFL 产品' },
  ] as const
  const facts = fixtures.map((fixture) => ({ ...fixture, objectId: ulid(), approvalEntryId: ulid() }))
  const now = new Date()
  await db.insertInto('dcl_subjects').values(facts.map((fact) => ({ id: fact.objectId, entity: fact.entity, code: fact.code, created_at: now, created_by: actorId }))).execute()
  await db.insertInto('approval_entries').values(facts.map((fact) => ({ id: fact.approvalEntryId, domain: 'dcl', entity: fact.entity, subject_id: fact.objectId, version_no: 1, status: 'APPROVED', revision: 1, submitted_by: actorId, submitted_at: now, updated_by: actorId, updated_at: now, approved_by: actorId, approved_at: now }))).execute()
  for (const fact of facts) {
    if (fact.entity === 'customer')
      await db.insertInto('dcl_customer_versions').values({ approval_entry_id: fact.approvalEntryId, kind: 'ENTERPRISE', display_name: fact.name, remittance_profiles: JSON.stringify([]), tax_attachments: JSON.stringify([]), enabled: true }).execute()
    if (fact.entity === 'employee')
      await db.insertInto('dcl_employee_versions').values({ approval_entry_id: fact.approvalEntryId, display_name: fact.name, source_snapshots: {}, enabled: true }).execute()
    if (fact.entity === 'warehouse')
      await db.insertInto('dcl_warehouse_versions').values({ approval_entry_id: fact.approvalEntryId, name: fact.name, enabled: true }).execute()
    if (fact.entity === 'product')
      await db.insertInto('dcl_product_versions').values({ approval_entry_id: fact.approvalEntryId, name: fact.name, source_snapshots: {}, unit_conversions: JSON.stringify([]), recyclable: false, enabled: true }).execute()
  }
  const customer = facts.find((fact) => fact.field === 'customer')!
  const customerSubunitId = ulid()
  await db.insertInto('dcl_customer_subunit_roots').values({ subunit_id: customerSubunitId, customer_id: customer.objectId, code: `SUB-${codeSuffix}` }).execute()
  await db.insertInto('dcl_customer_version_subunits').values({
    customer_approval_entry_id: customer.approvalEntryId, subunit_id: customerSubunitId,
    name: 'WFL 客户子单位', settlement_snapshot: null, credit_limits: JSON.stringify([]), enabled: true,
  }).execute()
  const referenceFacts = [...facts, {
    entity: 'customer-subunit', field: 'customer-subunit', objectId: customerSubunitId,
    approvalEntryId: customer.approvalEntryId, code: `SUB-${codeSuffix}`, name: 'WFL 客户子单位',
  }]
  const unitId = ulid()
  const unitCode = String([...unitId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 10_000).padStart(4, '0')
  await db.insertInto('aux_objects').values({
    id: unitId, entity: 'measurement-unit', code: `TST-${unitCode}`,
    data: { name: '件', quantityScale: 0 }, enabled: true,
    created_by: actorId, updated_by: actorId,
  }).execute()
  return { facts: referenceFacts, unitId }
}

function saleOrderPayload(references: Awaited<ReturnType<typeof seedSaleOrderReferences>>): VouPayload {
  const ref = (field: 'customer-subunit' | 'salesperson' | 'warehouse' | 'product') => {
    const fact = references.facts.find((item) => item.field === field)!
    return { objectId: fact.objectId, approvalEntryId: fact.approvalEntryId, selectionOrigin: 'CURRENT' as const }
  }
  const product = references.facts.find((item) => item.field === 'product')!
  return {
    businessDate: '2026-09-04', currency: 'CNY', attachments: [],
    customerSubunit: ref('customer-subunit'), salesperson: ref('salesperson'), warehouse: ref('warehouse'),
    productLines: [{
      lineId: sourceOrderLineId,
      product: { objectId: product.objectId }, enteredQuantity: '1',
      enteredUnit: { objectId: references.unitId }, baseQuantity: '1', unitPrice: '1.00',
    }],
  }
}

test('WFL child creation rejects static attachment staging references', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const runtime = await createNodeWflStarlark()
  const { vou } = createWflAndVou(db, runtime)
  context.after(async () => db.destroy())

  await assert.rejects(
    db.transaction().execute((transaction) =>
      vou.createChild(transaction, {
        entity: 'sale-outbound',
        parent: {
          entity: 'sale-order',
          documentId: ulid(),
          submissionId: ulid(),
        },
        initial: {
          businessDate: '2026-09-04',
          currency: 'CNY',
          attachments: [
            {
              id: ulid(),
              stagingId: ulid(),
              fileName: 'script.pdf',
              contentType: 'application/pdf',
              sizeBytes: 1,
              sha256: '0'.repeat(64),
            },
          ],
          sourceLines: [],
        },
        requestKey: 'wfl-static-attachment-test',
        actor: { id: ulid(), permissions: [], trusted: true },
        requestId: 'wfl-static-attachment-test',
      }),
    ),
    (error: unknown) =>
      error instanceof VouApplicationError &&
      error.errorKey === 'vou_invalid_payload',
  )
})

async function cleanupSaleOrderReferences(db: ReturnType<typeof createDatabase>, references: Awaited<ReturnType<typeof seedSaleOrderReferences>>) {
  await db.deleteFrom('aux_objects').where('id', '=', references.unitId).execute()
  await db.deleteFrom('approval_entries').where('id', 'in', references.facts.map((item) => item.approvalEntryId)).execute()
  await db.deleteFrom('dcl_subjects').where('id', 'in', references.facts.map((item) => item.objectId)).execute()
}

test('WFL definition compiles, trials against a real VOU, approves and becomes current', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const runtime = await createNodeWflStarlark()
  const { vou, wfl } = createWflAndVou(db, runtime)
  const submitterId = ulid(), reviewerId = ulid()
  const submitter = { id: submitterId, permissions: [] as string[], trusted: true }
  const reviewer = { id: reviewerId, permissions: [] as string[], trusted: true }
  let refs: Awaited<ReturnType<typeof seedSaleOrderReferences>> | undefined
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
      if (refs) await cleanupSaleOrderReferences(db, refs)
      await db.deleteFrom('app_users').where('id', 'in', [submitterId, reviewerId]).execute()
    } finally { await db.destroy() }
  })
  await db.insertInto('app_users').values([submitterId, reviewerId].map((id) => ({
    id, username: `wfl-${id}`, display_name: 'WFL actor', password_hash: 'unused',
    status: 'ENABLED' as const, password_changed_at: new Date(), password_change_required: false,
  }))).execute()
  refs = await seedSaleOrderReferences(db, submitterId)
  const documentId = ulid(), vouSubmissionId = ulid()
  await vou.submit('sale-order', 'submit-new', {
    documentId, submissionId: vouSubmissionId, idempotencyKey: vouSubmissionId,
    expectedRevision: null, payload: saleOrderPayload(refs),
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
  const approvedRoot = await vou.review('sale-order', 'approve', {
    documentId, submissionId: vouSubmissionId, expectedRevision: '1',
  }, reviewer, 'wfl-root-approve')
  assert.equal(approvedRoot.status, 'APPROVED')
  const instance = await db.selectFrom('wfl_instances').selectAll().where('root_document_id', '=', documentId).executeTakeFirstOrThrow()
  assert.equal(instance.approval_entry_id, submissionId)
  assert.equal(instance.definition_code, 'safe-flow')
  await assert.rejects(
    wfl.review('unapprove', { subjectId, submissionId, expectedRevision: approved.revision, reason: '实例仍固定此版本' }, reviewer, 'wfl-definition-blocker'),
    (error: unknown) => error instanceof Error && error.message === 'wfl_definition_in_use',
  )
})

test('WFL definition lifecycle exposes candidates, history and a derived current fallback', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const runtime = await createNodeWflStarlark()
  const { vou, wfl } = createWflAndVou(db, runtime)
  const actorId = ulid(), reviewerId = ulid()
  const actor = { id: actorId, permissions: [] as string[], trusted: true }
  const reviewer = { id: reviewerId, permissions: [] as string[], trusted: true }
  let refs: Awaited<ReturnType<typeof seedSaleOrderReferences>> | undefined
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
      if (refs) await cleanupSaleOrderReferences(db, refs)
      await db.deleteFrom('app_users').where('id', 'in', [actorId, reviewerId]).execute()
    } finally { await db.destroy() }
  })
  await db.insertInto('app_users').values([actorId, reviewerId].map((id) => ({
    id, username: `wfl-${id}`, display_name: 'WFL actor', password_hash: 'unused',
    status: 'ENABLED' as const, password_changed_at: new Date(), password_change_required: false,
  }))).execute()
  refs = await seedSaleOrderReferences(db, actorId)
  const documentId = ulid(), vouSubmissionId = ulid()
  await vou.submit('sale-order', 'submit-new', {
    documentId, submissionId: vouSubmissionId, idempotencyKey: vouSubmissionId,
    expectedRevision: null, payload: saleOrderPayload(refs),
  }, actor, 'wfl-lifecycle-vou')
  const subjectId = ulid(), v1 = ulid()
  const first = await wfl.submit('submit-new', {
    subjectId, submissionId: v1, idempotencyKey: v1,
    expectedLatestApprovedSubmissionId: null, expectedLatestApprovedRevision: null,
    script, trialDocument: { entity: 'sale-order', documentId },
  }, actor, 'wfl-lifecycle-v1')
  const approved = await wfl.review('approve', { subjectId, submissionId: v1, expectedRevision: first.revision }, reviewer, 'wfl-lifecycle-approve')
  await wfl.setEnabled({ subjectId, approvalEntryId: v1, expectedApprovalRevision: approved.revision, expectedRuntimeRevision: null }, true, reviewer)
  const v2 = ulid()
  const candidate = await wfl.submit('submit-change', {
    subjectId, submissionId: v2, idempotencyKey: v2,
    expectedLatestApprovedSubmissionId: v1, expectedLatestApprovedRevision: approved.revision,
    script: script.replace('安全流程', '安全流程 v2'), trialDocument: { entity: 'sale-order', documentId },
  }, actor, 'wfl-lifecycle-v2')
  const listed = await wfl.query(actor)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].latestApproved?.submissionId, v1)
  assert.equal(listed[0].openCandidate?.submissionId, v2)
  assert.equal((await wfl.get(subjectId, actor)).submissionId, v2)
  assert.deepEqual((await wfl.versions(subjectId, actor)).map((item) => item.submissionId), [v2, v1])
  assert.equal((await wfl.auditHistory(subjectId, actor)).at(-1)?.action, 'SUBMITTED')
  await wfl.delete({ subjectId, submissionId: v2, expectedRevision: candidate.revision }, actor, 'wfl-lifecycle-delete')
  assert.equal((await wfl.get(subjectId, actor)).submissionId, v1)
  assert.equal((await wfl.current('safe-flow', actor)).approvalEntryId, v1)
  assert.equal((await wfl.versions(subjectId, actor)).length, 1)
})

test('WFL instance persists exact-entry nodes and six typed actions through its required VOU port', async (context) => {
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const runtime = await createNodeWflStarlark()
  const actorId = ulid(), reviewerId = ulid()
  const actor = { id: actorId, permissions: [] as string[], trusted: true }
  const reviewer = { id: reviewerId, permissions: [] as string[], trusted: true }
  const { wfl, vou } = createWflAndVou(db, runtime)
  let refs: Awaited<ReturnType<typeof seedSaleOrderReferences>> | undefined
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
      if (refs) await cleanupSaleOrderReferences(db, refs)
      await db.deleteFrom('app_users').where('id', 'in', [actorId, reviewerId]).execute()
    } finally { await db.destroy() }
  })
  await db.insertInto('app_users').values([actorId, reviewerId].map((id) => ({ id, username: `wfl-${id}`, display_name: 'WFL actor', password_hash: 'unused', status: 'ENABLED' as const, password_changed_at: new Date(), password_change_required: false }))).execute()
  refs = await seedSaleOrderReferences(db, actorId)
  const rootDocumentId = ulid(), rootSubmissionId = ulid()
  await vou.submit('sale-order', 'submit-new', { documentId: rootDocumentId, submissionId: rootSubmissionId, idempotencyKey: rootSubmissionId, expectedRevision: null, payload: saleOrderPayload(refs) }, actor, 'wfl-actions-root')
  const actionScript = `root = node(key="root", name="销售订单", entity="sale-order")\noutbound = node(key="outbound", name="销售出库", entity="sale-outbound")\ndelivery = node(key="delivery", name="销售送货", entity="sale-delivery")\nworkflow(code="action-flow", name="动作流程", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"1"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"1"}]}))])`
  const subjectId = ulid(), definitionEntryId = ulid()
  const pending = await wfl.submit('submit-new', { subjectId, submissionId: definitionEntryId, idempotencyKey: definitionEntryId, expectedLatestApprovedSubmissionId: null, expectedLatestApprovedRevision: null, script: actionScript, trialDocument: { entity: 'sale-order', documentId: rootDocumentId } }, actor, 'wfl-actions-definition')
  const definition = await wfl.review('approve', { subjectId, submissionId: definitionEntryId, expectedRevision: pending.revision }, reviewer, 'wfl-actions-definition-approve')
  await wfl.setEnabled({ subjectId, approvalEntryId: definitionEntryId, expectedApprovalRevision: definition.revision, expectedRuntimeRevision: null }, true, reviewer)
  await vou.review('sale-order', 'approve', { documentId: rootDocumentId, submissionId: rootSubmissionId, expectedRevision: '1' }, reviewer, 'wfl-actions-root-approve')
  let instance = (await wfl.queryInstances({}, actor)).items[0]
  assert.equal(instance.approvalEntryId, definitionEntryId)
  const root = instance.nodes.find((node) => node.nodeKey === 'root')!
  await wfl.executeNodeAction({ processId: instance.processId, nodeId: root.nodeId, action: 'OPEN_DOCUMENT' }, reviewer, 'wfl-open')
  instance = await wfl.executeNodeAction({ processId: instance.processId, nodeId: root.nodeId, action: 'CREATE_CHILD', targetNodeKey: 'outbound', requestKey: 'wfl-action-request-0001' }, actor, 'wfl-create-outbound')
  const afterRetry = await wfl.executeNodeAction({ processId: instance.processId, nodeId: root.nodeId, action: 'CREATE_CHILD', targetNodeKey: 'outbound', requestKey: 'wfl-action-request-0001' }, actor, 'wfl-create-outbound-retry')
  assert.equal(afterRetry.nodes.filter((node) => node.nodeKey === 'outbound').length, 1)
  const outbound = afterRetry.nodes.find((node) => node.nodeKey === 'outbound')!
  instance = await wfl.executeNodeAction({ processId: instance.processId, nodeId: outbound.nodeId, action: 'APPROVE_CHILD', expectedRevision: outbound.revision! }, reviewer, 'wfl-approve-child')
  const approvedOutbound = instance.nodes.find((node) => node.nodeKey === 'outbound')!
  instance = await wfl.executeNodeAction({ processId: instance.processId, nodeId: approvedOutbound.nodeId, action: 'CREATE_CHILD', targetNodeKey: 'delivery', requestKey: 'wfl-action-request-0002' }, actor, 'wfl-create-delivery')
  let delivery = instance.nodes.find((node) => node.nodeKey === 'delivery')!
  instance = await wfl.executeNodeAction({ processId: instance.processId, nodeId: delivery.nodeId, action: 'REJECT_CHILD', expectedRevision: delivery.revision!, reason: '不符合条件' }, reviewer, 'wfl-reject-child')
  delivery = instance.nodes.find((node) => node.nodeKey === 'delivery')!
  instance = await wfl.executeNodeAction({ processId: instance.processId, nodeId: delivery.nodeId, action: 'RETRY_CHILD', expectedRevision: delivery.revision! }, reviewer, 'wfl-retry-child')
  delivery = instance.nodes.find((node) => node.nodeKey === 'delivery')!
  instance = await wfl.executeNodeAction({ processId: instance.processId, nodeId: delivery.nodeId, action: 'REJECT_CHILD', expectedRevision: delivery.revision!, reason: '取消前驳回' }, reviewer, 'wfl-reject-child-again')
  delivery = instance.nodes.find((node) => node.nodeKey === 'delivery')!
  await wfl.executeNodeAction({ processId: instance.processId, nodeId: delivery.nodeId, action: 'CANCEL_CHILD', expectedRevision: delivery.revision! }, reviewer, 'wfl-cancel-child')
  const actions = (await wfl.instanceAuditHistory(instance.processId, actor)).map((item) => item.action)
  assert.deepEqual(actions.filter((action) => ['OPEN_DOCUMENT', 'CREATE_CHILD', 'APPROVE_CHILD', 'REJECT_CHILD', 'RETRY_CHILD', 'CANCEL_CHILD'].includes(action)), ['OPEN_DOCUMENT', 'CREATE_CHILD', 'APPROVE_CHILD', 'CREATE_CHILD', 'REJECT_CHILD', 'RETRY_CHILD', 'REJECT_CHILD', 'CANCEL_CHILD'])
})
