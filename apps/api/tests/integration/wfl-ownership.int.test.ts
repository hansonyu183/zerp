import assert from 'node:assert/strict'
import test from 'node:test'
import { sql, type Kysely } from 'kysely'
import { ulid } from 'ulid'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import { createDatabase } from '../../src/db/database.ts'
import type { DB } from '../../src/db/generated.ts'
import { BobArchiveService } from '../../src/bob/archives.ts'
import { AuxService } from '../../src/aux/service.ts'
import { VouService } from '../../src/vou/service.ts'
import { WflService, type WflVouPort } from '../../src/wfl/service.ts'
import {
  seedSaleOrderReferences,
  saleOrderPayload,
  sourceOrderLineId,
} from './wfl-fixture.ts'

const script = (
  name: string,
  quantity: string,
) => `root = node(key="root", name="订单", entity="sale-order")
child = node(key="child", name="出库", entity="sale-outbound")
workflow(code="ownership-flow", name="${name}", root=root, edges=[edge(source=root,target=child,relation="outbound",action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"${quantity}"}]}))])`

test('WFL independently composes shared lifecycle, pins old instances and rolls back all test facts', async () => {
  assert.ok(process.env.TARGET_TEST_DATABASE_URL)
  const db = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const runtime = await createNodeWflStarlark()
  const rollback = new Error('rollback fixture')
  try {
    await assert.rejects(
      db.transaction().execute(async (tx) => {
        // Domain services use one test-owned outer transaction; no shared rows are committed.
        const scoped = new Proxy(tx, {
          get(target, key) {
            if (key === 'transaction')
              return () => ({
                execute: (fn: (value: typeof tx) => unknown) => fn(tx),
              })
            const value = Reflect.get(target, key, target)
            return typeof value === 'function' ? value.bind(target) : value
          },
        }) as unknown as Kysely<DB>
        const owner = { id: ulid(), permissions: [], trusted: true },
          reviewer = { ...owner, id: ulid() }
        for (const actor of [owner, reviewer])
          await tx
            .insertInto('app_users')
            .values({
              id: actor.id,
              username: `wfl-401-${actor.id}`,
              display_name: '流程测试',
              py: 'lccs',
              password_hash: 'unused',
              status: 'ENABLED',
              password_changed_at: new Date(),
              password_change_required: false,
            })
            .execute()
        const refs = await seedSaleOrderReferences(
          new BobArchiveService(scoped),
          new AuxService(scoped),
          owner.id,
          reviewer.id,
        )
        let vou: VouService
        const port: WflVouPort = {
          createChild: (...args) => vou.createChild(...args),
          approveChild: (...args) => vou.approveChild(...args),
          rejectChild: (...args) => vou.rejectChild(...args),
          retryChild: (...args) => vou.retryChild(...args),
          cancelChild: (...args) => vou.cancelChild(...args),
        }
        const wfl = new WflService(scoped, runtime, port)
        vou = new VouService(scoped, {
          wfl,
          acc: {
            async apply() {},
            async partyBalance() {
              return 0n
            },
            async customerCreditOccupancy() {
              return 0n
            },
          },
        })
        const rootId = ulid(),
          rootEntry = ulid(),
          subjectId = ulid(),
          v1 = ulid()
        await vou.submit(
          'sale-order',
          'submit-new',
          {
            documentId: rootId,
            submissionId: rootEntry,
            idempotencyKey: rootEntry,
            expectedRevision: null,
            payload: saleOrderPayload(refs),
          },
          owner,
          'root',
        )
        const command = {
          subjectId,
          submissionId: v1,
          idempotencyKey: v1,
          expectedLatestApprovedSubmissionId: null,
          expectedLatestApprovedRevision: null,
          script: script('初版', '1'),
          trialDocument: { entity: 'sale-order' as const, documentId: rootId },
        }
        const pending = await wfl.submit('submit-new', command, owner, 'submit')
        assert.deepEqual(
          await wfl.submit('submit-new', command, owner, 'retry'),
          pending,
        )
        await assert.rejects(
          wfl.submit(
            'submit-new',
            { ...command, script: script('冲突', '1') },
            owner,
            'conflict',
          ),
          { message: 'archive_idempotency_conflict' },
        )
        assert.equal(
          (await wfl.query({}, owner)).items.find(
            (row) => row.subjectId === subjectId,
          )?.openCandidate?.submissionId,
          v1,
        )
        await sql`SAVEPOINT approval_audit_failure`.execute(tx)
        await sql`ALTER TABLE approval_events RENAME TO _401_failed_approval_events`.execute(
          tx,
        )
        await assert.rejects(
          wfl.review(
            'approve',
            { subjectId, submissionId: v1, expectedRevision: '1' },
            reviewer,
            'audit-fails',
          ),
        )
        await sql`ROLLBACK TO SAVEPOINT approval_audit_failure`.execute(tx)
        assert.equal((await wfl.get(subjectId, owner, v1)).status, 'PENDING')
        assert.equal((await wfl.get(subjectId, owner, v1)).revision, '1')
        const approved = await wfl.review(
          'approve',
          { subjectId, submissionId: v1, expectedRevision: '1' },
          reviewer,
          'approve',
        )
        assert.equal(approved.status, 'APPROVED')
        assert.equal(
          (await wfl.queryCurrentDefinitions({}, owner)).items.find(
            (row) => row.subjectId === subjectId,
          )?.enabled,
          false,
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
        await vou.review(
          'sale-order',
          'approve',
          {
            documentId: rootId,
            submissionId: rootEntry,
            expectedRevision: '1',
          },
          reviewer,
          'root-approve',
        )
        let instance = (
          await wfl.queryInstances({ code: 'ownership-flow' }, owner)
        ).items[0]!
        assert.equal(instance.approvalEntryId, v1)
        const v2 = ulid()
        await wfl.submit(
          'submit-change',
          {
            ...command,
            submissionId: v2,
            idempotencyKey: v2,
            expectedLatestApprovedSubmissionId: v1,
            expectedLatestApprovedRevision: approved.revision,
            script: script('新版', '0.5'),
          },
          owner,
          'v2',
        )
        const approved2 = await wfl.review(
          'approve',
          { subjectId, submissionId: v2, expectedRevision: '1' },
          reviewer,
          'approve-v2',
        )
        assert.equal(
          (await wfl.current('ownership-flow', owner)).approvalEntryId,
          v2,
        )
        const nextRootId = ulid(),
          nextRootEntry = ulid()
        const nextPayload = saleOrderPayload(refs)
        if ('productLines' in nextPayload)
          nextPayload.productLines[0]!.lineId = ulid()
        await vou.submit(
          'sale-order',
          'submit-new',
          {
            documentId: nextRootId,
            submissionId: nextRootEntry,
            idempotencyKey: nextRootEntry,
            expectedRevision: null,
            payload: nextPayload,
          },
          owner,
          'next-root',
        )
        await vou.review(
          'sale-order',
          'approve',
          {
            documentId: nextRootId,
            submissionId: nextRootEntry,
            expectedRevision: '1',
          },
          reviewer,
          'next-root-approve',
        )
        const nextInstance = (
          await wfl.queryInstances({ code: 'ownership-flow' }, owner)
        ).items.find((row) => row.rootDocumentId === nextRootId)
        assert.equal(nextInstance?.approvalEntryId, v2)
        await assert.rejects(
          wfl.review(
            'unapprove',
            {
              subjectId,
              submissionId: v2,
              expectedRevision: approved2.revision,
              reason: '已有实例',
            },
            reviewer,
            'blocked-v2',
          ),
          { message: 'wfl_definition_in_use' },
        )
        await wfl.setEnabled(
          {
            subjectId,
            approvalEntryId: v2,
            expectedApprovalRevision: approved2.revision,
            expectedRuntimeRevision: '1',
          },
          false,
          reviewer,
        )
        instance = await wfl.getInstance(instance.processId, owner)
        assert.equal(instance.definitionName, '初版')
        assert.equal(instance.approvalEntryId, v1)
        assert.equal(
          (
            instance.availableTargets[0]!.initial as {
              sourceLines: Array<{ baseQuantity: string }>
            }
          ).sourceLines[0]!.baseQuantity,
          '1',
        )
        await vou.review(
          'sale-order',
          'unapprove',
          {
            documentId: rootId,
            submissionId: rootEntry,
            expectedRevision: '2',
            reason: '重新批准',
          },
          reviewer,
          'root-unapprove',
        )
        const otherSubject = ulid(),
          otherEntry = ulid()
        await wfl.submit(
          'submit-new',
          {
            ...command,
            subjectId: otherSubject,
            submissionId: otherEntry,
            idempotencyKey: otherEntry,
            script: script('另一流程', '1').replace(
              'ownership-flow',
              'another-flow',
            ),
          },
          owner,
          'other',
        )
        await wfl.review(
          'approve',
          {
            subjectId: otherSubject,
            submissionId: otherEntry,
            expectedRevision: '1',
          },
          reviewer,
          'other-approve',
        )
        await wfl.setEnabled(
          {
            subjectId: otherSubject,
            approvalEntryId: otherEntry,
            expectedApprovalRevision: '2',
            expectedRuntimeRevision: null,
          },
          true,
          reviewer,
        )
        await vou.review(
          'sale-order',
          'approve',
          {
            documentId: rootId,
            submissionId: rootEntry,
            expectedRevision: '3',
          },
          reviewer,
          'root-reapprove',
        )
        assert.equal(
          (await wfl.queryInstances({}, owner)).items.filter(
            (row) => row.rootDocumentId === rootId,
          ).length,
          1,
        )
        const action = {
          processId: instance.processId,
          nodeId: instance.nodes[0]!.nodeId,
          action: 'CREATE_CHILD' as const,
          targetNodeKey: 'child',
          requestKey: ulid(),
        }
        const created = await wfl.executeNodeAction(action, owner, 'create')
        assert.equal(created.nodes.length, 2)
        assert.deepEqual(
          await wfl.executeNodeAction(action, owner, 'retry-create'),
          created,
        )
        await assert.rejects(
          wfl.review(
            'unapprove',
            {
              subjectId,
              submissionId: v1,
              expectedRevision: approved.revision,
              reason: '历史',
            },
            reviewer,
            'old',
          ),
          { message: 'approval_not_latest_approved' },
        )
        await assert.rejects(
          wfl.submit(
            'submit-change',
            { ...command, submissionId: ulid(), idempotencyKey: ulid() },
            owner,
            'stale',
          ),
          { message: 'archive_stale_facts' },
        )
        assert.equal((await wfl.versions(subjectId, owner)).length, 2)
        assert.equal((await wfl.auditHistory(subjectId, owner)).length, 4)
        throw rollback
      }),
      (error) => error === rollback,
    )
  } finally {
    await db.destroy()
  }
})
