import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'
import { VouService } from '../../src/vou/service.ts'
import { WflService, type WflVouPort } from '../../src/wfl/service.ts'
import { seedStockFixture } from '../fixtures/vou-stock.ts'
import {
  purchaseClients,
  withCommittedPurchaseDatabase,
} from '../fixtures/vou-purchase-http.ts'

// Synthetic source identity. No real source snapshot or trial installation is written.
test('ordinary users adopt a prior sales order with original quantities and stable source identity', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const f = await seedStockFixture(
      db,
      '2026-09',
      { quantity: '100', amount: '100.00' },
      false,
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
    const { post, review } = await purchaseClients(db, f, undefined, {
      vou,
      wfl,
      acc: f.acc,
    })
    try {
      const documentId = ulid(),
        submissionId = ulid()
      const fact = {
        sourceClosed: false,
        sourceInstanceId: 'synthetic-prior-sales',
        sourceSchema: 'synthetic',
        sourceDocumentType: 'BB',
        sourceDocumentKey: 'sale-order-100',
        sourceDocumentNo: 'SYNTHETIC-BB-100',
        capturedAt: '2026-09-05T12:00:00.123456Z',
        snapshotDigest: 'a'.repeat(64),
      }
      const input = {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...f.salePayload,
          priorFact: fact,
          productLines: [
            {
              ...f.salePayload.productLines[0]!,
              lineId: ulid(),
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      }
      const submitted = await post('/vou/sale-order/submit-new', input)
      assert.equal(submitted.code, 0, JSON.stringify(submitted))
      const repeat = await post('/vou/sale-order/submit-new', input)
      assert.deepEqual(repeat.data, submitted.data)
      const approved = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: submitted.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const read = await post('/vou/sale-order/get', { documentId })
      assert.equal(read.code, 0, JSON.stringify(read))
      assert.deepEqual(read.data.payload.priorFact, fact)
      assert.equal(read.data.payload.productLines[0].baseQuantity, '100.000000')
      const opening = await f.openings.getOpening(f.book.id, f.actor)
      assert.equal(opening.approval.status, 'PENDING')
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

test('ordinary users preserve a prior outbound as a distinct component of the same original order', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const f = await seedStockFixture(
      db,
      '2026-09',
      { quantity: '100', amount: '100.00' },
      false,
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
    const bootstrap = new (
      await import('../../src/app/bootstrap.ts')
    ).TargetBootstrapService(db)
    const paths = ['sale-order', 'sale-outbound'].flatMap((entity) =>
      ['submit-new', 'submit-change', 'approve', 'get', 'query'].map(
        (action) => `/vou/${entity}/${action}`,
      ),
    )
    const password = `PriorSale!Aa1${ulid()}`
    const passwordHash = await (
      await import('../../src/app/session.ts')
    ).hashPassword(password)
    const makeUser = async () => {
      const user = {
        userId: ulid(),
        roleId: ulid(),
        username: `prior-sale-${ulid()}`,
        passwordHash,
        password,
      }
      await bootstrap.createE2EPrincipal(user, false, paths)
      return user
    }
    const submitter = await makeUser(),
      reviewer = await makeUser()
    const { post, review } = await purchaseClients(
      db,
      { ...f, submitter, reviewer },
      undefined,
      { vou, wfl, acc: f.acc },
    )
    try {
      const documentId = ulid(),
        submissionId = ulid()
      const fact = {
        sourceClosed: false,
        sourceInstanceId: 'synthetic-prior-sales',
        sourceSchema: 'synthetic',
        sourceDocumentType: 'BB',
        sourceDocumentKey: 'sale-order-100',
        sourceDocumentNo: 'SYNTHETIC-BB-100',
        capturedAt: '2026-09-05T12:00:00.123456Z',
        snapshotDigest: 'a'.repeat(64),
      }
      const input = {
        documentId,
        submissionId,
        idempotencyKey: submissionId,
        expectedRevision: null,
        payload: {
          ...f.salePayload,
          priorFact: fact,
          productLines: [
            {
              ...f.salePayload.productLines[0]!,
              lineId: ulid(),
              enteredQuantity: '100',
              baseQuantity: '100',
            },
          ],
        },
      }
      const submitted = await post('/vou/sale-order/submit-new', input)
      assert.equal(submitted.code, 0, JSON.stringify(submitted))
      const repeat = await post('/vou/sale-order/submit-new', input)
      assert.deepEqual(repeat.data, submitted.data)
      const approved = await review('/vou/sale-order/approve', {
        documentId,
        submissionId,
        expectedRevision: submitted.data.revision,
      })
      assert.equal(approved.code, 0, JSON.stringify(approved))
      const read = await post('/vou/sale-order/get', { documentId })
      assert.equal(read.code, 0, JSON.stringify(read))
      assert.deepEqual(read.data.payload.priorFact, fact)
      assert.equal(read.data.payload.productLines[0].baseQuantity, '100.000000')
      const outboundId = ulid(),
        outboundSubmission = ulid()
      const outboundInput = {
        documentId: outboundId,
        submissionId: outboundSubmission,
        idempotencyKey: outboundSubmission,
        expectedRevision: null,
        payload: {
          businessDate: '2026-09-04',
          currency: 'CNY',
          attachments: [],
          priorFact: fact,
          parentEntity: 'sale-order',
          parentDocumentId: documentId,
          sourceLines: [
            {
              sourceLineId: input.payload.productLines[0]!.lineId,
              baseQuantity: '100',
            },
          ],
        },
      }
      const dispatched = await post(
        '/vou/sale-outbound/submit-new',
        outboundInput,
      )
      assert.equal(dispatched.code, 0, JSON.stringify(dispatched))
      const outboundApproved = await review('/vou/sale-outbound/approve', {
        documentId: outboundId,
        submissionId: outboundSubmission,
        expectedRevision: dispatched.data.revision,
      })
      assert.equal(outboundApproved.code, 0, JSON.stringify(outboundApproved))
      const outboundRead = await post('/vou/sale-outbound/get', {
        documentId: outboundId,
      })
      assert.equal(outboundRead.code, 0, JSON.stringify(outboundRead))
      assert.deepEqual(outboundRead.data.payload.priorFact, fact)
      assert.equal(
        outboundRead.data.payload.sourceLines[0].baseQuantity,
        '100.000000',
      )
      assert.equal(outboundRead.data.payload.parentDocumentId, documentId)
      const orderRead = await post('/vou/sale-order/get', { documentId })
      assert.deepEqual(orderRead.data, approved.data)
      const opening = await f.openings.getOpening(f.book.id, f.actor)
      assert.equal(opening.approval.status, 'PENDING')
    } finally {
      await post('/session/auth/signout', {})
      await review('/session/auth/signout', {})
    }
  })
})

for (const { knownLoss, negative } of [
  { knownLoss: true, negative: false },
  { knownLoss: false, negative: false },
  { knownLoss: true, negative: true },
])
  test(
    negative
      ? 'closed prior negative sales chain preserves original signs without new stock or accounting effects'
      : knownLoss
        ? 'prior partial signoff preserves forty unresolved units without inventing a delivery or loss'
        : 'unknown prior loss remains null and does not become proven transit',
    async () => {
      await withCommittedPurchaseDatabase(async (db) => {
        const f = await seedStockFixture(
          db,
          '2026-09',
          { quantity: '100', amount: '100.00' },
          false,
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
        const bootstrap = new (
          await import('../../src/app/bootstrap.ts')
        ).TargetBootstrapService(db)
        const paths = ['sale-order', 'sale-outbound', 'sale-signoff'].flatMap(
          (entity) =>
            ['submit-new', 'submit-change', 'approve', 'get', 'query'].map(
              (action) => `/vou/${entity}/${action}`,
            ),
        )
        const password = `PriorSale!Aa1${ulid()}`
        const passwordHash = await (
          await import('../../src/app/session.ts')
        ).hashPassword(password)
        const makeUser = async () => {
          const user = {
            userId: ulid(),
            roleId: ulid(),
            username: `prior-sale-${ulid()}`,
            passwordHash,
            password,
          }
          await bootstrap.createE2EPrincipal(user, false, paths)
          return user
        }
        const submitter = await makeUser(),
          reviewer = await makeUser()
        const { post, review } = await purchaseClients(
          db,
          { ...f, submitter, reviewer },
          undefined,
          { vou, wfl, acc: f.acc },
        )
        try {
          const documentId = ulid(),
            submissionId = ulid()
          const fact = {
            sourceClosed: negative,
            sourceInstanceId: 'synthetic-prior-sales',
            sourceSchema: 'synthetic',
            sourceDocumentType: 'BB',
            sourceDocumentKey: 'sale-order-100',
            sourceDocumentNo: 'SYNTHETIC-BB-100',
            capturedAt: '2026-09-05T12:00:00.123456Z',
            snapshotDigest: 'a'.repeat(64),
          }
          const input = {
            documentId,
            submissionId,
            idempotencyKey: submissionId,
            expectedRevision: null,
            payload: {
              ...f.salePayload,
              priorFact: fact,
              productLines: [
                {
                  ...f.salePayload.productLines[0]!,
                  lineId: ulid(),
                  enteredQuantity: negative ? '-10' : '100',
                  baseQuantity: negative ? '-10' : '100',
                },
              ],
            },
          }
          const submitted = await post('/vou/sale-order/submit-new', input)
          assert.equal(submitted.code, 0, JSON.stringify(submitted))
          const repeat = await post('/vou/sale-order/submit-new', input)
          assert.deepEqual(repeat.data, submitted.data)
          const approved = await review('/vou/sale-order/approve', {
            documentId,
            submissionId,
            expectedRevision: submitted.data.revision,
          })
          assert.equal(approved.code, 0, JSON.stringify(approved))
          const read = await post('/vou/sale-order/get', { documentId })
          assert.equal(read.code, 0, JSON.stringify(read))
          assert.deepEqual(read.data.payload.priorFact, fact)
          assert.equal(
            read.data.payload.productLines[0].baseQuantity,
            negative ? '-10.000000' : '100.000000',
          )
          const outboundId = ulid(),
            outboundSubmission = ulid()
          const outboundInput = {
            documentId: outboundId,
            submissionId: outboundSubmission,
            idempotencyKey: outboundSubmission,
            expectedRevision: null,
            payload: {
              businessDate: '2026-09-04',
              currency: 'CNY',
              attachments: [],
              priorFact: fact,
              parentEntity: 'sale-order',
              parentDocumentId: documentId,
              sourceLines: [
                {
                  sourceLineId: input.payload.productLines[0]!.lineId,
                  baseQuantity: negative ? '-10' : '100',
                },
              ],
            },
          }
          if (negative) {
            for (const quantity of ['10', '-9']) {
              const invalidId = ulid(),
                invalidSubmissionId = ulid()
              const invalid = await post('/vou/sale-outbound/submit-new', {
                ...outboundInput,
                documentId: invalidId,
                submissionId: invalidSubmissionId,
                idempotencyKey: invalidSubmissionId,
                payload: {
                  ...outboundInput.payload,
                  sourceLines: [
                    {
                      ...outboundInput.payload.sourceLines[0]!,
                      baseQuantity: quantity,
                    },
                  ],
                },
              })
              assert.notEqual(
                invalid.code,
                0,
                'a closed negative original cannot acquire an opposite or partial outbound',
              )
            }
          }
          const dispatched = await post(
            '/vou/sale-outbound/submit-new',
            outboundInput,
          )
          assert.equal(dispatched.code, 0, JSON.stringify(dispatched))
          const outboundApproved = await review('/vou/sale-outbound/approve', {
            documentId: outboundId,
            submissionId: outboundSubmission,
            expectedRevision: dispatched.data.revision,
          })
          assert.equal(
            outboundApproved.code,
            0,
            JSON.stringify(outboundApproved),
          )
          const outboundRead = await post('/vou/sale-outbound/get', {
            documentId: outboundId,
          })
          assert.equal(outboundRead.code, 0, JSON.stringify(outboundRead))
          assert.deepEqual(outboundRead.data.payload.priorFact, fact)
          assert.equal(
            outboundRead.data.payload.sourceLines[0].baseQuantity,
            negative ? '-10.000000' : '100.000000',
          )
          assert.equal(outboundRead.data.payload.parentDocumentId, documentId)
          const signoffId = ulid(),
            signoffSubmission = ulid()
          const signoffFact = {
            ...fact,
            sourceClosed: false,
            sourceDocumentType: 'BA',
            sourceDocumentKey: 'signed-60',
            sourceDocumentNo: 'SYNTHETIC-BA-60',
          }
          const signed = await post('/vou/sale-signoff/submit-new', {
            documentId: signoffId,
            submissionId: signoffSubmission,
            idempotencyKey: signoffSubmission,
            expectedRevision: null,
            payload: {
              businessDate: '2026-09-04',
              currency: 'CNY',
              attachments: [],
              priorFact: signoffFact,
              parentEntity: 'sale-outbound',
              parentDocumentId: outboundId,
              customer: f.salePayload.customer,
              expectedSolventContainers: 0,
              expectedResinContainers: 0,
              returnedSolventContainers: 0,
              returnedResinContainers: 0,
              signoffLines: [
                {
                  sourceLineId: input.payload.productLines[0]!.lineId,
                  signedBaseQuantity: negative ? '-10' : '60',
                  rejectedBaseQuantity: '0',
                  ...(knownLoss ? { lostBaseQuantity: '0' } : {}),
                },
              ],
            },
          })
          assert.equal(signed.code, 0, JSON.stringify(signed))
          const signoffApproved = await review('/vou/sale-signoff/approve', {
            documentId: signoffId,
            submissionId: signoffSubmission,
            expectedRevision: signed.data.revision,
          })
          assert.equal(signoffApproved.code, 0, JSON.stringify(signoffApproved))
          const signoffRead = await post('/vou/sale-signoff/get', {
            documentId: signoffId,
          })
          assert.equal(signoffRead.code, 0, JSON.stringify(signoffRead))
          assert.deepEqual(signoffRead.data.payload.priorFact, signoffFact)
          assert.equal(signoffRead.data.payload.parentEntity, 'sale-outbound')
          assert.equal(
            signoffRead.data.payload.signoffLines[0].signedBaseQuantity,
            negative ? '-10.000000' : '60.000000',
          )
          assert.equal(
            signoffRead.data.payload.signoffLines[0].lostBaseQuantity,
            knownLoss ? '0.000000' : undefined,
          )
          assert.deepEqual(signoffRead.data.priorSaleDisposition, [
            {
              sourceLineId: input.payload.productLines[0]!.lineId,
              dispatchedBaseQuantity: negative ? '-10.000000' : '100.000000',
              signedBaseQuantity: negative ? '-10.000000' : '60.000000',
              rejectedBaseQuantity: '0.000000',
              lostBaseQuantity: knownLoss ? '0.000000' : null,
              unresolvedBaseQuantity: negative ? '0.000000' : '40.000000',
              inTransitBaseQuantity: knownLoss
                ? negative
                  ? '0.000000'
                  : '40.000000'
                : null,
            },
          ])
          const orderRead = await post('/vou/sale-order/get', { documentId })
          assert.deepEqual(orderRead.data, approved.data)
          const opening = await f.openings.getOpening(f.book.id, f.actor)
          assert.equal(opening.approval.status, 'PENDING')
          if (negative) {
            const rootSource = await post(
              `/vou/sale-order/prior-sale-continuation?documentId=${documentId}&businessDate=2026-09-06`,
              {},
              'GET',
            )
            assert.equal(rootSource.code, 0, JSON.stringify(rootSource))
            assert.equal(rootSource.data, null)
            for (const table of [
              'acc_journal_entries',
              'acc_inventory_entries',
            ] as const) {
              const count = await db
                .selectFrom(table)
                .select((eb) => eb.fn.countAll<string>().as('count'))
                .executeTakeFirstOrThrow()
              assert.equal(count.count, '0')
            }
          }
        } finally {
          await post('/session/auth/signout', {})
          await review('/session/auth/signout', {})
        }
      })
    },
  )

test('after opening ordinary delivery and signoff continue only forty without replaying outbound', async () => {
  await withCommittedPurchaseDatabase(async (db, databaseUrl) => {
    const knownLoss = true
    const f = await seedStockFixture(
      db,
      '2026-09',
      { quantity: '100', amount: '100.00' },
      false,
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
    const bootstrap = new (
      await import('../../src/app/bootstrap.ts')
    ).TargetBootstrapService(db)
    const pg = (await import('pg')).default
    const { RptService, PgRptDefinitionValidator } =
      await import('../../src/rpt/service.ts')
    const pool = new pg.Pool({ connectionString: databaseUrl })
    try {
      const rpt = new RptService(db, new PgRptDefinitionValidator(pool, db))
      const report = await rpt.save(
        {
          subjectId: ulid(),
          expectedRevision: null,
          name: '合成此前销售科目流水',
          description: '',
          enabled: true,
          sql: `SELECT subject.code::text AS subject_code, line.direction::text AS direction, line.amount::numeric AS amount
        FROM acc_journal_entries journal JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
        JOIN acc_subjects subject ON subject.id = line.subject_id WHERE journal.book_id = :bookId
        ORDER BY journal.business_date, journal.id, line.id`,
          parameters: [
            {
              key: 'bookId',
              name: '账簿',
              type: 'REFERENCE',
              referenceType: 'ACCOUNTING_BOOK',
              required: true,
            },
          ],
          columns: [
            {
              alias: 'subject_code',
              name: '科目',
              order: 1,
              type: 'TEXT',
              width: 100,
              visible: true,
            },
            {
              alias: 'direction',
              name: '方向',
              order: 2,
              type: 'TEXT',
              width: 100,
              visible: true,
            },
            {
              alias: 'amount',
              name: '金额',
              order: 3,
              type: 'DECIMAL',
              width: 100,
              visible: true,
            },
          ],
        },
        {
          ...f.actor,
          permissions: [...f.actor.permissions, '/rpt/definition/save'],
        },
        'synthetic-prior-sales-report',
      )
      const receivable = await f.acc.createSubject(
        {
          id: ulid(),
          bookId: f.book.id,
          code: '1122',
          name: '合成应收',
          parentId: null,
          balanceDirection: 'DEBIT',
          enabled: true,
          requiredDimensions: ['CUSTOMER'],
          inventoryQuantity: false,
          settlementPurpose: 'RECEIVABLE',
        },
        f.actor,
      )
      for (const entity of ['sale-order', 'sale-delivery'])
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
      await f.quantityMapping('sale-outbound', f.equity.id)
      await f.mappings.save(
        {
          bookId: f.book.id,
          vouEntity: 'sale-signoff',
          expectedRevision: null,
          defaultResult: 'POST',
          definition: {
            defaultTemplateId: 'settlement',
            rules: [],
            assetConfiguration: null,
            templates: [
              {
                templateId: 'settlement',
                collection: 'settlementMovements',
                lines: [
                  {
                    subjectSource: 'FIXED',
                    subjectValue: receivable.id,
                    direction: 'DEBIT',
                    amountField: 'line.amount',
                    currencyField: 'line.currency',
                    quantityField: null,
                    dimensions: { CUSTOMER: 'line.counterpartyId' },
                    costCounterpartSubjectId: null,
                    costCounterpartDimensions: {},
                  },
                  {
                    subjectSource: 'FIXED',
                    subjectValue: f.equity.id,
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
          },
        },
        f.actor,
      )
      const paths = [
        'sale-order',
        'sale-outbound',
        'sale-delivery',
        'sale-signoff',
      ]
        .flatMap((entity) =>
          ['submit-new', 'submit-change', 'approve', 'get', 'query'].map(
            (action) => `/vou/${entity}/${action}`,
          ),
        )
        .concat([
          '/vou/opening/approve',
          '/vou/opening/get',
          '/vou/inventory-count/book-balance',
          `/rpt/${report.code}/query`,
        ])
      const password = `PriorSale!Aa1${ulid()}`
      const passwordHash = await (
        await import('../../src/app/session.ts')
      ).hashPassword(password)
      const makeUser = async () => {
        const user = {
          userId: ulid(),
          roleId: ulid(),
          username: `prior-sale-${ulid()}`,
          passwordHash,
          password,
        }
        await bootstrap.createE2EPrincipal(user, false, paths)
        return user
      }
      const submitter = await makeUser(),
        reviewer = await makeUser()
      const book = await f.acc.getBook(f.book.id, f.actor)
      await f.acc.saveBook(
        {
          id: book.id,
          expectedRevision: book.revision,
          name: book.name,
          description: book.description,
          baseCurrency: book.baseCurrency,
          queryUserIds: [
            ...book.queryUserIds,
            submitter.userId,
            reviewer.userId,
          ],
          operateUserIds: [
            ...book.operateUserIds,
            submitter.userId,
            reviewer.userId,
          ],
        },
        f.actor,
      )
      const { post, review } = await purchaseClients(
        db,
        { ...f, submitter, reviewer },
        undefined,
        { vou, wfl, acc: f.acc, rpt },
      )
      try {
        const documentId = ulid(),
          submissionId = ulid()
        const fact = {
          sourceClosed: false,
          sourceInstanceId: 'synthetic-prior-sales',
          sourceSchema: 'synthetic',
          sourceDocumentType: 'BB',
          sourceDocumentKey: 'sale-order-100',
          sourceDocumentNo: 'SYNTHETIC-BB-100',
          capturedAt: '2026-09-05T12:00:00.123456Z',
          snapshotDigest: 'a'.repeat(64),
        }
        const input = {
          documentId,
          submissionId,
          idempotencyKey: submissionId,
          expectedRevision: null,
          payload: {
            ...f.salePayload,
            priorFact: fact,
            productLines: [
              {
                ...f.salePayload.productLines[0]!,
                lineId: ulid(),
                enteredQuantity: '100',
                baseQuantity: '100',
              },
            ],
          },
        }
        const submitted = await post('/vou/sale-order/submit-new', input)
        assert.equal(submitted.code, 0, JSON.stringify(submitted))
        const repeat = await post('/vou/sale-order/submit-new', input)
        assert.deepEqual(repeat.data, submitted.data)
        const approved = await review('/vou/sale-order/approve', {
          documentId,
          submissionId,
          expectedRevision: submitted.data.revision,
        })
        assert.equal(approved.code, 0, JSON.stringify(approved))
        const read = await post('/vou/sale-order/get', { documentId })
        assert.equal(read.code, 0, JSON.stringify(read))
        assert.deepEqual(read.data.payload.priorFact, fact)
        assert.equal(
          read.data.payload.productLines[0].baseQuantity,
          '100.000000',
        )
        const outboundId = ulid(),
          outboundSubmission = ulid()
        const outboundInput = {
          documentId: outboundId,
          submissionId: outboundSubmission,
          idempotencyKey: outboundSubmission,
          expectedRevision: null,
          payload: {
            businessDate: '2026-09-04',
            currency: 'CNY',
            attachments: [],
            priorFact: fact,
            parentEntity: 'sale-order',
            parentDocumentId: documentId,
            sourceLines: [
              {
                sourceLineId: input.payload.productLines[0]!.lineId,
                baseQuantity: '100',
              },
            ],
          },
        }
        const dispatched = await post(
          '/vou/sale-outbound/submit-new',
          outboundInput,
        )
        assert.equal(dispatched.code, 0, JSON.stringify(dispatched))
        const outboundApproved = await review('/vou/sale-outbound/approve', {
          documentId: outboundId,
          submissionId: outboundSubmission,
          expectedRevision: dispatched.data.revision,
        })
        assert.equal(outboundApproved.code, 0, JSON.stringify(outboundApproved))
        const outboundRead = await post('/vou/sale-outbound/get', {
          documentId: outboundId,
        })
        assert.equal(outboundRead.code, 0, JSON.stringify(outboundRead))
        assert.deepEqual(outboundRead.data.payload.priorFact, fact)
        assert.equal(
          outboundRead.data.payload.sourceLines[0].baseQuantity,
          '100.000000',
        )
        assert.equal(outboundRead.data.payload.parentDocumentId, documentId)
        const signoffId = ulid(),
          signoffSubmission = ulid()
        const signoffFact = {
          ...fact,
          sourceDocumentType: 'BA',
          sourceDocumentKey: 'signed-60',
          sourceDocumentNo: 'SYNTHETIC-BA-60',
        }
        const signed = await post('/vou/sale-signoff/submit-new', {
          documentId: signoffId,
          submissionId: signoffSubmission,
          idempotencyKey: signoffSubmission,
          expectedRevision: null,
          payload: {
            businessDate: '2026-09-04',
            currency: 'CNY',
            attachments: [],
            priorFact: signoffFact,
            parentEntity: 'sale-outbound',
            parentDocumentId: outboundId,
            customer: f.salePayload.customer,
            expectedSolventContainers: 0,
            expectedResinContainers: 0,
            returnedSolventContainers: 0,
            returnedResinContainers: 0,
            signoffLines: [
              {
                sourceLineId: input.payload.productLines[0]!.lineId,
                signedBaseQuantity: '60',
                rejectedBaseQuantity: '0',
                ...(knownLoss ? { lostBaseQuantity: '0' } : {}),
              },
            ],
          },
        })
        assert.equal(signed.code, 0, JSON.stringify(signed))
        const signoffApproved = await review('/vou/sale-signoff/approve', {
          documentId: signoffId,
          submissionId: signoffSubmission,
          expectedRevision: signed.data.revision,
        })
        assert.equal(signoffApproved.code, 0, JSON.stringify(signoffApproved))
        const signoffRead = await post('/vou/sale-signoff/get', {
          documentId: signoffId,
        })
        assert.equal(signoffRead.code, 0, JSON.stringify(signoffRead))
        assert.deepEqual(signoffRead.data.payload.priorFact, signoffFact)
        assert.equal(signoffRead.data.payload.parentEntity, 'sale-outbound')
        assert.equal(
          signoffRead.data.payload.signoffLines[0].signedBaseQuantity,
          '60.000000',
        )
        assert.equal(
          signoffRead.data.payload.signoffLines[0].lostBaseQuantity,
          knownLoss ? '0.000000' : undefined,
        )
        assert.deepEqual(signoffRead.data.priorSaleDisposition, [
          {
            sourceLineId: input.payload.productLines[0]!.lineId,
            dispatchedBaseQuantity: '100.000000',
            signedBaseQuantity: '60.000000',
            rejectedBaseQuantity: '0.000000',
            lostBaseQuantity: knownLoss ? '0.000000' : null,
            unresolvedBaseQuantity: '40.000000',
            inTransitBaseQuantity: knownLoss ? '40.000000' : null,
          },
        ])
        const beforeOpening = await post(`/rpt/${report.code}/query`, {
          parameters: { bookId: f.book.id },
          page: 1,
          pageSize: 20,
        })
        assert.equal(beforeOpening.code, 0, JSON.stringify(beforeOpening))
        assert.equal(beforeOpening.data.rows.length, 0)
        const prematureSubmission = ulid()
        const premature = await post('/vou/sale-delivery/submit-new', {
          documentId: ulid(),
          submissionId: prematureSubmission,
          idempotencyKey: prematureSubmission,
          expectedRevision: null,
          payload: {
            businessDate: '2026-09-06',
            currency: 'CNY',
            attachments: [],
            parentEntity: 'sale-outbound',
            parentDocumentId: outboundId,
            sourceLines: [
              {
                sourceLineId: input.payload.productLines[0]!.lineId,
                baseQuantity: '40',
              },
            ],
          },
        })
        assert.equal(
          premature.errorKey,
          'acc_period_opening_not_approved',
          JSON.stringify(premature),
        )
        const openingApproved = await review('/vou/opening/approve', {
          bookId: f.book.id,
          submissionId: f.opening.submissionId,
          expectedRevision: f.opening.approval.revision,
        })
        assert.equal(openingApproved.code, 0, JSON.stringify(openingApproved))
        const stock = async () => {
          const result = await post('/vou/inventory-count/book-balance', {
            warehouseId: f.salePayload.warehouse.objectId,
            businessDate: '2026-09-06',
            page: 1,
            pageSize: 20,
          })
          assert.equal(result.code, 0, JSON.stringify(result))
          assert.equal(
            result.data.items.find(
              (row: { product: { objectId: string } }) =>
                row.product.objectId === f.rawId,
            )?.bookQuantity,
            '100.00000000',
          )
        }
        await stock()
        const deliverySource = await post(
          `/vou/sale-outbound/prior-sale-continuation?documentId=${outboundId}&businessDate=2026-09-06`,
          {},
          'GET',
        )
        assert.equal(deliverySource.code, 0, JSON.stringify(deliverySource))
        assert.equal(deliverySource.data.entity, 'sale-delivery')
        assert.equal(
          deliverySource.data.sourceDocumentNo,
          outboundRead.data.documentNo,
        )
        assert.ok(deliverySource.data.customerName.length > 0)
        assert.ok(deliverySource.data.lines[0].productName.length > 0)
        assert.equal(deliverySource.data.payload.parentDocumentId, outboundId)
        assert.deepEqual(deliverySource.data.payload.sourceLines, [
          {
            sourceLineId: input.payload.productLines[0]!.lineId,
            baseQuantity: '40.000000',
          },
        ])
        assert.equal('priorFact' in deliverySource.data.payload, false)
        const afterPreview = await post(`/rpt/${report.code}/query`, {
          parameters: { bookId: f.book.id },
          page: 1,
          pageSize: 20,
        })
        assert.equal(afterPreview.data.rows.length, 2)
        const deliveryId = ulid(),
          deliverySubmission = ulid()
        const delivery = await post('/vou/sale-delivery/submit-new', {
          documentId: deliveryId,
          submissionId: deliverySubmission,
          idempotencyKey: deliverySubmission,
          expectedRevision: null,
          payload: deliverySource.data.payload,
        })
        assert.equal(delivery.code, 0, JSON.stringify(delivery))
        const delivered = await review('/vou/sale-delivery/approve', {
          documentId: deliveryId,
          submissionId: deliverySubmission,
          expectedRevision: delivery.data.revision,
        })
        assert.equal(delivered.code, 0, JSON.stringify(delivered))
        await stock()
        const unprovedRejection = ulid()
        const rejectedWithoutOriginalCost = await post(
          '/vou/sale-signoff/submit-new',
          {
            documentId: ulid(),
            submissionId: unprovedRejection,
            idempotencyKey: unprovedRejection,
            expectedRevision: null,
            payload: {
              businessDate: '2026-09-06',
              currency: 'CNY',
              attachments: [],
              parentEntity: 'sale-delivery',
              parentDocumentId: deliveryId,
              customer: f.salePayload.customer,
              expectedSolventContainers: 0,
              expectedResinContainers: 0,
              returnedSolventContainers: 0,
              returnedResinContainers: 0,
              signoffLines: [
                {
                  sourceLineId: input.payload.productLines[0]!.lineId,
                  signedBaseQuantity: '39',
                  rejectedBaseQuantity: '1',
                },
              ],
            },
          },
        )
        assert.equal(
          rejectedWithoutOriginalCost.errorKey,
          'acc_period_cost_source_missing',
          JSON.stringify(rejectedWithoutOriginalCost),
        )
        const signoffSource = await post(
          `/vou/sale-delivery/prior-sale-continuation?documentId=${deliveryId}&businessDate=2026-09-06`,
          {},
          'GET',
        )
        assert.equal(signoffSource.code, 0, JSON.stringify(signoffSource))
        assert.equal(signoffSource.data.entity, 'sale-signoff')
        assert.equal(
          signoffSource.data.payload.signoffLines[0].signedBaseQuantity,
          '40.000000',
        )
        assert.equal(
          signoffSource.data.payload.customer.objectId,
          f.salePayload.customer.objectId,
        )
        const finalId = ulid(),
          finalSubmission = ulid()
        const final = await post('/vou/sale-signoff/submit-new', {
          documentId: finalId,
          submissionId: finalSubmission,
          idempotencyKey: finalSubmission,
          expectedRevision: null,
          payload: signoffSource.data.payload,
        })
        assert.equal(final.code, 0, JSON.stringify(final))
        const finalApproved = await review('/vou/sale-signoff/approve', {
          documentId: finalId,
          submissionId: finalSubmission,
          expectedRevision: final.data.revision,
        })
        assert.equal(finalApproved.code, 0, JSON.stringify(finalApproved))
        const repeated = await review('/vou/sale-signoff/approve', {
          documentId: finalId,
          submissionId: finalSubmission,
          expectedRevision: final.data.revision,
        })
        assert.equal(
          repeated.errorKey,
          'approval_stale_revision',
          JSON.stringify(repeated),
        )
        await stock()
        const ledger = await post(`/rpt/${report.code}/query`, {
          parameters: { bookId: f.book.id },
          page: 1,
          pageSize: 20,
        })
        assert.equal(ledger.code, 0, JSON.stringify(ledger))
        assert.equal(ledger.data.rows.length, 4)
        const ar = ledger.data.rows.filter(
          (row: { subject_code: string }) => row.subject_code === '1122',
        )
        assert.equal(ar.length, 1)
        assert.equal(ar[0].direction, 'DEBIT')
        assert.equal(Number(ar[0].amount), 40)
        const extraSubmission = ulid()
        const extra = await post('/vou/sale-outbound/submit-new', {
          documentId: ulid(),
          submissionId: extraSubmission,
          idempotencyKey: extraSubmission,
          expectedRevision: null,
          payload: {
            businessDate: '2026-09-06',
            currency: 'CNY',
            attachments: [],
            parentEntity: 'sale-order',
            parentDocumentId: documentId,
            sourceLines: [
              {
                sourceLineId: input.payload.productLines[0]!.lineId,
                baseQuantity: '1',
              },
            ],
          },
        })
        assert.equal(
          extra.errorKey,
          'vou_source_line_quantity_exceeded',
          JSON.stringify(extra),
        )

        const orderRead = await post('/vou/sale-order/get', { documentId })
        assert.deepEqual(orderRead.data, approved.data)
        const opening = await f.openings.getOpening(f.book.id, f.actor)
        assert.equal(opening.approval.status, 'APPROVED')
      } finally {
        await post('/session/auth/signout', {})
        await review('/session/auth/signout', {})
      }
    } finally {
      await pool.end()
    }
  })
})
