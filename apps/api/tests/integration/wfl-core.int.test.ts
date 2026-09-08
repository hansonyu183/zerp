import { BobArchiveService } from '../../src/bob/archives.ts'
import {
  seedSaleOrderReferences,
  saleOrderPayload,
  withWflDatabase,
} from './wfl-fixture.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import { ulid } from 'ulid'

import { AuxService } from '../../src/aux/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { searchPinyin } from '../../src/platform/pinyin.ts'
import { VouApplicationError, VouService } from '../../src/vou/service.ts'
import { WflService, type WflVouPort } from '../../src/wfl/service.ts'

const sourceOrderLineId = '01J00000000000000000000005'
const script = `root = node(key="root", name="销售订单", entity="sale-order")\nchild = node(key="outbound", name="销售出库", entity="sale-outbound")\nworkflow(code="safe-flow", name="安全流程", root=root, edges=[edge(source=root, target=child, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"1"}]}))])`

function createWflAndVou(
  db: ReturnType<typeof createDatabase>,
  runtime: Awaited<ReturnType<typeof createNodeWflStarlark>>,
) {
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
      async partyBalance() {
        return 0n
      },
      async customerCreditOccupancy() {
        return 0n
      },
    },
    wfl,
  })
  return { wfl, vou }
}

test('WFL child creation rejects static attachment staging references', async () =>
  withWflDatabase(async (db) => {
    const runtime = await createNodeWflStarlark()
    const { vou } = createWflAndVou(db, runtime)

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
  }))

test('WFL definition compiles, trials against a real VOU, approves and becomes current', async () =>
  withWflDatabase(async (db) => {
    const runtime = await createNodeWflStarlark()
    const { vou, wfl } = createWflAndVou(db, runtime)
    const submitterId = ulid(),
      reviewerId = ulid()
    const submitter = {
      id: submitterId,
      permissions: [] as string[],
      trusted: true,
    }
    const reviewer = {
      id: reviewerId,
      permissions: [] as string[],
      trusted: true,
    }
    let refs: Awaited<ReturnType<typeof seedSaleOrderReferences>> | undefined
    await db
      .insertInto('app_users')
      .values(
        [submitterId, reviewerId].map((id) => ({
          id,
          username: `wfl-${id}`,
          display_name: 'WFL actor',
          py: searchPinyin('WFL actor'),
          password_hash: 'unused',
          status: 'ENABLED' as const,
          password_changed_at: new Date(),
          password_change_required: false,
        })),
      )
      .execute()
    refs = await seedSaleOrderReferences(
      new BobArchiveService(db),
      new AuxService(db),
      submitterId,
      reviewerId,
    )
    const documentId = ulid(),
      vouSubmissionId = ulid()
    await vou.submit(
      'sale-order',
      'submit-new',
      {
        documentId,
        submissionId: vouSubmissionId,
        idempotencyKey: vouSubmissionId,
        expectedRevision: null,
        payload: saleOrderPayload(refs),
      },
      submitter,
      'wfl-vou',
    )
    const subjectId = ulid(),
      submissionId = ulid()
    const pending = await wfl.submit(
      'submit-new',
      {
        subjectId,
        submissionId,
        idempotencyKey: submissionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      },
      submitter,
      'wfl-submit',
    )
    assert.equal(pending.status, 'PENDING')
    assert.equal(pending.compiledGraph.code, 'safe-flow')
    const approved = await wfl.review(
      'approve',
      {
        subjectId,
        submissionId,
        expectedRevision: pending.revision,
      },
      reviewer,
      'wfl-approve',
    )
    assert.equal(approved.status, 'APPROVED')
    const enabled = await wfl.setEnabled(
      {
        subjectId,
        approvalEntryId: submissionId,
        expectedApprovalRevision: approved.revision,
        expectedRuntimeRevision: null,
      },
      true,
      reviewer,
    )
    assert.equal(enabled.enabled, true)
    assert.equal(
      (await wfl.current('safe-flow', reviewer)).approvalEntryId,
      submissionId,
    )
    const approvedRoot = await vou.review(
      'sale-order',
      'approve',
      {
        documentId,
        submissionId: vouSubmissionId,
        expectedRevision: '1',
      },
      reviewer,
      'wfl-root-approve',
    )
    assert.equal(approvedRoot.status, 'APPROVED')
    const instance = await db
      .selectFrom('wfl_instances')
      .selectAll()
      .where('root_document_id', '=', documentId)
      .executeTakeFirstOrThrow()
    assert.equal(instance.approval_entry_id, submissionId)
    assert.equal(instance.definition_code, 'safe-flow')
    await assert.rejects(
      wfl.review(
        'unapprove',
        {
          subjectId,
          submissionId,
          expectedRevision: approved.revision,
          reason: '实例仍固定此版本',
        },
        reviewer,
        'wfl-definition-blocker',
      ),
      (error: unknown) =>
        error instanceof Error && error.message === 'wfl_definition_in_use',
    )
  }))

