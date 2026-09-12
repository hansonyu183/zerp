import type { Kysely } from 'kysely'
import { ulid } from 'ulid'
import type { DB } from '../../src/db/generated.ts'
import { AccService } from '../../src/acc/service.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import { VouService } from '../../src/vou/service.ts'
import { seedProductionFixture } from './vou-production.ts'

export async function seedStockFixture(db: Kysely<DB>) {
  const fixture = await seedProductionFixture(db, 0, [
    'sale-order',
    'purchase-order',
    'self-production',
    'order-production',
    'inventory-count',
  ])
  const actor = {
    ...fixture.actor,
    permissions: [...fixture.actor.permissions, '/acc/mapping/save'],
  }
  const acc = new AccService(db),
    mappings = new AccMappingCatalogService(db)
  await acc.syncVouEntityCatalog()
  const book = await acc.createBook(
    {
      id: ulid(),
      name: '库存控制账簿',
      description: '',
      startMonth: '2026-09',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [fixture.reviewer.userId],
      operateUserIds: [fixture.reviewer.userId],
    },
    actor,
  )
  const subject = await acc.createSubject(
    {
      id: ulid(),
      bookId: book.id,
      code: '1405',
      name: '库存数量',
      parentId: null,
      balanceDirection: 'DEBIT',
      enabled: true,
      requiredDimensions: ['PRODUCT', 'WAREHOUSE'],
      inventoryQuantity: true,
      settlementPurpose: 'NONE',
    },
    actor,
  )
  const equity = await acc.createSubject(
    {
      id: ulid(),
      bookId: book.id,
      code: '4001',
      name: '期初权益',
      parentId: null,
      balanceDirection: 'CREDIT',
      enabled: true,
      requiredDimensions: [],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    },
    actor,
  )
  const openings = new VouOpeningService(db, acc),
    openingId = ulid()
  const opening = await openings.submitOpening(
    {
      bookId: book.id,
      submissionId: openingId,
      idempotencyKey: openingId,
      lines: [
        {
          subjectId: subject.id,
          currency: 'CNY',
          direction: 'DEBIT',
          amount: '10.00',
          quantity: '10',
          dimensions: {
            PRODUCT: fixture.rawId,
            WAREHOUSE: fixture.salePayload.warehouse.objectId,
          },
        },
        {
          subjectId: equity.id,
          currency: 'CNY',
          direction: 'CREDIT',
          amount: '10.00',
          dimensions: {},
        },
      ],
      assets: [],
      bills: [],
      containers: [],
    },
    actor,
    'stock-opening',
  )
  await openings.reviewOpening(
    'approve',
    {
      bookId: book.id,
      submissionId: openingId,
      expectedRevision: opening.approval.revision,
    },
    fixture.reviewerActor,
    'stock-opening',
  )
  const catalog = await mappings.catalog(actor)
  const quantityMapping = async (entity: string) =>
    mappings.save(
      {
        bookId: book.id,
        vouEntity: entity,
        expectedRevision: null,
        defaultResult: 'POST',
        definition: {
          defaultTemplateId: 'quantity',
          rules: [],
          templates: [
            {
              templateId: 'quantity',
              collection: 'inventoryMovements',
              lines: [
                {
                  subjectSource: 'FIXED',
                  subjectValue: subject.id,
                  direction: 'DEBIT',
                  amountField: 'line.amount',
                  currencyField: 'line.currency',
                  quantityField: 'line.quantity',
                  dimensions: {
                    PRODUCT: 'line.productId',
                    WAREHOUSE: 'line.warehouseId',
                  },
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
                {
                  subjectSource: 'FIXED',
                  subjectValue: equity.id,
                  direction: 'CREDIT',
                  amountField: 'line.amount',
                  currencyField: 'line.currency',
                  quantityField: null,
                  dimensions: {},
                  costCounterpartSubjectId: null,
                  costCounterpartDimensions: {},
                },
              ],
            },
          ],
          assetConfiguration: null,
        },
      },
      actor,
    )
  const vou = new VouService(db, { acc, wfl: { async apply() {} } })
  return {
    ...fixture,
    actor,
    acc,
    mappings,
    book,
    subject,
    catalog,
    quantityMapping,
    vou,
  }
}
