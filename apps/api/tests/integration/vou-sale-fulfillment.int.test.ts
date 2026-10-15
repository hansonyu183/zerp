import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import { VouService } from '../../src/vou/service.ts'
import { WflService, type WflVouPort } from '../../src/wfl/service.ts'
import { seedStockFixture } from '../fixtures/vou-stock.ts'
import {
  purchaseClients,
  withCommittedPurchaseDatabase,
} from '../fixtures/vou-purchase-http.ts'

// Only synthetic identities and stock are used. Exercise ordinary Session,
// WFL and VOU HTTP commands with the real ACC services and transaction boundary.
async function saleClients(
  db: Parameters<typeof seedStockFixture>[0],
  stock = '100',
  postRejected = false,
) {
  const f = await seedStockFixture(db, '2026-09', {
    quantity: stock,
    amount: `${stock}.00`,
  })
  if (postRejected)
    await f.vou.delete(
      'purchase-order',
      {
        documentId: f.purchase.documentId,
        submissionId: f.purchase.submissionId,
        expectedRevision: f.purchase.revision,
      },
      f.actor,
      'remove-unrelated-pending-stock-fixture',
    )
  await f.mappings.save(
    {
      bookId: f.book.id,
      vouEntity: 'sale-order',
      expectedRevision: null,
      defaultResult: 'UN_POST',
      definition: {
        defaultTemplateId: null,
        rules: [],
        templates: [],
        assetConfiguration: null,
      },
    },
    f.actor,
  )
  await f.quantityMapping('sale-outbound', f.equity.id)
  for (const entity of postRejected
    ? ['sale-delivery', 'intermediary-calculation']
    : ['sale-delivery', 'sale-signoff'])
    await f.mappings.save(
      {
        bookId: f.book.id,
        vouEntity: entity,
        expectedRevision: null,
        defaultResult: 'UN_POST',
        definition: {
          defaultTemplateId: null,
          rules: [],
          templates: [],
          assetConfiguration: null,
        },
      },
      f.actor,
    )
  if (postRejected) await f.quantityMapping('sale-signoff', f.equity.id)
  const paths = [
    ...['sale-order', 'sale-outbound', 'sale-delivery', 'sale-signoff'].flatMap(
      (entity) =>
        ['query', 'get', 'approve', 'unapprove', 'audit-history'].map(
          (action) => `/vou/${entity}/${action}`,
        ),
    ),
    '/vou/sale-order/submit-new',
    '/vou/inventory-count/book-balance',
    '/acc/period/query',
    '/acc/period/lock',
    ...['source', 'script-save', 'submit-new', 'approve'].map(
      (action) => `/vou/intermediary-calculation/${action}`,
    ),
    ...['submit-new', 'approve', 'enable', 'query', 'submission-get'].map(
      (action) => `/wfl/process-definition/${action}`,
    ),
    '/wfl/process-instance/query',
    '/wfl/process-instance/get',
    '/wfl/process-instance/create-sale-outbound',
    '/wfl/process-instance/create-sale-delivery',
    '/wfl/process-instance/create-sale-signoff',
  ]
  const password = `Sale!Aa1${ulid()}`
  const bootstrap = new TargetBootstrapService(db)
  async function principal() {
    const user = {
      userId: ulid(),
      roleId: ulid(),
      username: `sale-${ulid()}`,
      passwordHash: await hashPassword(password),
      password,
    }
    await bootstrap.createE2EPrincipal(user, false, paths)
    return user
  }
  const submitter = await principal(),
    reviewer = await principal()
  const book = await f.acc.getBook(f.book.id, f.actor)
  await f.acc.saveBook(
    {
      id: book.id,
      expectedRevision: book.revision,
      name: book.name,
      description: book.description,
      baseCurrency: book.baseCurrency,
      queryUserIds: [...book.queryUserIds, submitter.userId, reviewer.userId],
      operateUserIds: [
        ...book.operateUserIds,
        submitter.userId,
        reviewer.userId,
      ],
    },
    f.actor,
  )
  let vou!: VouService
  const port: WflVouPort = {
    createChild: (...args) => vou.createChild(...args),
    approveChild: (...args) => vou.approveChild(...args),
    rejectChild: (...args) => vou.rejectChild(...args),
    retryChild: (...args) => vou.retryChild(...args),
    cancelChild: (...args) => vou.cancelChild(...args),
  }
  const wfl = new WflService(db, await createNodeWflStarlark(), port)
  vou = new VouService(db, { acc: f.acc, wfl })
  const clients = await purchaseClients(
    db,
    { ...f, submitter, reviewer },
    undefined,
    { vou, wfl, acc: f.acc },
  )
  return { ...clients, payload: f.salePayload, bookId: f.book.id }
}

