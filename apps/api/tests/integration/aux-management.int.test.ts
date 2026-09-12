import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'

import { ulid } from 'ulid'

import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import {
  AuxApplicationError,
  AuxService,
  type AuxRevisionInput,
  type AuxSaveInput,
} from '../../src/aux/service.ts'
import { createDatabase } from '../../src/db/database.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL

test('AUX management searches before stable pagination and keeps current name as the only searchable fact', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = randomBytes(6).toString('hex').toUpperCase()
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `aux-query-${suffix.toLowerCase()}`,
    passwordHash: await hashPassword(`AuxQuery!${suffix}`),
  }
  const actor = {
    id: principal.userId,
    permissions: [
      '/aux/employee-category/query',
      '/aux/employee-category/get',
      '/aux/employee-category/create',
      '/aux/employee-category/save',
      '/aux/employee-category/enable',
      '/aux/employee-category/disable',
      '/aux/employee-category/delete',
    ],
  }
  const service = new AuxService(db)

  await bootstrap.createE2EPrincipal(principal, false, [
    '/aux/employee-category/query',
  ])
  context.after(async () => {
    try {
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })

  const created = []
  for (let index = 0; index < 22; index += 1) {
    created.push(
      await service.create(
        'employee-category',
        {
          name: `批量辅助${suffix}-${String(index).padStart(2, '0')}`,
          description: '',
        },
        actor,
      ),
    )
  }

  const keyword = `piliangfuzhu${suffix.toLowerCase()}`
  const first = await service.query(
    'employee-category',
    { keyword, page: 1, pageSize: 20 },
    actor,
  )
  const second = await service.query(
    'employee-category',
    { keyword, page: 2, pageSize: 20 },
    actor,
  )

  assert.equal(first.total, 22)
  assert.equal(first.items.length, 20)
  assert.equal(second.total, 22)
  assert.equal(second.items.length, 2)
  assert.deepEqual(
    [...first.items, ...second.items].map((item) => [item.code, item.id]),
    [...first.items, ...second.items]
      .map((item) => [item.code, item.id])
      .sort(([leftCode, leftId], [rightCode, rightId]) =>
        leftCode === rightCode
          ? leftId.localeCompare(rightId)
          : leftCode.localeCompare(rightCode),
      ),
  )
  assert.deepEqual(first.items[0]?.availableActions, ['edit', 'disable'])
  assert.ok(first.items.every((item) => item.py.includes(keyword)))

  const current = await service.get(
    'employee-category',
    { id: created[0]!.id },
    actor,
  )
  const saved = await service.save(
    'employee-category',
    {
      id: current.id,
      revision: current.revision,
      name: `改名辅助${suffix}`,
      description: current.description,
    },
    actor,
  )
  assert.equal(saved.revision, '2')
  assert.equal(
    (
      await service.query(
        'employee-category',
        {
          keyword: `gaimingfuzhu${suffix.toLowerCase()}`,
          page: 1,
          pageSize: 20,
        },
        actor,
      )
    ).items[0]?.name,
    `改名辅助${suffix}`,
  )

  await assert.rejects(
    () =>
      service.save(
        'employee-category',
        {
          id: current.id,
          revision: 2,
          name: '数字 revision 不得进入服务',
          description: '',
        } as unknown as AuxSaveInput<'employee-category'>,
        actor,
      ),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'validation_failed',
  )
})

test('measurement-unit quantity-scale query ANDs with keyword before count and pagination', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = randomBytes(6).toString('hex').toUpperCase()
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `unit-query-${suffix.toLowerCase()}`,
    passwordHash: await hashPassword(`UnitQuery!${suffix}`),
  }
  const actor = {
    id: principal.userId,
    permissions: [
      '/aux/measurement-unit/query',
      '/aux/measurement-unit/create',
    ],
  }
  const service = new AuxService(db)

  await bootstrap.createE2EPrincipal(principal, false, [
    '/aux/measurement-unit/query',
  ])
  context.after(async () => {
    try {
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })

  for (let index = 0; index < 23; index += 1) {
    await service.create(
      'measurement-unit',
      {
        name: `计量筛选${suffix}-${String(index).padStart(2, '0')}`,
        symbol: `u${index}`,
        quantityScale: index < 21 ? 0 : 3,
      },
      actor,
    )
  }

  const keyword = `jiliangshaixuan${suffix.toLowerCase()}`
  const first = await service.query(
    'measurement-unit',
    { keyword, quantityScale: 0, page: 1, pageSize: 20 },
    actor,
  )
  const second = await service.query(
    'measurement-unit',
    { keyword, quantityScale: 0, page: 2, pageSize: 20 },
    actor,
  )
  assert.equal(first.total, 21)
  assert.equal(first.items.length, 20)
  assert.equal(second.total, 21)
  assert.equal(second.items.length, 1)
  assert.equal(
    (
      await service.query(
        'measurement-unit',
        { keyword, quantityScale: 6, page: 1, pageSize: 20 },
        actor,
      )
    ).total,
    0,
  )
})

