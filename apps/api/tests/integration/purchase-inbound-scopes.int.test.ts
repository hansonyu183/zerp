import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import { VouService } from '../../src/vou/service.ts'
import { WflService } from '../../src/wfl/service.ts'
import { AttachmentStore } from '../../src/platform/attachment-store.ts'
import {
  inspectPurchaseInboundScopeUpgrade,
  upgradePurchaseInboundScopes,
} from '../../src/app/purchase-inbound-scope-upgrade.ts'
import type { PurchaseInboundScope, VouPayloadFor } from '@zerp/model'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import {
  purchaseClients,
  withCommittedPurchaseDatabase,
} from '../fixtures/vou-purchase-http.ts'
import { seedStockFixture } from '../fixtures/vou-stock.ts'

const path = (action: string) => `/vou/purchase-inbound/${action}`
const actions = [
  'query',
  'get',
  'submit-new',
  'submit-change',
  'approve',
  'reject',
  'unreject',
  'unapprove',
  'delete',
  'audit-history',
  'attachment-read',
  'attachment-stage',
]

test('real HTTP enforces receipt shape separately for every action, delegation and existing sessions', async (context) => {
  await withCommittedPurchaseDatabase(async (db) => {
    const fixture = await seedStockFixture(
      db,
      '2026-09',
      { quantity: '60', amount: '120.00' },
      false,
    )
    const bootstrap = new TargetBootstrapService(db)
    const permissions = await db
      .selectFrom('app_permissions')
      .select(['id', 'path'])
      .where('status', '=', 'ENABLED')
      .execute()
    const permissionId = new Map(
      permissions.map((permission) => [permission.path, permission.id]),
    )
    const manager = {
      userId: ulid(),
      roleId: ulid(),
      username: `scope-manager-${ulid()}`,
      password: 'Scope!Manager123',
      passwordHash: await hashPassword('Scope!Manager123'),
    }
    await bootstrap.createE2EPrincipal(
      manager,
      false,
      permissions.map((permission) => permission.path),
    )
    const attachmentRoot = new URL(
      `../../../../.scratch/receipt-scopes-${ulid()}/`,
      import.meta.url,
    ).pathname
    context.after(() => rm(attachmentRoot, { recursive: true, force: true }))
    let readGate:
      | { documentId: string; reached: () => void; release: Promise<void> }
      | undefined
    function gatedBuilder(builder: object): object {
      return new Proxy(builder, {
        get(target, key) {
          const value = Reflect.get(target, key, target)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            const gate = readGate
            if (
              key === 'executeTakeFirst' &&
              gate &&
              Reflect.get(target, 'compile')
                .call(target)
                .parameters.includes(gate.documentId)
            ) {
              readGate = undefined
              gate.reached()
              return gate.release.then(() => Reflect.apply(value, target, args))
            }
            const result = Reflect.apply(value, target, args)
            return result &&
              typeof result === 'object' &&
              'compile' in result &&
              'executeTakeFirst' in result
              ? gatedBuilder(result)
              : result
          }
        },
      })
    }
    const readDb = new Proxy(db, {
      get(target, key) {
        const value = Reflect.get(target, key, target)
        if (key === 'selectFrom')
          return (...args: unknown[]) =>
            args[0] === 'vou_documents as d'
              ? gatedBuilder(Reflect.apply(value, target, args))
              : Reflect.apply(value, target, args)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    let vou: VouService
    let childFailure: unknown
    const wfl = new WflService(db, await createNodeWflStarlark(), {
      createChild: async (...args) => {
        try {
          return await vou.createChild(...args)
        } catch (error) {
          childFailure = error
          throw error
        }
      },
      approveChild: (...args) => vou.approveChild(...args),
      rejectChild: (...args) => vou.rejectChild(...args),
      retryChild: (...args) => vou.retryChild(...args),
      cancelChild: (...args) => vou.cancelChild(...args),
    })
    vou = new VouService(
      readDb,
      { acc: fixture.acc, wfl },
      { attachmentStore: new AttachmentStore(attachmentRoot) },
    )
    const { client, post, review, download } = await purchaseClients(
      db,
      fixture,
      context,
      { vou, wfl },
    )
    const manage = await client(manager)
    async function role(
      name: string,
      scopes: Record<string, PurchaseInboundScope>,
      extraPaths: string[] = [],
    ) {
      const selectedPaths = [
        ...Object.keys(scopes).map((key) =>
          key.startsWith('/') ? key : path(key),
        ),
        ...extraPaths,
      ]
      for (const selected of selectedPaths)
        assert.ok(
          permissionId.has(selected),
          `missing fixture permission ${selected}`,
        )
      const result = await manage('/app/role/create', {
        name: name + ulid(),
        description: null,
        permissionIds: selectedPaths.map((value) => permissionId.get(value)!),
        purchaseInboundScopes: Object.fromEntries(
          Object.entries(scopes).map(([action, scope]) => [
            permissionId.get(action.startsWith('/') ? action : path(action))!,
            scope,
          ]),
        ),
      })
      assert.equal(result.code, 0, JSON.stringify(result))
      return result.data
    }
    const all = {
      ...Object.fromEntries(actions.map((action) => [action, 'ALL' as const])),
      '/wfl/process-instance/create-purchase-inbound': 'ALL' as const,
    }
    const independent = {
      ...Object.fromEntries(
        actions.map((action) => [action, 'INDEPENDENT_PRIOR' as const]),
      ),
      '/wfl/process-instance/create-purchase-inbound':
        'INDEPENDENT_PRIOR' as const,
    }
    const ordered = {
      ...Object.fromEntries(
        actions.map((action) => [action, 'ORDER_REFERENCE' as const]),
      ),
      '/wfl/process-instance/create-purchase-inbound':
        'ORDER_REFERENCE' as const,
    }
    const wflPaths = [
      'get',
      'query',
      'open-document',
      'approve-child',
      'reject-child',
      'retry-child',
      'cancel-child',
    ].map((action) => `/wfl/process-instance/${action}`)
    const extra = [
      ...wflPaths,
      '/app/role/create',
      '/app/role/get',
      '/app/role/save',
      '/app/role/enable',
      '/app/role/disable',
      '/app/user/get',
      '/app/user/save',
      '/app/user/create',
      '/app/user/reset-password',
    ]
    const ahRole = await role('AH-only', independent, extra)
    const abRole = await role('AB-only', ordered, wflPaths)
    const mixedRole = await role(
      'Both-query-AH-approve',
      { ...all, approve: 'INDEPENDENT_PRIOR', reject: 'INDEPENDENT_PRIOR' },
      wflPaths,
    )
    async function user(roleIds: string[]) {
      const username = `scope-user-${ulid()}`,
        password = 'Scope!User12345'
      const result = await manage('/app/user/create', {
        code: username,
        name: username,
        password,
        roleIds,
      })
      assert.equal(result.code, 0, JSON.stringify(result))
      return {
        id: result.data.id,
        username,
        password,
        call: await client({ username, password }),
      }
    }
    const ah = await user([ahRole.id]),
      ab = await user([abRole.id]),
      mixed = await user([mixedRole.id]),
      union = await user([ahRole.id, abRole.id])
    const approvedOrder = await review('/vou/purchase-order/approve', {
      documentId: fixture.purchase.documentId,
      submissionId: fixture.purchase.submissionId,
      expectedRevision: fixture.purchase.revision,
    })
    assert.equal(approvedOrder.code, 0)
    const original = fixture.purchase.payload as VouPayloadFor<'purchase-order'>
    const payloadAH = {
      businessDate: '2026-09-11',
      currency: 'CNY',
      attachments: [],
      supplier: original.supplier,
      warehouse: original.warehouse,
      priorFact: {
        sourceClosed: false,
        sourceInstanceId: 'scope-fixture',
        sourceSchema: 'fixture',
        sourceDocumentType: 'AH',
        sourceDocumentKey: 'real-AH-scope',
        sourceDocumentNo: 'AH-008',
        capturedAt: '2026-09-20T23:59:59.123456Z',
        snapshotDigest: 'a'.repeat(64),
      },
      productLines: [
        {
          ...original.productLines[0]!,
          enteredQuantity: '10',
          baseQuantity: '10',
          unitPrice: '7.50',
          agreedAmount: '75.00',
        },
      ],
      priorLineOrigins: [
        {
          lineId: original.productLines[0]!.lineId,
          sourceDocumentType: 'BB',
          sourceDocumentKey: 'scope-BB',
          sourceLineKey: '1',
        },
      ],
    }
    const payloadAB = {
      businessDate: '2026-09-11',
      currency: 'CNY',
      attachments: [],
      supplier: original.supplier,
      warehouse: original.warehouse,
      parentEntity: 'purchase-order',
      parentDocumentId: fixture.purchase.documentId,
      sourceLines: [
        { sourceLineId: original.productLines[0]!.lineId, baseQuantity: '1' },
      ],
    }
    const input = (payload: unknown) => {
      const submissionId = ulid()
      return {
        documentId: ulid(),
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null as string | null,
        payload,
      }
    }
    // Rejection precedes business writes and even replay of another authorized request.
    const content = Buffer.from('%PDF-1.4\nreceipt scope fixture\n%%EOF')
    const attachment = {
      id: ulid(),
      fileName: 'receipt-scope.pdf',
      contentType: 'application/pdf',
      sizeBytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      stagingId: ulid(),
    }
    const staged = await ah.call(path('attachment-stage'), {
      stagingId: attachment.stagingId,
      fileId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.contentType,
      size: attachment.sizeBytes,
      digest: attachment.sha256,
      contentBase64: content.toString('base64'),
    })
    assert.equal(staged.code, 0)
    const attachedAH = { ...payloadAH, attachments: [attachment] }
    const deniedAB = input(payloadAB),
      deniedAH = input(payloadAH)
    assert.equal(
      (await ah.call(path('submit-new'), deniedAB)).errorKey,
      'forbidden',
    )
    assert.equal(
      (await ab.call(path('submit-new'), deniedAH)).errorKey,
      'forbidden',
    )
    const receiptAH = await ah.call(path('submit-new'), input(attachedAH)),
      receiptAB = await ab.call(path('submit-new'), input(payloadAB))
    assert.equal(receiptAH.code, 0, JSON.stringify(receiptAH))
    assert.equal(receiptAB.code, 0, JSON.stringify(receiptAB))
    const viewAH = receiptAH.data,
      viewAB = receiptAB.data
    assert.equal(
      (
        await ab.call(path('attachment-read'), {
          documentId: viewAH.documentId,
          submissionId: viewAH.submissionId,
          fileId: attachment.id,
        })
      ).errorKey,
      'forbidden',
    )
    const issued = await mixed.call(path('attachment-read'), {
      documentId: viewAH.documentId,
      submissionId: viewAH.submissionId,
      fileId: attachment.id,
    })
    assert.equal(issued.code, 0)
    const beforeToken = await mixed.call(path('attachment-read'), {
      documentId: viewAH.documentId,
      submissionId: viewAH.submissionId,
      fileId: attachment.id,
    })
    assert.equal(beforeToken.code, 0)
    const downloaded = await download(beforeToken.data.downloadUrl)
    assert.equal(downloaded.status, 200)
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), content)

    for (const [actor, own, denied] of [
      [ah, viewAH, viewAB],
      [ab, viewAB, viewAH],
    ] as const) {
      const queried = await actor.call(path('query'), { page: 1, pageSize: 20 })
      assert.equal(queried.code, 0)
      assert.equal(queried.data.total, 1)
      assert.deepEqual(
        queried.data.items.map(
          (item: { documentId: string }) => item.documentId,
        ),
        [own.documentId],
      )
      assert.equal(
        (await actor.call(path('get'), { documentId: own.documentId })).code,
        0,
      )
      assert.equal(
        (await actor.call(path('get'), { documentId: denied.documentId }))
          .errorKey,
        'forbidden',
      )
      assert.equal(
        (
          await actor.call(path('audit-history'), {
            documentId: denied.documentId,
          })
        ).errorKey,
        'forbidden',
      )
      const change = input(actor === ah ? payloadAH : payloadAB)
      change.documentId = denied.documentId
      change.expectedRevision = denied.revision
      assert.equal(
        (await actor.call(path('submit-change'), change)).errorKey,
        'forbidden',
        'new allowed shape cannot overwrite forbidden old shape',
      )
      assert.equal(
        (
          await actor.call(path('delete'), {
            documentId: denied.documentId,
            submissionId: denied.submissionId,
            expectedRevision: denied.revision,
          })
        ).errorKey,
        'forbidden',
      )
      const queue = await actor.call('/app/workbench/query', {
        page: 1,
        pageSize: 20,
        filters: { entity: 'purchase-inbound' },
      })
      assert.equal(queue.code, 0)
      assert.equal(queue.data.total, 1)
      assert.equal(queue.data.items[0].subjectOrDocumentId, own.documentId)
    }
    assert.equal(
      (await mixed.call(path('query'), { page: 1, pageSize: 20 })).data.total,
      2,
    )
    assert.equal(
      (await union.call(path('query'), { page: 1, pageSize: 20 })).data.total,
      2,
    )
    const noQueryRole = await role('AH-get-no-query', {
      get: 'INDEPENDENT_PRIOR',
    })
    const noQuery = await user([noQueryRole.id])
    assert.equal(
      (await noQuery.call(path('query'), { page: 1, pageSize: 20 })).errorKey,
      'approval_invalid_action',
    )
    const auxiliaryOptions = await noQuery.call(
      '/vou/purchase-inbound/options?page=1&pageSize=20',
      null,
      'GET',
    )
    assert.equal(auxiliaryOptions.code, 0)
    assert.equal(auxiliaryOptions.data.total, 2)
    const restoredUnion = await union.call('/session/auth/restore', {})
    assert.equal(
      restoredUnion.data.purchaseInboundScopes[path('approve')],
      'ALL',
    )
    const queue = await mixed.call('/app/workbench/query', {
      page: 1,
      pageSize: 20,
      filters: { entity: 'purchase-inbound' },
    })
    assert.equal(queue.code, 0)
    const actionMap = new Map(
      queue.data.items.map(
        (item: { subjectOrDocumentId: string; availableActions: string[] }) => [
          item.subjectOrDocumentId,
          item.availableActions,
        ],
      ),
    )
    assert.ok(
      (actionMap.get(viewAH.documentId) as string[]).includes('approve'),
    )
    assert.ok(
      !(actionMap.get(viewAB.documentId) as string[]).includes('approve'),
    )
    assert.ok(
      (
        await mixed.call(path('get'), { documentId: viewAH.documentId })
      ).data.availableApprovalActions.includes('approve'),
    )
    assert.ok(
      !(
        await mixed.call(path('get'), { documentId: viewAB.documentId })
      ).data.availableApprovalActions.includes('approve'),
    )
    for (const action of ['approve', 'reject', 'unreject', 'unapprove']) {
      assert.equal(
        (
          await ah.call(path(action), {
            documentId: viewAB.documentId,
            submissionId: viewAB.submissionId,
            expectedRevision: viewAB.revision,
            ...(['reject', 'unapprove'].includes(action)
              ? { reason: 'fixture' }
              : {}),
          })
        ).errorKey,
        'forbidden',
      )
      assert.equal(
        (
          await ab.call(path(action), {
            documentId: viewAH.documentId,
            submissionId: viewAH.submissionId,
            expectedRevision: viewAH.revision,
            ...(['reject', 'unapprove'].includes(action)
              ? { reason: 'fixture' }
              : {}),
          })
        ).errorKey,
        'forbidden',
      )
    }
    assert.equal(
      (
        await mixed.call(path('approve'), {
          documentId: viewAB.documentId,
          submissionId: viewAB.submissionId,
          expectedRevision: viewAB.revision,
        })
      ).errorKey,
      'forbidden',
    )
    const approvedAH = await mixed.call(path('approve'), {
      documentId: viewAH.documentId,
      submissionId: viewAH.submissionId,
      expectedRevision: viewAH.revision,
    })
    assert.equal(approvedAH.code, 0, JSON.stringify(approvedAH))
    // A real compiled workflow keeps its separate create action and the same receipt range.
    const managerReviewer = {
      ...manager,
      userId: ulid(),
      roleId: ulid(),
      username: `scope-reviewer-${ulid()}`,
    }
    await bootstrap.createE2EPrincipal(
      managerReviewer,
      false,
      permissions.map((permission) => permission.path),
    )
    const manageReview = await client(managerReviewer)
    const rootInput = input({
      ...original,
      productLines: original.productLines.map((line) => ({
        ...line,
        lineId: ulid(),
      })),
    })
    const rootOrder = await manage('/vou/purchase-order/submit-new', rootInput)
    assert.equal(rootOrder.code, 0, JSON.stringify(rootOrder))
    const rootLine = rootOrder.data.payload.productLines[0].lineId
    const definitionId = ulid(),
      definitionEntry = ulid()
    const script = `root = node(key="root",name="订单",entity="purchase-order")
child = node(key="child",name="收货",entity="purchase-inbound")
workflow(code="receipt-scope-flow",name="收货范围夹具",root=root,edges=[edge(source=root,target=child,relation="receipt",action=purchase_inbound(initial={"businessDate":"2026-09-11","currency":"CNY","attachments":[],"supplier":{"objectId":"${original.supplier.objectId}","approvalEntryId":"${original.supplier.approvalEntryId}","selectionOrigin":"CURRENT"},"warehouse":{"objectId":"${original.warehouse.objectId}"},"sourceLines":[{"sourceLineId":"${rootLine}","baseQuantity":"0.5"}]}))])`
    const definition = await manage('/wfl/process-definition/submit-new', {
      subjectId: definitionId,
      submissionId: definitionEntry,
      idempotencyKey: definitionEntry,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      script,
      trialDocument: {
        entity: 'purchase-order',
        documentId: rootOrder.data.documentId,
      },
    })
    assert.equal(definition.code, 0, JSON.stringify(definition))
    const definitionApproved = await manageReview(
      '/wfl/process-definition/approve',
      {
        subjectId: definitionId,
        submissionId: definitionEntry,
        expectedRevision: definition.data.revision,
      },
    )
    assert.equal(definitionApproved.code, 0, JSON.stringify(definitionApproved))
    assert.equal(
      (
        await manage('/wfl/process-definition/enable', {
          subjectId: definitionId,
          approvalEntryId: definitionEntry,
          expectedApprovalRevision: definitionApproved.data.revision,
          expectedRuntimeRevision: null,
        })
      ).code,
      0,
    )
    assert.equal(
      (
        await manageReview('/vou/purchase-order/approve', {
          documentId: rootOrder.data.documentId,
          submissionId: rootOrder.data.submissionId,
          expectedRevision: rootOrder.data.revision,
        })
      ).code,
      0,
    )
    const instances = await ab.call('/wfl/process-instance/query', {
      code: 'receipt-scope-flow',
    })
    assert.equal(instances.code, 0)
    const instance = instances.data.items.find(
      (item: { rootDocumentId: string }) =>
        item.rootDocumentId === rootOrder.data.documentId,
    )
    assert.ok(instance)
    const rootNode = instance.nodes.find(
      (node: { nodeKey: string }) => node.nodeKey === 'root',
    )
    const ahInstance = await ah.call('/wfl/process-instance/get', {
      processId: instance.processId,
    })
    assert.equal(ahInstance.code, 0)
    assert.deepEqual(ahInstance.data.availableTargets, [])
    const createChild = {
      processId: instance.processId,
      nodeId: rootNode.nodeId,
      action: 'CREATE_CHILD',
      targetNodeKey: 'child',
      requestKey: ulid(),
    }
    assert.equal(
      (await ah.call('/wfl/process-instance/action', createChild)).errorKey,
      'forbidden',
    )
    const childCreated = await ab.call(
      '/wfl/process-instance/action',
      createChild,
    )
    assert.equal(
      childCreated.code,
      0,
      childFailure instanceof Error
        ? (childFailure.stack ?? childFailure.message)
        : JSON.stringify(childCreated),
    )
    const childNode = childCreated.data.nodes.find(
      (node: { nodeKey: string }) => node.nodeKey === 'child',
    )
    const ahChild = (
      await ah.call('/wfl/process-instance/get', {
        processId: instance.processId,
      })
    ).data.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'child')
    assert.deepEqual(ahChild.availableActions, [])
    const mixedChild = (
      await mixed.call('/wfl/process-instance/get', {
        processId: instance.processId,
      })
    ).data.nodes.find((node: { nodeKey: string }) => node.nodeKey === 'child')
    assert.ok(mixedChild.availableActions.includes('OPEN_DOCUMENT'))
    assert.ok(!mixedChild.availableActions.includes('APPROVE_CHILD'))
    for (const action of [
      'OPEN_DOCUMENT',
      'APPROVE_CHILD',
      'REJECT_CHILD',
      'CANCEL_CHILD',
    ]) {
      assert.equal(
        (
          await ah.call('/wfl/process-instance/action', {
            processId: instance.processId,
            nodeId: childNode.nodeId,
            action,
            expectedRevision: childNode.revision,
            reason: 'fixture',
          })
        ).errorKey,
        'wfl_action_unavailable',
      )
    }
    assert.equal(
      (
        await mixed.call('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: childNode.nodeId,
          action: 'APPROVE_CHILD',
          expectedRevision: childNode.revision,
        })
      ).errorKey,
      'wfl_action_unavailable',
    )
    assert.equal(
      (
        await ab.call('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: childNode.nodeId,
          action: 'CANCEL_CHILD',
          expectedRevision: childNode.revision,
        })
      ).code,
      0,
    )

    // Pause the real detail SELECT, then replace the pending shape using the normal API.
    const raceAB = await manage(
      path('submit-new'),
      input({
        ...payloadAB,
        parentDocumentId: rootOrder.data.documentId,
        sourceLines: [{ sourceLineId: rootLine, baseQuantity: '0.1' }],
      }),
    )
    assert.equal(raceAB.code, 0, JSON.stringify(raceAB))
    let releaseRead!: () => void, reachedRead!: () => void
    const reached = new Promise<void>((resolve) => {
      reachedRead = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    readGate = {
      documentId: raceAB.data.documentId,
      reached: reachedRead,
      release,
    }
    const pendingRead = ab.call(path('get'), {
      documentId: raceAB.data.documentId,
    })
    let changedShape: Awaited<ReturnType<typeof manage>>
    try {
      await Promise.race([
        reached,
        delay(5000).then(() => {
          throw new Error('detail read fixture did not reach its SELECT')
        }),
      ])
      assert.equal(
        (
          await manage(path('delete'), {
            documentId: raceAB.data.documentId,
            submissionId: raceAB.data.submissionId,
            expectedRevision: raceAB.data.revision,
          })
        ).code,
        0,
      )
      const changedInput = input({
        ...payloadAH,
        priorFact: {
          ...payloadAH.priorFact,
          sourceDocumentKey: 'race-AH-scope',
        },
      })
      changedInput.documentId = raceAB.data.documentId
      changedInput.expectedRevision = (
        BigInt(raceAB.data.stableRevision) + 1n
      ).toString()
      changedShape = await manage(path('submit-change'), changedInput)
      assert.equal(changedShape.code, 0, JSON.stringify(changedShape))
    } finally {
      releaseRead()
      await pendingRead
    }
    assert.equal(
      (await pendingRead).errorKey,
      'forbidden',
      'authorization follows the actual returned version, not an earlier mode lookup',
    )
    assert.equal(
      (await manage(path('get'), { documentId: raceAB.data.documentId })).data
        .payload.priorFact.sourceDocumentType,
      'AH',
    )
    const scopedHistory = await ah.call(path('audit-history'), {
      documentId: raceAB.data.documentId,
    })
    assert.equal(scopedHistory.code, 0)
    assert.ok(scopedHistory.data.length > 0)
    assert.ok(
      scopedHistory.data.every(
        (event: { submissionId: string }) =>
          event.submissionId === changedShape.data.submissionId,
      ),
    )
    assert.ok(
      (
        await manage(path('audit-history'), {
          documentId: raceAB.data.documentId,
        })
      ).data.some(
        (event: { submissionId: string }) =>
          event.submissionId === raceAB.data.submissionId,
      ),
    )
    assert.equal(
      (
        await manage(path('delete'), {
          documentId: changedShape.data.documentId,
          submissionId: changedShape.data.submissionId,
          expectedRevision: changedShape.data.revision,
        })
      ).code,
      0,
    )

    // The same API path does not make the broader role or user manageable.
    const roleDetail = await ah.call('/app/role/get', { id: mixedRole.id })
    assert.equal(roleDetail.data.manageable, false)
    assert.equal(roleDetail.data.assignable, false)
    assert.equal(
      (await ah.call('/app/user/get', { id: mixed.id })).data.manageable,
      false,
    )
    assert.equal(
      (
        await ah.call('/app/user/reset-password', {
          id: mixed.id,
          revision: '1',
        })
      ).errorKey,
      'forbidden',
    )
    const escalated = await ah.call('/app/role/create', {
      name: `scope-escalation-${ulid()}`,
      description: null,
      permissionIds: [permissionId.get(path('get'))],
      purchaseInboundScopes: { [permissionId.get(path('get'))!]: 'ALL' },
    })
    assert.equal(escalated.errorKey, 'forbidden')
    for (const scopePatch of [
      undefined,
      {},
      { [permissionId.get(path('get'))!]: 'ALL', unrelated: 'ALL' },
      { [permissionId.get('/app/user/get')!]: 'ALL' },
    ]) {
      assert.equal(
        (
          await manage('/app/role/create', {
            name: `bad-scope-${ulid()}`,
            description: null,
            permissionIds: [permissionId.get(path('get'))],
            ...(scopePatch === undefined
              ? {}
              : { purchaseInboundScopes: scopePatch }),
          })
        ).errorKey,
        'validation_failed',
      )
    }
    // A normal role save revokes holders' sessions; their new session has the reduced scope.
    let releaseLock!: () => void, readyLock!: () => void
    const ready = new Promise<void>((resolve) => {
      readyLock = resolve
    })
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const holding = db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(74155001)`.execute(tx)
      readyLock()
      await released
    })
    await ready
    async function waitForLock(mode: string) {
      for (let count = 0; count < 100; count++) {
        const locks = await sql<{
          present: boolean
        }>`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=74155001 AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND mode=${mode} AND NOT granted) AS present`.execute(
          db,
        )
        if (locks.rows[0]!.present) return
        await delay(25)
      }
      throw new Error(`fixture did not queue ${mode}`)
    }
    const changeRequest = manage('/app/role/save', {
      id: mixedRole.id,
      revision: mixedRole.revision,
      name: mixedRole.name,
      description: mixedRole.description,
      permissionIds: mixedRole.permissions.map(
        (permission: { id: string }) => permission.id,
      ),
      purchaseInboundScopes: Object.fromEntries(
        Object.keys(mixedRole.purchaseInboundScopes).map((id) => [
          id,
          'ORDER_REFERENCE',
        ]),
      ),
    })
    let queuedWrite: Promise<Awaited<ReturnType<typeof mixed.call>>> | undefined
    try {
      await waitForLock('ExclusiveLock')
      queuedWrite = mixed.call(path('unapprove'), {
        documentId: viewAH.documentId,
        submissionId: viewAH.submissionId,
        expectedRevision: approvedAH.data.revision,
        reason: 'queued scope fixture',
      })
      await waitForLock('ShareLock')
    } finally {
      releaseLock()
    }
    await holding
    const changed = await changeRequest
    assert.equal(changed.code, 0, JSON.stringify(changed))
    assert.equal(
      (await queuedWrite!).errorKey,
      'forbidden',
      'a request authenticated before the committed scope reduction cannot later write',
    )
    assert.equal(
      (await manage(path('get'), { documentId: viewAH.documentId })).data
        .status,
      'APPROVED',
    )
    assert.equal(
      (await mixed.call(path('get'), { documentId: viewAH.documentId }))
        .errorKey,
      'unauthenticated',
    )
    assert.equal((await download(issued.data.downloadUrl)).status, 404)
    const freshMixed = await client({
      username: mixed.username,
      password: mixed.password + '-Changed1!',
    })
    assert.equal(
      (await freshMixed(path('get'), { documentId: viewAH.documentId }))
        .errorKey,
      'forbidden',
    )
    assert.equal(
      (await freshMixed(path('get'), { documentId: viewAB.documentId })).code,
      0,
    )
    const disabled = await manage('/app/role/disable', {
      id: abRole.id,
      revision: abRole.revision,
    })
    assert.equal(disabled.code, 0)
    assert.equal(
      (await union.call(path('query'), { page: 1, pageSize: 20 })).errorKey,
      'unauthenticated',
    )
    const freshUnion = await client({
      username: union.username,
      password: union.password + '-Changed1!',
    })
    assert.equal(
      (await freshUnion('/session/auth/restore', {})).data
        .purchaseInboundScopes[path('query')],
      'INDEPENDENT_PRIOR',
    )
    assert.equal(
      (await freshUnion(path('query'), { page: 1, pageSize: 20 })).data.total,
      1,
    )
    const enabled = await manage('/app/role/enable', {
      id: abRole.id,
      revision: disabled.data.revision,
    })
    assert.equal(enabled.code, 0)
    assert.equal(
      (await freshUnion('/session/auth/restore', {})).errorKey,
      'unauthenticated',
    )
    const nextUnion = await client({
      username: union.username,
      password: union.password + '-Changed1!',
    })
    assert.equal(
      (await nextUnion(path('query'), { page: 1, pageSize: 20 })).data.total,
      2,
    )
    // No scope validation failure accidentally submitted the denied original identities.
    for (const denied of [deniedAB, deniedAH])
      assert.equal(
        (await post(path('get'), { documentId: denied.documentId })).errorKey,
        'vou_not_found',
      )
  })
})

test('supported populated receipt grant upgrade conserves every old row and rejects drift or partial layouts', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const bootstrap = new TargetBootstrapService(db)
    await bootstrap.initializeAdministrators(
      [
        {
          username: 'upgrade-scope-admin',
          displayName: 'Upgrade scope admin',
          password: 'Upgrade!Scope123',
        },
        {
          username: 'upgrade-scope-reviewer',
          displayName: 'Upgrade scope reviewer',
          password: 'Upgrade!Scope456',
        },
      ],
      12,
    )
    await seedStockFixture(
      db,
      '2026-09',
      { quantity: '60', amount: '120.00' },
      false,
    )
    const operator = await db
      .selectFrom('app_users')
      .select('id')
      .where('username', '=', 'upgrade-scope-admin')
      .executeTakeFirstOrThrow()
    // Reconstruct the supported pre-Supplier grant layout, rather than inventing
    // a historical installation with the later Supplier facet but no receipt scope.
    await sql`UPDATE app_role_permissions SET service_contexts=array_remove(service_contexts,'SUPPLIER')`.execute(
      db,
    )
    await sql`ALTER TABLE app_role_permissions DROP CONSTRAINT app_role_permissions_service_contexts_check, ADD CONSTRAINT app_role_permissions_service_contexts_check CHECK (service_contexts <@ ARRAY['OTHER_UNIT','SALES_PARTNER','PRIOR_AA','PRIOR_AD','CONTRACT','PRIOR_AB','PRIOR_AE','PRIOR_AH']::text[])`.execute(
      db,
    )
    await sql`ALTER TABLE app_role_permissions DROP COLUMN purchase_inbound_scope`.execute(
      db,
    )
    const baseline = await inspectPurchaseInboundScopeUpgrade(db)
    assert.equal(baseline.layout, 'LEGACY')
    assert.ok(baseline.grants! > 0)
    const input = {
      baseline: baseline.baseline,
      actorId: operator.id,
      sourceReleaseSha: 'a'.repeat(40),
      targetReleaseSha: 'b'.repeat(40),
    }
    await assert.rejects(
      upgradePurchaseInboundScopes(db, { ...input, baseline: 'c'.repeat(64) }),
      /baseline_changed/,
    )
    await assert.rejects(
      upgradePurchaseInboundScopes(db, { ...input, actorId: ulid() }),
      /operator_required/,
    )
    assert.deepEqual(await inspectPurchaseInboundScopeUpgrade(db), baseline)
    await sql`ALTER TABLE app_role_permissions ADD COLUMN purchase_inbound_scope text`.execute(
      db,
    )
    assert.equal(
      (await inspectPurchaseInboundScopeUpgrade(db)).layout,
      'UNSUPPORTED',
    )
    await assert.rejects(
      upgradePurchaseInboundScopes(db, input),
      /legacy_layout_required/,
    )
    await sql`ALTER TABLE app_role_permissions DROP COLUMN purchase_inbound_scope`.execute(
      db,
    )
    assert.deepEqual(await inspectPurchaseInboundScopeUpgrade(db), baseline)
    const upgraded = await upgradePurchaseInboundScopes(db, input)
    assert.equal(upgraded.originalGrantsPreserved, baseline.grants)
    assert.equal(upgraded.originalPublicTables, baseline.publicTables)
    assert.equal(upgraded.existingGrantScope, 'ALL')
    assert.equal(
      (await inspectPurchaseInboundScopeUpgrade(db)).layout,
      'CURRENT',
    )
    assert.deepEqual(
      new Set(
        (
          await db
            .selectFrom('app_role_permissions')
            .select('purchase_inbound_scope')
            .execute()
        ).map((row) => row.purchase_inbound_scope),
      ),
      new Set(['ALL']),
    )
    await assert.rejects(
      upgradePurchaseInboundScopes(db, input),
      /legacy_layout_required/,
    )
    const column = await sql<{
      column_default: string | null
      is_nullable: string
    }>`SELECT column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='app_role_permissions' AND column_name='purchase_inbound_scope'`.execute(
      db,
    )
    assert.deepEqual(column.rows, [{ column_default: null, is_nullable: 'NO' }])
  })
})
