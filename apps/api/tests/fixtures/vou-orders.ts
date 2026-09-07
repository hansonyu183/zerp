import { randomBytes } from 'node:crypto'
import type { Kysely } from 'kysely'
import { ulid } from 'ulid'
import type { VouPayloadFor } from '@zerp/model'
import type { DB } from '../../src/db/generated.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import { AuxService } from '../../src/aux/service.ts'
import { BobArchiveService } from '../../src/bob/archives.ts'
import { VouService } from '../../src/vou/service.ts'
import {
  saleOrderPayload,
  seedSaleOrderReferences,
} from '../integration/wfl-fixture.ts'

export async function seedOrderListFixture(db: Kysely<DB>, saleCount = 21) {
  const bootstrap = new TargetBootstrapService(db)
  const paths = ['sale-order', 'purchase-order'].flatMap((entity) =>
    [
      'query',
      'get',
      'approve',
      'reject',
      'unreject',
      'unapprove',
      'audit-history',
    ].map((action) => `/vou/${entity}/${action}`),
  )
  paths.push('/bob/reference/query')
  const password = randomBytes(24).toString('base64url')
  const passwordHash = await hashPassword(password)
  async function principal(actions: readonly string[]) {
    const user = {
      userId: ulid(),
      roleId: ulid(),
      username: `orders-${ulid()}`,
      passwordHash,
      password,
    }
    await bootstrap.createE2EPrincipal(user, false, actions)
    return user
  }
  const submitter = await principal(paths),
    reviewer = await principal(paths),
    noQuery = await principal([
      '/vou/sale-order/approve',
      '/bob/reference/query',
    ])
  const bob = new BobArchiveService(db)
  const references = await seedSaleOrderReferences(
    bob,
    new AuxService(db),
    submitter.userId,
    reviewer.userId,
  )
  const actor = { id: submitter.userId, permissions: paths, trusted: true }
  const reviewerActor = { ...actor, id: reviewer.userId }
  const vou = new VouService(db, {
    acc: {
      async apply() {},
      async partyBalance() {
        return 0n
      },
      async customerCreditOccupancy() {
        return 0n
      },
    },
    wfl: { async apply() {} },
  })
  const supplierId = ulid(),
    supplierEntryId = ulid()
  const supplierInput = {
    subjectId: supplierId,
    submissionId: supplierEntryId,
    idempotencyKey: supplierEntryId,
    expectedLatestApprovedSubmissionId: null,
    expectedLatestApprovedRevision: null,
    snapshot: {
      identityKind: 'ORGANIZATION',
      legalName: '订单测试供应商',
      displayName: '订单测试供应商',
      legalIdentifier: `ORD-${supplierId}`,
      contactName: '',
      phone: '',
      address: '',
      operatingEntities: [],
      defaultOperatingEntityId: null,
      remark: '',
      settlementMethod: null,
      defaultPurchaser: null,
    },
  }
  const supplier = await bob.submit(
    'supplier',
    'submit-new',
    supplierInput,
    actor,
    'orders-fixture',
  )
  await bob.review(
    'supplier',
    'approve',
    {
      subjectId: supplierId,
      submissionId: supplierEntryId,
      expectedRevision: supplier.revision,
    },
    reviewerActor,
    'orders-fixture',
  )
  const salePayload = saleOrderPayload(
    references,
  ) as VouPayloadFor<'sale-order'>
  const purchasePayload: VouPayloadFor<'purchase-order'> = {
    businessDate: salePayload.businessDate,
    currency: 'CNY',
    attachments: [],
    supplier: {
      objectId: supplierId,
      approvalEntryId: supplierEntryId,
      selectionOrigin: 'CURRENT',
    },
    purchaser: salePayload.salesperson,
    warehouse: salePayload.warehouse,
    productLines: salePayload.productLines,
    remark: '采购完整备注',
  }
  const sales = []
  for (let index = 0; index < saleCount; index++) {
    const documentId = ulid(),
      submissionId = ulid()
    sales.push(
      await vou.submit(
        'sale-order',
        'submit-new',
        {
          documentId,
          submissionId,
          idempotencyKey: submissionId,
          expectedRevision: null,
          payload: { ...salePayload, remark: `销售完整备注 ${index + 1}` },
        },
        actor,
        'orders-fixture',
      ),
    )
  }
  const documentId = ulid(),
    submissionId = ulid()
  const purchase = await vou.submit(
    'purchase-order',
    'submit-new',
    {
      documentId,
      submissionId,
      idempotencyKey: submissionId,
      expectedRevision: null,
      payload: purchasePayload,
    },
    actor,
    'orders-fixture',
  )
  return {
    submitter,
    reviewer,
    noQuery,
    vou,
    sales,
    purchase,
    salePayload,
    supplierId,
  }
}