test('AUX shared enablement preserves BigInt CAS, audits atomically, and re-enables typed dictionary items', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = randomBytes(6).toString('hex').toUpperCase()
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `aux-enable-${suffix.toLowerCase()}`,
    passwordHash: await hashPassword(`AuxEnable!${suffix}`),
  }
  const actor = {
    id: principal.userId,
    permissions: [
      '/aux/employee-category/get',
      '/aux/employee-category/create',
      '/aux/employee-category/save',
      '/aux/employee-category/enable',
      '/aux/employee-category/disable',
      '/aux/employee-category/delete',
      '/aux/dictionary-type/create',
      '/aux/dictionary-item/create',
      '/aux/dictionary-item/get',
      '/aux/dictionary-item/enable',
      '/aux/dictionary-item/disable',
    ],
  }
  const service = new AuxService(db)

  await bootstrap.createE2EPrincipal(principal, false, [
    '/aux/employee-category/query',
  ])
  context.after(async () => {
    try {
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })

  const employeeCategory = await service.create(
    'employee-category',
    { name: `启停人员${suffix}` },
    actor,
  )
  const hugeRevision = '9007199254740993'
  await db
    .updateTable('aux_objects')
    .set({ revision: hugeRevision })
    .where('id', '=', employeeCategory.id)
    .executeTakeFirstOrThrow()

  await assert.rejects(
    () =>
      service.disable(
        'employee-category',
        { id: employeeCategory.id, revision: hugeRevision },
        actor,
        'x'.repeat(129),
      ),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === '22001',
  )
  const rolledBack = await service.get(
    'employee-category',
    { id: employeeCategory.id },
    actor,
  )
  assert.equal(rolledBack.enabled, true)
  assert.equal(rolledBack.revision, hugeRevision)

  const concurrent = await Promise.allSettled([
    service.disable(
      'employee-category',
      { id: employeeCategory.id, revision: hugeRevision },
      actor,
      `aux-disable-a-${suffix}`,
    ),
    service.disable(
      'employee-category',
      { id: employeeCategory.id, revision: hugeRevision },
      actor,
      `aux-disable-b-${suffix}`,
    ),
  ])
  const fulfilled = concurrent.filter(
    (
      result,
    ): result is PromiseFulfilledResult<
      Awaited<ReturnType<typeof service.disable>>
    > => result.status === 'fulfilled',
  )
  const rejected = concurrent.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  assert.equal(fulfilled.length, 1)
  assert.equal(rejected.length, 1)
  assert.equal(
    rejected[0]?.reason instanceof Error &&
      'errorKey' in rejected[0].reason &&
      rejected[0].reason.errorKey,
    'conflict',
  )
  const disabled = fulfilled[0]!.value
  assert.deepEqual(disabled, {
    id: employeeCategory.id,
    revision: '9007199254740994',
    enabled: false,
  })
  const audit = await db
    .selectFrom('app_audit_events')
    .select(['event_type', 'target_type', 'target_id', 'summary'])
    .where('target_id', '=', employeeCategory.id)
    .executeTakeFirstOrThrow()
  assert.equal(audit.event_type, 'AUX_EMPLOYEE_CATEGORY_DISABLED')
  assert.equal(audit.target_type, 'employee-category')
  assert.equal(audit.target_id, employeeCategory.id)
  assert.deepEqual(audit.summary, {
    domain: 'aux',
    entity: 'employee-category',
    beforeEnabled: true,
    afterEnabled: false,
    beforeRevision: hugeRevision,
    revision: '9007199254740994',
  })

  for (const input of [
    { id: employeeCategory.id, revision: hugeRevision },
    { id: employeeCategory.id, revision: '9007199254740994' },
  ]) {
    await assert.rejects(
      () =>
        service.disable(
          'employee-category',
          input,
          actor,
          `aux-repeat-${suffix}`,
        ),
      (error: unknown) =>
        error instanceof Error &&
        'errorKey' in error &&
        error.errorKey === 'conflict',
    )
  }
  assert.equal(
    await db
      .selectFrom('app_audit_events')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('target_id', '=', employeeCategory.id)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    1,
  )

  const mutable = await service.create(
    'employee-category',
    { name: `大版本编辑${suffix}` },
    actor,
  )
  await db
    .updateTable('aux_objects')
    .set({ revision: hugeRevision })
    .where('id', '=', mutable.id)
    .executeTakeFirstOrThrow()
  const saved = await service.save(
    'employee-category',
    {
      id: mutable.id,
      revision: hugeRevision,
      name: `大版本已编辑${suffix}`,
      description: '',
    },
    actor,
  )
  assert.equal(saved.revision, '9007199254740994')
  assert.equal(
    (await service.get('employee-category', { id: mutable.id }, actor)).name,
    `大版本已编辑${suffix}`,
  )
  await service.delete(
    'employee-category',
    { id: mutable.id, revision: saved.revision },
    actor,
  )
  await assert.rejects(
    () => service.get('employee-category', { id: mutable.id }, actor),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'validation_failed',
  )

  const dictionaryType = await service.create(
    'dictionary-type',
    { name: `测试字典${suffix}` },
    actor,
  )
  const dictionaryItem = await service.create(
    'dictionary-item',
    {
      name: `测试字典项${suffix}`,
      dictionaryTypeId: dictionaryType.id,
      sortOrder: 1,
    },
    actor,
  )
  const itemDetail = await service.get(
    'dictionary-item',
    { id: dictionaryItem.id },
    actor,
  )
  assert.equal(itemDetail.dictionaryTypeCode.startsWith('DCT-'), true)
  assert.equal(itemDetail.dictionaryTypeName, `测试字典${suffix}`)

  const itemDisabled = await service.disable(
    'dictionary-item',
    { id: dictionaryItem.id, revision: dictionaryItem.revision },
    actor,
    `dictionary-disable-${suffix}`,
  )
  const itemEnabled = await service.enable(
    'dictionary-item',
    { id: dictionaryItem.id, revision: itemDisabled.revision },
    actor,
    `dictionary-enable-${suffix}`,
  )
  assert.equal(itemEnabled.enabled, true)
  assert.equal(itemEnabled.revision, '3')

  await assert.rejects(
    () =>
      service.enable(
        'dictionary-item',
        {
          id: dictionaryItem.id,
          revision: 3,
        } as unknown as AuxRevisionInput,
        actor,
        `dictionary-numeric-${suffix}`,
      ),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'validation_failed',
  )
})