test('WFL definition lifecycle exposes candidates, history and a derived current fallback', async () =>
  withWflDatabase(async (db) => {
    const runtime = await createNodeWflStarlark()
    const { vou, wfl } = createWflAndVou(db, runtime)
    const actorId = ulid(),
      reviewerId = ulid()
    const actor = { id: actorId, permissions: [] as string[], trusted: true }
    const reviewer = {
      id: reviewerId,
      permissions: [] as string[],
      trusted: true,
    }
    let refs: Awaited<ReturnType<typeof seedSaleOrderReferences>> | undefined
    await db
      .insertInto('app_users')
      .values(
        [actorId, reviewerId].map((id) => ({
          id,
          username: `wfl-${id}`,
          display_name: 'WFL actor',
          py: searchPinyin('WFL actor'),
          password_hash: 'unused',
          status: 'ENABLED' as const,
          password_changed_at: new Date(),
          password_change_required: false,
        })),
      )
      .execute()
    refs = await seedSaleOrderReferences(
      new BobArchiveService(db),
      new AuxService(db),
      actorId,
      reviewerId,
    )
    const documentId = ulid(),
      vouSubmissionId = ulid()
    await vou.submit(
      'sale-order',
      'submit-new',
      {
        documentId,
        submissionId: vouSubmissionId,
        idempotencyKey: vouSubmissionId,
        expectedRevision: null,
        payload: saleOrderPayload(refs),
      },
      actor,
      'wfl-lifecycle-vou',
    )
    const subjectId = ulid(),
      v1 = ulid()
    const first = await wfl.submit(
      'submit-new',
      {
        subjectId,
        submissionId: v1,
        idempotencyKey: v1,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      },
      actor,
      'wfl-lifecycle-v1',
    )
    const approved = await wfl.review(
      'approve',
      { subjectId, submissionId: v1, expectedRevision: first.revision },
      reviewer,
      'wfl-lifecycle-approve',
    )
    await wfl.setEnabled(
      {
        subjectId,
        approvalEntryId: v1,
        expectedApprovalRevision: approved.revision,
        expectedRuntimeRevision: null,
      },
      true,
      reviewer,
    )
    const v2 = ulid()
    const candidate = await wfl.submit(
      'submit-change',
      {
        subjectId,
        submissionId: v2,
        idempotencyKey: v2,
        expectedLatestApprovedSubmissionId: v1,
        expectedLatestApprovedRevision: approved.revision,
        script: script.replace('安全流程', '安全流程 v2'),
        trialDocument: { entity: 'sale-order', documentId },
      },
      actor,
      'wfl-lifecycle-v2',
    )
    const listed = await wfl.query({}, actor)
    assert.equal(listed.total, 1)
    assert.equal(listed.items[0]!.latestApproved?.submissionId, v1)
    assert.equal(listed.items[0]!.openCandidate?.submissionId, v2)
    assert.equal((await wfl.get(subjectId, actor)).submissionId, v2)
    assert.deepEqual(
      (await wfl.versions(subjectId, actor)).map((item) => item.submissionId),
      [v2, v1],
    )
    assert.equal(
      (await wfl.auditHistory(subjectId, actor)).at(-1)?.action,
      'SUBMITTED',
    )
    await wfl.delete(
      { subjectId, submissionId: v2, expectedRevision: candidate.revision },
      actor,
      'wfl-lifecycle-delete',
    )
    assert.equal((await wfl.get(subjectId, actor)).submissionId, v1)
    assert.equal((await wfl.current('safe-flow', actor)).approvalEntryId, v1)
    assert.equal((await wfl.versions(subjectId, actor)).length, 1)
  }))

