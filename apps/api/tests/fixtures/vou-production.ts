import type { Kysely } from 'kysely'
import { ulid } from 'ulid'
import type { ProductData, VouPayloadFor, VouEntity } from '@zerp/model'
import type { DB } from '../../src/db/generated.ts'
import { AuxService } from '../../src/aux/service.ts'
import { BobArchiveService } from '../../src/bob/archives.ts'
import { seedOrderListFixture } from './vou-orders.ts'

export async function seedProductionFixture(
  db: Kysely<DB>,
  saleCount = 0,
  entities: readonly VouEntity[] = ['sale-order', 'purchase-order'],
) {
  const fixture = await seedOrderListFixture(db, saleCount, entities)
  const actor = {
      id: fixture.submitter.userId,
      permissions: ['/aux/product-type/create', '/aux/product-type/get'],
      trusted: true,
    },
    reviewer = { ...actor, id: fixture.reviewer.userId }
  const aux = new AuxService(db),
    bob = new BobArchiveService(db)
  const rawId = fixture.references.archiveSubjectIds[1]!
  const raw = await bob.get('product', rawId, actor)
  const rawData = raw.snapshot as unknown as ProductData
  const createdType = await aux.create(
    'product-type',
    {
      name: '生产固定配方成品',
      behaviorProfile: 'STANDARD_FINISHED',
      description: '',
    },
    actor,
  )
  const type = await aux.get('product-type', { id: createdType.id }, actor)
  const productId = ulid(),
    approvalEntryId = ulid()
  const quantity = {
    enteredQuantity: '1',
    enteredUnit: rawData.defaultInputUnit,
    baseQuantity: '1',
  }
  const snapshot = {
    ...raw.snapshot,
    name: '生产成品',
    productType: {
      id: type.id,
      code: type.code,
      name: type.name,
      behaviorProfile: 'STANDARD_FINISHED',
    },
    fixedFormula: {
      output: quantity,
      components: [
        {
          material: {
            objectId: rawId,
            approvalEntryId: raw.submissionId,
            selectionOrigin: 'CURRENT',
            code: raw.code,
            name: rawData.name,
          },
          quantity,
          resolutionStatus: 'CURRENT',
          requiresConfirmation: false,
        },
      ],
    },
  }
  const pending = await bob.submit(
    'product',
    'submit-new',
    {
      subjectId: productId,
      submissionId: approvalEntryId,
      idempotencyKey: approvalEntryId,
      expectedLatestApprovedSubmissionId: null,
      expectedLatestApprovedRevision: null,
      snapshot,
    },
    actor,
    'production-fixture',
  )
  await bob.review(
    'product',
    'approve',
    {
      subjectId: productId,
      submissionId: approvalEntryId,
      expectedRevision: pending.revision,
    },
    reviewer,
    'production-fixture',
  )
  const unit = fixture.references.unitSnapshot
  const formula = {
    sourceType: 'PRODUCT_FIXED' as const,
    output: { ...quantity, enteredUnit: unit },
    components: [
      {
        material: { objectId: rawId },
        quantity: { ...quantity, enteredUnit: unit },
      },
    ],
  }
  const payload: VouPayloadFor<'self-production'> = {
    businessDate: '2026-09-09',
    currency: '',
    attachments: [],
    materialWarehouse: fixture.salePayload.warehouse,
    finishedWarehouse: fixture.salePayload.warehouse,
    productionLines: [
      {
        product: { objectId: productId },
        enteredQuantity: '2',
        enteredUnit: { objectId: unit.objectId },
        baseQuantity: '2',
        lossRate: '0',
        materials: [
          {
            formulaLineNo: 1,
            actualMaterial: { objectId: rawId },
            actualEnteredQuantity: '2',
            actualEnteredUnit: { objectId: unit.objectId },
            actualBaseQuantity: '2',
          },
        ],
      },
    ],
  }
  return {
    ...fixture,
    actor,
    reviewerActor: reviewer,
    aux,
    bob,
    rawId,
    productId,
    approvalEntryId,
    formula,
    productionPayload: payload,
  }
}
