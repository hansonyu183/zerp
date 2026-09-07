import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { ulid } from 'ulid'
import { sql } from 'kysely'
import { AuxApplicationError, AuxService } from '../../src/aux/service.ts'
import {
  AccApplicationError,
  AccService,
  type AccOpeningInput,
} from '../../src/acc/service.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('ACC opening adopts current warehouse and fund-account dimensions and protects their persisted references', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = randomBytes(6).toString('hex').toUpperCase()
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `acc-asset-${suffix.toLowerCase()}`,
    passwordHash: await hashPassword(randomBytes(24).toString('base64url')),
  }
  const actor = {
    id: principal.userId,
    permissions: ['operating-entity', 'warehouse', 'fund-account'].flatMap(
      (entity) =>
        ['create', 'get', 'save', 'disable', 'delete'].map(
          (action) => `/aux/${entity}/${action}`,
        ),
    ),
    trusted: true,
  }
  const aux = new AuxService(db),
    acc = new AccService(db)
  const bookId = ulid(),
    submissionId = ulid()
  await bootstrap.createE2EPrincipal(principal, false, [
    '/aux/operating-entity/query',
  ])
  context.after(async () => {
    try {
      await sql`DELETE FROM aux_reference_facts WHERE source LIKE ${`acc:opening:${submissionId}:%`}`.execute(
        db,
      )
      await sql`DELETE FROM approval_events WHERE actor_id=${actor.id}`.execute(
        db,
      )
      await sql`DELETE FROM approval_entries WHERE domain='acc' AND submitted_by=${actor.id}`.execute(
        db,
      )
      await sql`DELETE FROM acc_subjects WHERE book_id=${bookId}`.execute(db)
      await sql`DELETE FROM acc_books WHERE id=${bookId}`.execute(db)
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })
  const operating = await aux.create(
    'operating-entity',
    {
      legalName: `主体${suffix}`,
      shortName: '主体',
      legalIdentifier: `OPTEST${suffix}`,
      registeredAddress: '',
      contactName: '',
      contactPhone: '',
      invoiceTitle: '',
      invoiceAddress: '',
      invoicePhone: '',
      invoiceBank: '',
      invoiceAccount: '',
      remark: '',
    },
    actor,
  )
  const warehouse = await aux.create(
    'warehouse',
    {
      name: '期初仓库',
      address: '',
      contactName: '',
      contactPhone: '',
      managerEmployeeId: null,
      remark: '',
    },
    actor,
  )
  const account = await aux.create(
    'fund-account',
    {
      name: '期初账户',
      currency: 'CNY',
      accountName: '期初户名',
      bank: '银行',
      branch: '',
      accountNumber: `F${suffix}`,
      operatingEntityId: operating.id,
      remark: '',
    },
    actor,
  )
  await acc.createBook(
    {
      id: bookId,
      name: '资产引用账簿',
      description: '',
      startMonth: '2026-09',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    actor,
  )
  const stock = await acc.createSubject(
    {
      id: ulid(),
      bookId,
      code: '1401',
      name: '仓库余额',
      parentId: null,
      balanceDirection: 'DEBIT',
      enabled: true,
      requiredDimensions: ['WAREHOUSE'],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    },
    actor,
  )
  const cash = await acc.createSubject(
    {
      id: ulid(),
      bookId,
      code: '1001',
      name: '资金余额',
      parentId: null,
      balanceDirection: 'CREDIT',
      enabled: true,
      requiredDimensions: ['FUND_ACCOUNT'],
      inventoryQuantity: false,
      settlementPurpose: 'NONE',
    },
    actor,
  )
  const input: AccOpeningInput = {
    bookId,
    submissionId,
    idempotencyKey: submissionId,
    lines: [
      {
        subjectId: stock.id,
        currency: 'CNY',
        direction: 'DEBIT' as const,
        amount: '10.00',
        dimensions: { WAREHOUSE: warehouse.id },
      },
      {
        subjectId: cash.id,
        currency: 'CNY',
        direction: 'CREDIT' as const,
        amount: '10.00',
        dimensions: { FUND_ACCOUNT: account.id },
      },
    ],
    assets: [],
    bills: [],
    containers: [],
  }
  await assert.rejects(
    acc.submitOpening(
      {
        ...input,
        lines: input.lines.map((line) => ({
          ...line,
          dimensions:
            'WAREHOUSE' in line.dimensions
              ? { WAREHOUSE: ulid() }
              : line.dimensions,
        })),
      },
      actor,
      'invalid-asset',
    ),
    (error) =>
      error instanceof AccApplicationError &&
      error.errorKey === 'acc_opening_dimension_required',
  )
  const pending = await acc.submitOpening(input, actor, 'current-assets')
  assert.equal(pending.payload.lines[0]!.dimensions.WAREHOUSE, warehouse.id)
  assert.equal(pending.payload.lines[1]!.dimensions.FUND_ACCOUNT, account.id)
  for (const [entity, object] of [
    ['warehouse', warehouse],
    ['fund-account', account],
  ] as const)
    await assert.rejects(
      aux.delete(entity, { id: object.id, revision: object.revision }, actor),
      (error) =>
        error instanceof AuxApplicationError && error.errorKey === 'conflict',
    )
  await acc.deleteOpening(
    { bookId, submissionId, expectedRevision: pending.approval.revision },
    actor,
    'delete-opening',
  )
  await aux.delete(
    'warehouse',
    { id: warehouse.id, revision: warehouse.revision },
    actor,
  )
  await aux.delete(
    'fund-account',
    { id: account.id, revision: account.revision },
    actor,
  )
})