test('normal workflow cannot create an outbound larger than its approved order', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db)
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库", entity="sale-outbound")
workflow(code="sale-capacity", name="销售数量验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"101"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const instances = await post('/wfl/process-instance/query', {
        code: 'sale-capacity',
        page: 1,
        pageSize: 20,
      })
      assert.equal(instances.code, 0, JSON.stringify(instances))
      const instance = instances.data.items[0]!
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const result = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'outbound',
        requestKey: 'sale-outbound-over-order-101',
      })
      assert.equal(result.errorKey, 'vou_source_line_quantity_exceeded')
      const outbounds = await post('/vou/sale-outbound/query', {
        page: 1,
        pageSize: 20,
        filters: {},
      })
      assert.equal(outbounds.data.total, 0)
      const unchanged = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(unchanged.data, accepted.data)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('delivery must cover the complete approved outbound quantity', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db, '200')
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库60", entity="sale-outbound")
delivery = node(key="delivery", name="部分送货50", entity="sale-delivery")
workflow(code="sale-delivery-cover", name="送货来源验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"50"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const listed = await post('/wfl/process-instance/query', {
        code: 'sale-delivery-cover',
        page: 1,
        pageSize: 20,
      })
      assert.equal(listed.code, 0, JSON.stringify(listed))
      const instance = listed.data.items[0]!
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const created = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'outbound',
        requestKey: 'sale-delivery-outbound-60',
      })
      assert.equal(created.code, 0, JSON.stringify(created))
      const outbound = created.data.nodes.find(
        (node: any) => node.nodeKey === 'outbound',
      )!
      const dispatched = await review('/vou/sale-outbound/approve', {
        documentId: outbound.documentId,
        submissionId: outbound.submissionId,
        expectedRevision: outbound.revision,
      })
      assert.equal(dispatched.code, 0, JSON.stringify(dispatched))
      const result = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: outbound.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'delivery',
        requestKey: 'sale-delivery-partial-50',
      })
      assert.equal(result.errorKey, 'vou_source_line_quantity_exceeded')
      const deliveries = await post('/vou/sale-delivery/query', {
        page: 1,
        pageSize: 20,
        filters: {},
      })
      assert.equal(deliveries.data.total, 0)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('approving another outbound rechecks approved stock in transit instead of reopening the original quantity', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db, '200')
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const script = `root = node(key="root", name="订单", entity="sale-order")
first = node(key="first", name="出库60", entity="sale-outbound")
second = node(key="second", name="出库50", entity="sale-outbound")
workflow(code="sale-transit", name="销售在途验收", root=root, edges=[edge(source=root, target=first, relation="first", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]})), edge(source=root, target=second, relation="second", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"50"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const listed = await post('/wfl/process-instance/query', {
        code: 'sale-transit',
        page: 1,
        pageSize: 20,
      })
      assert.equal(listed.code, 0, JSON.stringify(listed))
      const instance = listed.data.items[0]!
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const create = async (key: string) => {
        const result = await post('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: root.nodeId,
          action: 'CREATE_CHILD',
          targetNodeKey: key,
          requestKey: `sale-transit-create-${key}`,
        })
        assert.equal(result.code, 0, JSON.stringify(result))
        return result.data.nodes.find((node: any) => node.nodeKey === key)!
      }
      const first = await create('first'),
        second = await create('second')
      const approve = (node: any) =>
        review('/vou/sale-outbound/approve', {
          documentId: node.documentId,
          submissionId: node.submissionId,
          expectedRevision: node.revision,
        })
      const firstApproved = await approve(first)
      assert.equal(firstApproved.code, 0, JSON.stringify(firstApproved))
      const secondApproved = await approve(second)
      assert.equal(secondApproved.errorKey, 'vou_source_line_quantity_exceeded')
      const pending = await post('/vou/sale-outbound/get', {
        documentId: second.documentId,
      })
      assert.equal(pending.data.status, 'PENDING')
      const inventory = await post('/vou/inventory-count/book-balance', {
        warehouseId: payload.warehouse.objectId,
        businessDate: '2026-09-04',
        page: 1,
        pageSize: 20,
      })
      assert.equal(inventory.code, 0, JSON.stringify(inventory))
      assert.equal(inventory.data.items.length, 1)
      assert.equal(inventory.data.items[0].bookQuantity, '140.00000000')
      const unchanged = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(unchanged.data.payload, accepted.data.payload)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('an approved outbound cannot be adopted by two delivery submissions', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db, '200')
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库60", entity="sale-outbound")
first = node(key="first", name="第一次送货", entity="sale-delivery")
second = node(key="second", name="第二次送货", entity="sale-delivery")
workflow(code="delivery-singleton", name="送货唯一性验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]})), edge(source=outbound, target=first, relation="first", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]})), edge(source=outbound, target=second, relation="second", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const listed = await post('/wfl/process-instance/query', {
        code: 'delivery-singleton',
        page: 1,
        pageSize: 20,
      })
      assert.equal(listed.code, 0, JSON.stringify(listed))
      const instance = listed.data.items[0]!
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const created = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'outbound',
        requestKey: 'singleton-outbound-create',
      })
      assert.equal(created.code, 0, JSON.stringify(created))
      const outbound = created.data.nodes.find(
        (node: any) => node.nodeKey === 'outbound',
      )!
      const dispatched = await review('/vou/sale-outbound/approve', {
        documentId: outbound.documentId,
        submissionId: outbound.submissionId,
        expectedRevision: outbound.revision,
      })
      assert.equal(dispatched.code, 0, JSON.stringify(dispatched))
      const create = (key: string) =>
        post('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: outbound.nodeId,
          action: 'CREATE_CHILD',
          targetNodeKey: key,
          requestKey: `singleton-delivery-${key}`,
        })
      const first = await create('first')
      assert.equal(first.code, 0, JSON.stringify(first))
      const second = await create('second')
      assert.equal(second.errorKey, 'vou_source_line_unavailable')
      const deliveries = await post('/vou/sale-delivery/query', {
        page: 1,
        pageSize: 20,
        filters: {},
      })
      assert.equal(deliveries.data.total, 1)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('signoff cannot record more signed and rejected quantity than its approved delivery', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db, '200')
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const signoff = JSON.stringify({
        businessDate: '2026-09-04',
        currency: 'CNY',
        attachments: [],
        customer: payload.customer,
        expectedSolventContainers: 0,
        expectedResinContainers: 0,
        returnedSolventContainers: 0,
        returnedResinContainers: 0,
        signoffLines: [
          {
            sourceLineId: lineId,
            signedBaseQuantity: '50',
            rejectedBaseQuantity: '11',
          },
        ],
      })
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库60", entity="sale-outbound")
delivery = node(key="delivery", name="送货60", entity="sale-delivery")
signoff = node(key="signoff", name="签收及拒收61", entity="sale-signoff")
workflow(code="signoff-capacity", name="签收来源验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]})), edge(source=delivery, target=signoff, relation="signoff", action=sale_signoff(initial=${signoff}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const listed = await post('/wfl/process-instance/query', {
        code: 'signoff-capacity',
        page: 1,
        pageSize: 20,
      })
      assert.equal(listed.code, 0, JSON.stringify(listed))
      const instance = listed.data.items[0]!
      let parent = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      for (const key of ['outbound', 'delivery']) {
        const created = await post('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: parent.nodeId,
          action: 'CREATE_CHILD',
          targetNodeKey: key,
          requestKey: `signoff-capacity-${key}`,
        })
        assert.equal(created.code, 0, JSON.stringify(created))
        parent = created.data.nodes.find((node: any) => node.nodeKey === key)!
        const approvedChild = await review(`/vou/sale-${key}/approve`, {
          documentId: parent.documentId,
          submissionId: parent.submissionId,
          expectedRevision: parent.revision,
        })
        assert.equal(approvedChild.code, 0, JSON.stringify(approvedChild))
      }
      const result = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: parent.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'signoff',
        requestKey: 'signoff-over-delivery',
      })
      assert.equal(result.errorKey, 'vou_source_line_quantity_exceeded')
      const signoffs = await post('/vou/sale-signoff/query', {
        page: 1,
        pageSize: 20,
        filters: {},
      })
      assert.equal(signoffs.data.total, 0)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('approved signoff releases only rejected and lost demand for a later outbound', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db, '200')
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const signoff = JSON.stringify({
        businessDate: '2026-09-04',
        currency: 'CNY',
        attachments: [],
        customer: payload.customer,
        expectedSolventContainers: 0,
        expectedResinContainers: 0,
        returnedSolventContainers: 0,
        returnedResinContainers: 0,
        signoffLines: [
          {
            sourceLineId: lineId,
            signedBaseQuantity: '60',
            rejectedBaseQuantity: '20',
          },
        ],
      })
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库100", entity="sale-outbound")
delivery = node(key="delivery", name="送货100", entity="sale-delivery")
signoff = node(key="signoff", name="签收60拒收20损耗20", entity="sale-signoff")
again = node(key="again", name="补充出库40", entity="sale-outbound")
extra = node(key="extra", name="再次超出1", entity="sale-outbound")
workflow(code="signoff-release", name="签收来源验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"100"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"100"}]})), edge(source=delivery, target=signoff, relation="signoff", action=sale_signoff(initial=${signoff})), edge(source=root, target=again, relation="again", action=sale_outbound(initial={"businessDate":"2026-09-05","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"40"}]})), edge(source=root, target=extra, relation="extra", action=sale_outbound(initial={"businessDate":"2026-09-05","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"1"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const listed = await post('/wfl/process-instance/query', {
        code: 'signoff-release',
        page: 1,
        pageSize: 20,
      })
      assert.equal(listed.code, 0, JSON.stringify(listed))
      const instance = listed.data.items[0]!
      let parent = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      for (const key of ['outbound', 'delivery']) {
        const created = await post('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: parent.nodeId,
          action: 'CREATE_CHILD',
          targetNodeKey: key,
          requestKey: `signoff-capacity-${key}`,
        })
        assert.equal(created.code, 0, JSON.stringify(created))
        parent = created.data.nodes.find((node: any) => node.nodeKey === key)!
        const approvedChild = await review(`/vou/sale-${key}/approve`, {
          documentId: parent.documentId,
          submissionId: parent.submissionId,
          expectedRevision: parent.revision,
        })
        assert.equal(approvedChild.code, 0, JSON.stringify(approvedChild))
      }
      const result = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: parent.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'signoff',
        requestKey: 'signoff-over-delivery',
      })
      assert.equal(result.code, 0, JSON.stringify(result))
      const receipt = result.data.nodes.find(
        (node: any) => node.nodeKey === 'signoff',
      )!
      const signed = await review('/vou/sale-signoff/approve', {
        documentId: receipt.documentId,
        submissionId: receipt.submissionId,
        expectedRevision: receipt.revision,
      })
      assert.equal(signed.code, 0, JSON.stringify(signed))
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const continuation = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'again',
        requestKey: 'signoff-release-next-40',
      })
      assert.equal(continuation.code, 0, JSON.stringify(continuation))
      const next = continuation.data.nodes.find(
        (node: any) => node.nodeKey === 'again',
      )!
      const shipped = await review('/vou/sale-outbound/approve', {
        documentId: next.documentId,
        submissionId: next.submissionId,
        expectedRevision: next.revision,
      })
      assert.equal(shipped.code, 0, JSON.stringify(shipped))
      const extra = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'extra',
        requestKey: 'signoff-release-excess-1',
      })
      assert.equal(extra.errorKey, 'vou_source_line_quantity_exceeded')
      const unchanged = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(unchanged.data.payload, accepted.data.payload)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('signoff cannot be unapproved after another outbound consumes its released demand', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db, '200')
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const signoff = JSON.stringify({
        businessDate: '2026-09-04',
        currency: 'CNY',
        attachments: [],
        customer: payload.customer,
        expectedSolventContainers: 0,
        expectedResinContainers: 0,
        returnedSolventContainers: 0,
        returnedResinContainers: 0,
        signoffLines: [
          {
            sourceLineId: lineId,
            signedBaseQuantity: '60',
            rejectedBaseQuantity: '20',
          },
        ],
      })
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库100", entity="sale-outbound")
delivery = node(key="delivery", name="送货100", entity="sale-delivery")
signoff = node(key="signoff", name="签收60拒收20损耗20", entity="sale-signoff")
again = node(key="again", name="补充出库40", entity="sale-outbound")
extra = node(key="extra", name="再次超出1", entity="sale-outbound")
workflow(code="signoff-release", name="签收来源验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"100"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"100"}]})), edge(source=delivery, target=signoff, relation="signoff", action=sale_signoff(initial=${signoff})), edge(source=root, target=again, relation="again", action=sale_outbound(initial={"businessDate":"2026-09-05","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"40"}]})), edge(source=root, target=extra, relation="extra", action=sale_outbound(initial={"businessDate":"2026-09-05","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"1"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const listed = await post('/wfl/process-instance/query', {
        code: 'signoff-release',
        page: 1,
        pageSize: 20,
      })
      assert.equal(listed.code, 0, JSON.stringify(listed))
      const instance = listed.data.items[0]!
      let parent = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      for (const key of ['outbound', 'delivery']) {
        const created = await post('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: parent.nodeId,
          action: 'CREATE_CHILD',
          targetNodeKey: key,
          requestKey: `signoff-capacity-${key}`,
        })
        assert.equal(created.code, 0, JSON.stringify(created))
        parent = created.data.nodes.find((node: any) => node.nodeKey === key)!
        const approvedChild = await review(`/vou/sale-${key}/approve`, {
          documentId: parent.documentId,
          submissionId: parent.submissionId,
          expectedRevision: parent.revision,
        })
        assert.equal(approvedChild.code, 0, JSON.stringify(approvedChild))
      }
      const result = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: parent.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'signoff',
        requestKey: 'signoff-over-delivery',
      })
      assert.equal(result.code, 0, JSON.stringify(result))
      const receipt = result.data.nodes.find(
        (node: any) => node.nodeKey === 'signoff',
      )!
      const signed = await review('/vou/sale-signoff/approve', {
        documentId: receipt.documentId,
        submissionId: receipt.submissionId,
        expectedRevision: receipt.revision,
      })
      assert.equal(signed.code, 0, JSON.stringify(signed))
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const continuation = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'again',
        requestKey: 'signoff-release-next-40',
      })
      assert.equal(continuation.code, 0, JSON.stringify(continuation))
      const next = continuation.data.nodes.find(
        (node: any) => node.nodeKey === 'again',
      )!
      const shipped = await review('/vou/sale-outbound/approve', {
        documentId: next.documentId,
        submissionId: next.submissionId,
        expectedRevision: next.revision,
      })
      assert.equal(shipped.code, 0, JSON.stringify(shipped))
      const extra = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'extra',
        requestKey: 'signoff-release-excess-1',
      })
      assert.equal(extra.errorKey, 'vou_source_line_quantity_exceeded')
      const reversal = await review('/vou/sale-signoff/unapprove', {
        documentId: receipt.documentId,
        submissionId: receipt.submissionId,
        expectedRevision: signed.data.revision,
        reason: '核查签收反审释放的来源依赖',
      })
      assert.equal(reversal.errorKey, 'vou_unapprove_blocked')
      assert.ok(
        reversal.data.blockers.some(
          (blocker: any) => blocker.id === next.documentId,
        ),
      )
      const preserved = await post('/vou/sale-signoff/get', {
        documentId: receipt.documentId,
      })
      assert.deepEqual(preserved.data, signed.data)
      const unchanged = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(unchanged.data.payload, accepted.data.payload)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('outbound date cannot precede its approved order', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db)
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库", entity="sale-outbound")
workflow(code="sale-capacity", name="销售数量验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-01","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const instances = await post('/wfl/process-instance/query', {
        code: 'sale-capacity',
        page: 1,
        pageSize: 20,
      })
      assert.equal(instances.code, 0, JSON.stringify(instances))
      const instance = instances.data.items[0]!
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const result = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'outbound',
        requestKey: 'sale-outbound-over-order-101',
      })
      assert.equal(result.errorKey, 'vou_source_line_unavailable')
      const outbounds = await post('/vou/sale-outbound/query', {
        page: 1,
        pageSize: 20,
        filters: {},
      })
      assert.equal(outbounds.data.total, 0)
      const unchanged = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(unchanged.data, accepted.data)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('outbound currency must match its approved order', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db)
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库", entity="sale-outbound")
workflow(code="sale-capacity", name="销售数量验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"USD","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const instances = await post('/wfl/process-instance/query', {
        code: 'sale-capacity',
        page: 1,
        pageSize: 20,
      })
      assert.equal(instances.code, 0, JSON.stringify(instances))
      const instance = instances.data.items[0]!
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const result = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'outbound',
        requestKey: 'sale-outbound-over-order-101',
      })
      assert.equal(result.errorKey, 'vou_source_line_unavailable')
      const outbounds = await post('/vou/sale-outbound/query', {
        page: 1,
        pageSize: 20,
        filters: {},
      })
      assert.equal(outbounds.data.total, 0)
      const unchanged = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(unchanged.data, accepted.data)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('concurrent approval of two outbounds commits only the quantity allowed by their order', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db, '200')
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const script = `root = node(key="root", name="订单", entity="sale-order")
first = node(key="first", name="出库60", entity="sale-outbound")
second = node(key="second", name="出库60", entity="sale-outbound")
workflow(code="sale-transit", name="销售在途验收", root=root, edges=[edge(source=root, target=first, relation="first", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]})), edge(source=root, target=second, relation="second", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"60"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const listed = await post('/wfl/process-instance/query', {
        code: 'sale-transit',
        page: 1,
        pageSize: 20,
      })
      assert.equal(listed.code, 0, JSON.stringify(listed))
      const instance = listed.data.items[0]!
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const create = async (key: string) => {
        const result = await post('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: root.nodeId,
          action: 'CREATE_CHILD',
          targetNodeKey: key,
          requestKey: `sale-transit-create-${key}`,
        })
        assert.equal(result.code, 0, JSON.stringify(result))
        return result.data.nodes.find((node: any) => node.nodeKey === key)!
      }
      const first = await create('first'),
        second = await create('second')
      const approve = (node: any) =>
        review('/vou/sale-outbound/approve', {
          documentId: node.documentId,
          submissionId: node.submissionId,
          expectedRevision: node.revision,
        })
      const outcomes = await Promise.all([approve(first), approve(second)])
      assert.equal(outcomes.filter((outcome) => outcome.code === 0).length, 1)
      assert.equal(
        outcomes.filter(
          (outcome) => outcome.errorKey === 'vou_source_line_quantity_exceeded',
        ).length,
        1,
      )
      const denied = [first, second][
        outcomes.findIndex((outcome) => outcome.code !== 0)
      ]!
      const pending = await post('/vou/sale-outbound/get', {
        documentId: denied.documentId,
      })
      assert.equal(pending.data.status, 'PENDING')
      const inventory = await post('/vou/inventory-count/book-balance', {
        warehouseId: payload.warehouse.objectId,
        businessDate: '2026-09-04',
        page: 1,
        pageSize: 20,
      })
      assert.equal(inventory.code, 0, JSON.stringify(inventory))
      assert.equal(inventory.data.items.length, 1)
      assert.equal(inventory.data.items[0].bookQuantity, '140.00000000')
      const unchanged = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(unchanged.data.payload, accepted.data.payload)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('signoff restores rejected stock while loss stays out of inventory', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload } = await saleClients(db, '200', true)
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const signoff = JSON.stringify({
        businessDate: '2026-09-04',
        currency: 'CNY',
        attachments: [],
        customer: payload.customer,
        expectedSolventContainers: 0,
        expectedResinContainers: 0,
        returnedSolventContainers: 0,
        returnedResinContainers: 0,
        signoffLines: [
          {
            sourceLineId: lineId,
            signedBaseQuantity: '60',
            rejectedBaseQuantity: '20',
          },
        ],
      })
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库100", entity="sale-outbound")
delivery = node(key="delivery", name="送货100", entity="sale-delivery")
signoff = node(key="signoff", name="签收60拒收20损耗20", entity="sale-signoff")
again = node(key="again", name="补充出库40", entity="sale-outbound")
extra = node(key="extra", name="再次超出1", entity="sale-outbound")
workflow(code="signoff-release", name="签收来源验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"100"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"100"}]})), edge(source=delivery, target=signoff, relation="signoff", action=sale_signoff(initial=${signoff})), edge(source=root, target=again, relation="again", action=sale_outbound(initial={"businessDate":"2026-09-05","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"40"}]})), edge(source=root, target=extra, relation="extra", action=sale_outbound(initial={"businessDate":"2026-09-05","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"1"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const listed = await post('/wfl/process-instance/query', {
        code: 'signoff-release',
        page: 1,
        pageSize: 20,
      })
      assert.equal(listed.code, 0, JSON.stringify(listed))
      const instance = listed.data.items[0]!
      let parent = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      for (const key of ['outbound', 'delivery']) {
        const created = await post('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: parent.nodeId,
          action: 'CREATE_CHILD',
          targetNodeKey: key,
          requestKey: `signoff-capacity-${key}`,
        })
        assert.equal(created.code, 0, JSON.stringify(created))
        parent = created.data.nodes.find((node: any) => node.nodeKey === key)!
        const approvedChild = await review(`/vou/sale-${key}/approve`, {
          documentId: parent.documentId,
          submissionId: parent.submissionId,
          expectedRevision: parent.revision,
        })
        assert.equal(approvedChild.code, 0, JSON.stringify(approvedChild))
      }
      const result = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: parent.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'signoff',
        requestKey: 'signoff-over-delivery',
      })
      assert.equal(result.code, 0, JSON.stringify(result))
      const receipt = result.data.nodes.find(
        (node: any) => node.nodeKey === 'signoff',
      )!
      const signed = await review('/vou/sale-signoff/approve', {
        documentId: receipt.documentId,
        submissionId: receipt.submissionId,
        expectedRevision: receipt.revision,
      })
      assert.equal(signed.code, 0, JSON.stringify(signed))
      const inventory = await post('/vou/inventory-count/book-balance', {
        warehouseId: payload.warehouse.objectId,
        businessDate: '2026-09-04',
        page: 1,
        pageSize: 20,
      })
      assert.equal(inventory.code, 0, JSON.stringify(inventory))
      assert.equal(inventory.data.items[0].bookQuantity, '120.00000000')
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const continuation = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'again',
        requestKey: 'signoff-release-next-40',
      })
      assert.equal(continuation.code, 0, JSON.stringify(continuation))
      const next = continuation.data.nodes.find(
        (node: any) => node.nodeKey === 'again',
      )!
      const shipped = await review('/vou/sale-outbound/approve', {
        documentId: next.documentId,
        submissionId: next.submissionId,
        expectedRevision: next.revision,
      })
      assert.equal(shipped.code, 0, JSON.stringify(shipped))
      const extra = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'extra',
        requestKey: 'signoff-release-excess-1',
      })
      assert.equal(extra.errorKey, 'vou_source_line_quantity_exceeded')
      const finalInventory = await post('/vou/inventory-count/book-balance', {
        warehouseId: payload.warehouse.objectId,
        businessDate: '2026-09-05',
        page: 1,
        pageSize: 20,
      })
      assert.equal(finalInventory.code, 0, JSON.stringify(finalInventory))
      assert.equal(finalInventory.data.items[0].bookQuantity, '80.00000000')
      const unchanged = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(unchanged.data.payload, accepted.data.payload)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('normal month lock accepts rejected signoff stock tied to its original outbound cost', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const { post, review, payload, bookId } = await saleClients(db, '200', true)
    try {
      const documentId = ulid(),
        submissionId = ulid(),
        lineId = ulid()
      const order = await post('/vou/sale-order/submit-new', {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...payload,
          productLines: [
            {
              ...payload.productLines[0]!,
              lineId,
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      })
      assert.equal(order.code, 0, JSON.stringify(order))
      const subjectId = ulid(),
        definitionId = ulid()
      const signoff = JSON.stringify({
        businessDate: '2026-09-04',
        currency: 'CNY',
        attachments: [],
        customer: payload.customer,
        expectedSolventContainers: 0,
        expectedResinContainers: 0,
        returnedSolventContainers: 0,
        returnedResinContainers: 0,
        signoffLines: [
          {
            sourceLineId: lineId,
            signedBaseQuantity: '60',
            rejectedBaseQuantity: '20',
          },
        ],
      })
      const script = `root = node(key="root", name="订单", entity="sale-order")
outbound = node(key="outbound", name="出库100", entity="sale-outbound")
delivery = node(key="delivery", name="送货100", entity="sale-delivery")
signoff = node(key="signoff", name="签收60拒收20损耗20", entity="sale-signoff")
again = node(key="again", name="补充出库40", entity="sale-outbound")
extra = node(key="extra", name="再次超出1", entity="sale-outbound")
workflow(code="signoff-release", name="签收来源验收", root=root, edges=[edge(source=root, target=outbound, relation="outbound", action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"100"}]})), edge(source=outbound, target=delivery, relation="delivery", action=sale_delivery(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"100"}]})), edge(source=delivery, target=signoff, relation="signoff", action=sale_signoff(initial=${signoff})), edge(source=root, target=again, relation="again", action=sale_outbound(initial={"businessDate":"2026-09-05","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"40"}]})), edge(source=root, target=extra, relation="extra", action=sale_outbound(initial={"businessDate":"2026-09-05","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${lineId}","baseQuantity":"1"}]}))])`
      const definition = await post('/wfl/process-definition/submit-new', {
        subjectId,
        submissionId: definitionId,
        idempotencyKey: definitionId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        script,
        trialDocument: { entity: 'sale-order', documentId },
      })
      assert.equal(definition.code, 0, JSON.stringify(definition))
      const approved = await review('/wfl/process-definition/approve', {
        subjectId,
        submissionId: definitionId,
        expectedRevision: definition.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const enabled = await review('/wfl/process-definition/enable', {
        subjectId,
        approvalEntryId: definitionId,
        expectedApprovalRevision: approved.data.revision,
        expectedRuntimeRevision: null,
      })
      assert.equal(enabled.code, 0, JSON.stringify(enabled))
      const accepted = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: order.data.revision,
      })
      assert.equal(accepted.code, 0, JSON.stringify(accepted))
      const listed = await post('/wfl/process-instance/query', {
        code: 'signoff-release',
        page: 1,
        pageSize: 20,
      })
      assert.equal(listed.code, 0, JSON.stringify(listed))
      const instance = listed.data.items[0]!
      let parent = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      for (const key of ['outbound', 'delivery']) {
        const created = await post('/wfl/process-instance/action', {
          processId: instance.processId,
          nodeId: parent.nodeId,
          action: 'CREATE_CHILD',
          targetNodeKey: key,
          requestKey: `signoff-capacity-${key}`,
        })
        assert.equal(created.code, 0, JSON.stringify(created))
        parent = created.data.nodes.find((node: any) => node.nodeKey === key)!
        const approvedChild = await review(`/vou/sale-${key}/approve`, {
          documentId: parent.documentId,
          submissionId: parent.submissionId,
          expectedRevision: parent.revision,
        })
        assert.equal(approvedChild.code, 0, JSON.stringify(approvedChild))
      }
      const result = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: parent.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'signoff',
        requestKey: 'signoff-over-delivery',
      })
      assert.equal(result.code, 0, JSON.stringify(result))
      const receipt = result.data.nodes.find(
        (node: any) => node.nodeKey === 'signoff',
      )!
      const signed = await review('/vou/sale-signoff/approve', {
        documentId: receipt.documentId,
        submissionId: receipt.submissionId,
        expectedRevision: receipt.revision,
      })
      assert.equal(signed.code, 0, JSON.stringify(signed))
      const inventory = await post('/vou/inventory-count/book-balance', {
        warehouseId: payload.warehouse.objectId,
        businessDate: '2026-09-04',
        page: 1,
        pageSize: 20,
      })
      assert.equal(inventory.code, 0, JSON.stringify(inventory))
      assert.equal(inventory.data.items[0].bookQuantity, '120.00000000')
      const root = instance.nodes.find((node: any) => node.nodeKey === 'root')!
      const continuation = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'again',
        requestKey: 'signoff-release-next-40',
      })
      assert.equal(continuation.code, 0, JSON.stringify(continuation))
      const next = continuation.data.nodes.find(
        (node: any) => node.nodeKey === 'again',
      )!
      const shipped = await review('/vou/sale-outbound/approve', {
        documentId: next.documentId,
        submissionId: next.submissionId,
        expectedRevision: next.revision,
      })
      assert.equal(shipped.code, 0, JSON.stringify(shipped))
      const extra = await post('/wfl/process-instance/action', {
        processId: instance.processId,
        nodeId: root.nodeId,
        action: 'CREATE_CHILD',
        targetNodeKey: 'extra',
        requestKey: 'signoff-release-excess-1',
      })
      assert.equal(extra.errorKey, 'vou_source_line_quantity_exceeded')
      const finalInventory = await post('/vou/inventory-count/book-balance', {
        warehouseId: payload.warehouse.objectId,
        businessDate: '2026-09-05',
        page: 1,
        pageSize: 20,
      })
      assert.equal(finalInventory.code, 0, JSON.stringify(finalInventory))
      assert.equal(finalInventory.data.items[0].bookQuantity, '80.00000000')
      const monthSource = await post('/vou/intermediary-calculation/source', {
        businessDate: '2026-09-30',
      })
      assert.equal(monthSource.code, 0, JSON.stringify(monthSource))
      assert.deepEqual(monthSource.data.source.lines, [])
      assert.deepEqual(monthSource.data.source.bills, [])
      const monthScript = await post(
        '/vou/intermediary-calculation/script-save',
        {
          expectedRevision: null,
          name: '隔离空来源月度处理',
          source: 'globalThis.calculate=()=>({lines:[],summaries:[]})',
        },
      )
      assert.equal(monthScript.code, 0, JSON.stringify(monthScript))
      const monthlyId = ulid(),
        monthlySubmission = ulid()
      const monthly = await post('/vou/intermediary-calculation/submit-new', {
        documentId: monthlyId,
        submissionId: monthlySubmission,
        idempotencyKey: monthlySubmission,
        expectedRevision: null,
        payload: {
          businessDate: '2026-09-30',
          currency: 'CNY',
          attachments: [],
          intermediaryCalculation: {
            ...monthSource.data,
            script: monthScript.data,
            result: { lines: [], summaries: [] },
          },
        },
      })
      assert.equal(monthly.code, 0, JSON.stringify(monthly))
      const monthlyApproved = await review(
        '/vou/intermediary-calculation/approve',
        {
          documentId: monthlyId,
          submissionId: monthlySubmission,
          expectedRevision: monthly.data.revision,
        },
      )
      assert.equal(monthlyApproved.code, 0, JSON.stringify(monthlyApproved))
      const locked = await review('/acc/period/lock', {
        bookId,
        month: '2026-09',
        expectedRevision: null,
      })
      assert.equal(locked.code, 0, JSON.stringify(locked))
      assert.equal(locked.data.locked, true)
      const periods = await post('/acc/period/query', { bookId })
      assert.equal(periods.code, 0, JSON.stringify(periods))
      assert.equal(
        periods.data.find((period: any) => period.month === '2026-09').locked,
        true,
      )
      const unchanged = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(unchanged.data.payload, accepted.data.payload)
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})