test('AUX typed details keep derived dictionary facts, fixed defaults, settlement rules, and references', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = randomBytes(6).toString('hex').toUpperCase()
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `aux-typed-${suffix.toLowerCase()}`,
    passwordHash: await hashPassword(`AuxTyped!${suffix}`),
  }
  const actor = {
    id: principal.userId,
    permissions: [
      '/aux/payment-method/create',
      '/aux/payment-method/get',
      '/aux/payment-method/query',
      '/aux/payment-method/disable',
      '/aux/payment-method/delete',
      '/aux/dictionary-type/create',
      '/aux/dictionary-item/create',
      '/aux/dictionary-item/get',
      '/aux/dictionary-item/save',
      '/aux/settlement-method/query',
      '/aux/settlement-method/save',
    ],
  }
  const service = new AuxService(db)

  await bootstrap.createE2EPrincipal(principal, false, [
    '/aux/employee-category/query',
  ])
  context.after(async () => {
    try {
      await db
        .deleteFrom('aux_reference_facts')
        .where('source', 'like', `issue386-${suffix}%`)
        .execute()
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })

  const payment = await service.create(
    'payment-method',
    { name: `默认收款${suffix}` },
    actor,
  )
  const paymentDetail = await service.get(
    'payment-method',
    { id: payment.id },
    actor,
  )
  assert.equal(paymentDetail.defaultSalesSurcharge, '0.00')
  assert.equal(paymentDetail.description, '')
  const paymentReference = await service.options({
    entity: 'payment-method',
    keyword: suffix,
    page: 1,
    pageSize: 20,
    enabled: true,
  })
  assert.equal(paymentReference.items[0]?.objectId, payment.id)
  assert.equal(paymentReference.items[0]?.defaultSalesSurcharge, '0.00')

  const paymentSnapshot = {
    objectId: paymentReference.items[0]!.objectId,
    code: paymentReference.items[0]!.code,
    name: paymentReference.items[0]!.name,
    defaultSalesSurcharge: paymentReference.items[0]!.defaultSalesSurcharge,
  }
  await db
    .insertInto('aux_reference_facts')
    .values({
      id: ulid(),
      aux_object_id: payment.id,
      source: `issue386-${suffix}`,
    })
    .execute()
  const paymentDisabled = await service.disable(
    'payment-method',
    { id: payment.id, revision: payment.revision },
    actor,
    `payment-disable-${suffix}`,
  )
  assert.deepEqual(
    (
      await service.options({
        entity: 'payment-method',
        keyword: suffix,
        page: 1,
        pageSize: 20,
        enabled: true,
      })
    ).items,
    [],
  )
  const disabledPaymentDetail = await service.get(
    'payment-method',
    { id: payment.id },
    actor,
  )
  assert.equal(disabledPaymentDetail.enabled, false)
  assert.deepEqual(
    {
      objectId: disabledPaymentDetail.id,
      code: disabledPaymentDetail.code,
      name: disabledPaymentDetail.name,
      defaultSalesSurcharge: disabledPaymentDetail.defaultSalesSurcharge,
    },
    paymentSnapshot,
  )
  await assert.rejects(
    () =>
      service.delete(
        'payment-method',
        { id: payment.id, revision: paymentDisabled.revision },
        actor,
      ),
    (error) => {
      if (!(error instanceof AuxApplicationError)) return false
      assert.equal(error.errorKey, 'conflict')
      assert.deepEqual(error.data, {
        blockers: [{ source: `issue386-${suffix}`, count: 1 }],
      })
      return true
    },
  )
  assert.equal(
    await db
      .selectFrom('aux_reference_facts')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .where('aux_object_id', '=', payment.id)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count)),
    1,
  )

  const dictionaryType = await service.create(
    'dictionary-type',
    { name: `类型${suffix}` },
    actor,
  )
  const dictionaryItem = await service.create(
    'dictionary-item',
    {
      name: `字典项${suffix}`,
      dictionaryTypeId: dictionaryType.id,
      sortOrder: 1,
    },
    actor,
  )
  const beforeInvalidSave = await service.get(
    'dictionary-item',
    { id: dictionaryItem.id },
    actor,
  )
  await assert.rejects(
    () =>
      service.save(
        'dictionary-item',
        {
          id: dictionaryItem.id,
          revision: dictionaryItem.revision,
          name: beforeInvalidSave.name,
          dictionaryTypeId: beforeInvalidSave.dictionaryTypeId,
          sortOrder: beforeInvalidSave.sortOrder,
          dictionaryTypeCode: beforeInvalidSave.dictionaryTypeCode,
          dictionaryTypeName: beforeInvalidSave.dictionaryTypeName,
        } as unknown as AuxSaveInput<'dictionary-item'>,
        actor,
      ),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'validation_failed',
  )
  assert.equal(
    (await service.get('dictionary-item', { id: dictionaryItem.id }, actor))
      .revision,
    dictionaryItem.revision,
  )

  const settlement = await service.ensureE2ESettlementMethod(
    {
      name: `固定月结${suffix}`,
      termCode: 'MONTHLY_30',
      ruleType: 'MONTH_END',
      monthOffset: 1,
      dayOfMonth: 0,
      dayOffset: 0,
      defaultSalesSurcharge: '0',
    },
    { ...actor, trusted: true },
  )
  await db
    .insertInto('aux_reference_facts')
    .values({
      id: ulid(),
      aux_object_id: settlement.id,
      source: `issue386-${suffix}`,
    })
    .execute()
  await assert.rejects(
    () =>
      service.save(
        'settlement-method',
        {
          id: settlement.id,
          revision: settlement.revision,
          name: `不得改名${suffix}`,
          termCode: 'MONTHLY_30',
          ruleType: 'MONTH_END',
          monthOffset: 1,
          dayOfMonth: 0,
          dayOffset: 0,
          defaultSalesSurcharge: '0.00',
        },
        actor,
      ),
    (error) =>
      error instanceof AuxApplicationError &&
      error.errorKey === 'validation_failed',
  )
  assert.equal(
    (
      await service.options({
        entity: 'settlement-method',
        keyword: suffix,
        page: 1,
        pageSize: 20,
        enabled: true,
      })
    ).items[0]?.objectId,
    settlement.id,
  )
})