test('WFL instance persists exact-entry nodes and six typed actions through its required VOU port', async () =>
  withWflDatabase(async (db) => {
    const runtime = await createNodeWflStarlark()
    const actorId = ulid(),
      reviewerId = ulid()
    const actor = { id: actorId, permissions: [] as string[], trusted: true }
    const reviewer = {
      id: reviewerId,
      permissions: [] as string[],
      trusted: true,
    }
    const { wfl, vou } = createWflAndVou(db, runtime)
    let refs: Awaited<ReturnType<typeof seedSaleOrderReferences>> | undefined
    await db
      .insertInto('app_users')
      .values(
        [actorId, reviewerId].map((id) => ({
          id,
          username: `wfl-${id}`,
          display_name: 'WFL actor',
          py: searchPinyin('WFL actor'),
          password_hash: 'unused',
          status: 'ENABLED' as const,
          password_changed_at: new Date(),
          password_change_required: false,
        })),
      )
      .execute()
    refs = await seedSaleOrderReferences(
      new BobArchiveService(db),
      new AuxService(db),
      actorId,
      reviewerId,
    )
    const rootDocumentId = ulid(),
      rootSubmissionId = ulid()
    await vou.submit(
      'sale-order',
      'submit-new',
      {
        documentId: rootDocumentId,
        submissionId: rootSubmissionId,
        idempotencyKey: rootSubmissionId,
        expectedRevision: null,
        payload: saleOrderPayload(refs),
      },
      actor,
      'wfl-actions-root',
    )
    const actionScript = `root = node(key="root", name="销售订单", entity="sale-order")\noutbound = node(key="outbound", name="销售出库", entity="sale-outbound")\ndelivery = node(key="delivery", name="销售送货", entity="sale-delivery")\nworkflow(code="action-flow", name="动作流程", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"1"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"1"}]}))])`
    const subjectId = ulid(),
      definitionEntryId = ulid()
    const pending = await wfl.submit(
      'submit-new',
      {
        subjectId,
        submissionId: definitionEntryId,
        idempotencyKey: definitionEntryId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script: actionScript,
        trialDocument: { entity: 'sale-order', documentId: rootDocumentId },
      },
      actor,
      'wfl-actions-definition',
    )
    const definition = await wfl.review(
      'approve',
      {
        subjectId,
        submissionId: definitionEntryId,
        expectedRevision: pending.revision,
      },
      reviewer,
      'wfl-actions-definition-approve',
    )
    await wfl.setEnabled(
      {
        subjectId,
        approvalEntryId: definitionEntryId,
        expectedApprovalRevision: definition.revision,
        expectedRuntimeRevision: null,
      },
      true,
      reviewer,
    )
    await vou.review(
      'sale-order',
      'approve',
      {
        documentId: rootDocumentId,
        submissionId: rootSubmissionId,
        expectedRevision: '1',
      },
      reviewer,
      'wfl-actions-root-approve',
    )
    let instance = (await wfl.queryInstances({}, actor)).items[0]
    assert.equal(instance.approvalEntryId, definitionEntryId)
    const root = instance.nodes.find((node) => node.nodeKey === 'root')!
    await wfl.executeNodeAction(
      {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'OPEN_DOCUMENT',
      },
      reviewer,
      'wfl-open',
    )
    instance = await wfl.executeNodeAction(
      {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'outbound',
        requestKey: 'wfl-action-request-0001',
      },
      actor,
      'wfl-create-outbound',
    )
    const afterRetry = await wfl.executeNodeAction(
      {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'outbound',
        requestKey: 'wfl-action-request-0001',
      },
      actor,
      'wfl-create-outbound-retry',
    )
    assert.equal(
      afterRetry.nodes.filter((node) => node.nodeKey === 'outbound').length,
      1,
    )
    const outbound = afterRetry.nodes.find(
      (node) => node.nodeKey === 'outbound',
    )!
    instance = await wfl.executeNodeAction(
      {
        processId: instance.processId,
        nodeId: outbound.nodeId,
        action: 'APPROVE_CHILD',
        expectedRevision: outbound.revision!,
      },
      reviewer,
      'wfl-approve-child',
    )
    const approvedOutbound = instance.nodes.find(
      (node) => node.nodeKey === 'outbound',
    )!
    instance = await wfl.executeNodeAction(
      {
        processId: instance.processId,
        nodeId: approvedOutbound.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'delivery',
        requestKey: 'wfl-action-request-0002',
      },
      actor,
      'wfl-create-delivery',
    )
    let delivery = instance.nodes.find((node) => node.nodeKey === 'delivery')!
    instance = await wfl.executeNodeAction(
      {
        processId: instance.processId,
        nodeId: delivery.nodeId,
        action: 'REJECT_CHILD',
        expectedRevision: delivery.revision!,
        reason: '不符合条件',
      },
      reviewer,
      'wfl-reject-child',
    )
    delivery = instance.nodes.find((node) => node.nodeKey === 'delivery')!
    instance = await wfl.executeNodeAction(
      {
        processId: instance.processId,
        nodeId: delivery.nodeId,
        action: 'RETRY_CHILD',
        expectedRevision: delivery.revision!,
      },
      reviewer,
      'wfl-retry-child',
    )
    delivery = instance.nodes.find((node) => node.nodeKey === 'delivery')!
    instance = await wfl.executeNodeAction(
      {
        processId: instance.processId,
        nodeId: delivery.nodeId,
        action: 'REJECT_CHILD',
        expectedRevision: delivery.revision!,
        reason: '取消前驳回',
      },
      reviewer,
      'wfl-reject-child-again',
    )
    delivery = instance.nodes.find((node) => node.nodeKey === 'delivery')!
    await wfl.executeNodeAction(
      {
        processId: instance.processId,
        nodeId: delivery.nodeId,
        action: 'CANCEL_CHILD',
        expectedRevision: delivery.revision!,
      },
      reviewer,
      'wfl-cancel-child',
    )
    const actions = (
      await wfl.instanceAuditHistory(instance.processId, actor)
    ).map((item) => item.action)
    assert.deepEqual(
      actions.filter((action) =>
        [
          'OPEN_DOCUMENT',
          'CREATE_CHILD',
          'APPROVE_CHILD',
          'REJECT_CHILD',
          'RETRY_CHILD',
          'CANCEL_CHILD',
        ].includes(action),
      ),
      [
        'OPEN_DOCUMENT',
        'CREATE_CHILD',
        'APPROVE_CHILD',
        'CREATE_CHILD',
        'REJECT_CHILD',
        'RETRY_CHILD',
        'REJECT_CHILD',
        'CANCEL_CHILD',
      ],
    )
  }))
