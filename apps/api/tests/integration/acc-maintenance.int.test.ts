import { VouService } from '../../src/vou/service.ts'
import { VouOpeningService } from '../../src/vou/opening-service.ts'
import { modelBuildId } from '@zerp/model'
import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, type SessionService } from '../../src/app/session.ts'
import { ManagementService } from '../../src/app/management.ts'
import { AccMappingCatalogService } from '../../src/acc/mapping-catalog.ts'
import { AccService } from '../../src/acc/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

test('ACC maintenance exposes unpersisted periods and preserves them after rejected first lock', async (t) => {
  const url = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(url)
  const db = createDatabase(url)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = ulid()
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `basic-${suffix}`,
    passwordHash: await hashPassword(`Test!${suffix}`),
  }
  const apiPaths = ['book', 'subject', 'period'].flatMap((entity) =>
    ['query', 'get', 'create', 'save', 'delete', 'lock', 'unlock'].map(
      (action) => `/acc/${entity}/${action}`,
    ),
  )
  await bootstrap.createE2EPrincipal(principal, false)
  const books: string[] = []
  t.after(async () => {
    try {
      for (const id of books) {
        await db.deleteFrom('acc_mappings').where('book_id', '=', id).execute()
        await db.deleteFrom('acc_subjects').where('book_id', '=', id).execute()
        await db.deleteFrom('acc_books').where('id', '=', id).execute()
      }
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })
  const actor = { id: principal.userId, permissions: apiPaths }
  const acc = new AccService(db)
  const book = await acc.createBook(
    {
      id: ulid(),
      name: '会计维护',
      description: '',
      startMonth: '2026-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    actor,
  )
  books.push(book.id)
  const periods = await acc.queryPeriods(book.id, actor)
  assert.equal(periods[0]?.month, '2026-01')
  assert.equal(periods[0]?.revision, null)
  assert.deepEqual(periods[0]?.availableActions, ['lock'])
  assert.equal(periods.at(-1)?.month, new Date().toISOString().slice(0, 7))
  assert.deepEqual(periods.at(-1)?.availableActions, [])
  await assert.rejects(
    acc.setPeriod(
      { bookId: book.id, month: '2026-01', expectedRevision: null },
      true,
      actor,
    ),
    { errorKey: 'acc_period_opening_not_approved' },
  )
  assert.deepEqual(await acc.queryPeriods(book.id, actor), periods)
  const rootInput = {
    id: ulid(),
    bookId: book.id,
    code: '1000',
    name: '根科目',
    parentId: null,
    balanceDirection: 'DEBIT' as const,
    enabled: true,
    requiredDimensions: [],
    inventoryQuantity: false,
    settlementPurpose: 'NONE' as const,
  }
  const root = await acc.createSubject(rootInput, actor)
  const child = await acc.createSubject(
    {
      ...rootInput,
      id: ulid(),
      code: '1001',
      name: '子科目',
      parentId: root.id,
    },
    actor,
  )
  await assert.rejects(
    acc.saveSubject(
      { ...rootInput, parentId: child.id, expectedRevision: root.revision },
      actor,
    ),
    { errorKey: 'acc_subject_parent_invalid' },
  )
  await assert.rejects(
    acc.saveSubject(
      { ...rootInput, parentId: root.id, expectedRevision: root.revision },
      actor,
    ),
    { errorKey: 'acc_subject_parent_invalid' },
  )
  assert.equal((await acc.getSubject(root.id, actor)).parentId, null)

  assert.ok(
    (await acc.getBook(book.id, actor)).availableActions.includes('edit'),
  )
  assert.ok(
    (await acc.getSubject(root.id, actor)).availableActions.includes('edit'),
  )
  assert.equal((await acc.getSubject(root.id, actor)).frozen, false)
  const parents = await acc.subjectParentOptions(
    { bookId: book.id, subjectId: root.id, page: 1, pageSize: 20 },
    actor,
  )
  assert.deepEqual(parents.items, [])
  const childParents = await acc.subjectParentOptions(
    { bookId: book.id, subjectId: child.id, page: 1, pageSize: 20 },
    actor,
  )
  assert.deepEqual(
    childParents.items.map((row) => row.id),
    [root.id],
  )

  const future = await acc.createBook(
    {
      id: ulid(),
      name: '未来账簿',
      description: '',
      startMonth: '2099-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    actor,
  )
  books.push(future.id)
  assert.deepEqual(await acc.queryPeriods(future.id, actor), [])
  assert.deepEqual(
    (await acc.getBook(book.id, { ...actor, permissions: ['/acc/book/get'] }))
      .availableActions,
    [],
  )
  const noActions = await acc.queryPeriods(book.id, {
    ...actor,
    permissions: ['/acc/period/query'],
  })
  assert.ok(noActions.every((row) => row.availableActions.length === 0))
  const mappings = new AccMappingCatalogService(db)
  await mappings.save(
    {
      bookId: book.id,
      vouEntity: 'sale-pricing',
      expectedRevision: null,
      defaultResult: 'POST',
      definition: {
        defaultTemplateId: '凭证',
        rules: [],
        templates: [
          {
            templateId: '凭证',
            collection: 'priceLines',
            lines: [
              {
                subjectSource: 'FIXED',
                subjectValue: child.id,
                direction: 'DEBIT',
                amountField: 'line.unitPrice',
                currencyField: 'currency',
                dimensions: {},
                quantityField: null,
                costCounterpartSubjectId: null,
                costCounterpartDimensions: {},
              },
              {
                subjectSource: 'FIXED',
                subjectValue: child.id,
                direction: 'CREDIT',
                amountField: 'line.unitPrice',
                currencyField: 'currency',
                dimensions: {},
                quantityField: null,
                costCounterpartSubjectId: null,
                costCounterpartDimensions: {},
              },
            ],
          },
        ],
        assetConfiguration: null,
      },
    },
    { ...actor, permissions: [...apiPaths, '/acc/mapping/save'] },
  )
  assert.equal((await acc.getSubject(child.id, actor)).frozen, true)
  const disabled = await acc.saveSubject(
    {
      ...rootInput,
      id: child.id,
      code: child.code,
      name: child.name,
      parentId: root.id,
      enabled: false,
      expectedRevision: child.revision,
    },
    actor,
  )
  await assert.rejects(
    acc.saveSubject(
      { ...disabled, enabled: true, expectedRevision: disabled.revision },
      actor,
    ),
    { errorKey: 'acc_subject_frozen' },
  )
  assert.equal((await acc.getSubject(child.id, actor)).enabled, false)
  await assert.rejects(acc.deleteSubject(child.id, disabled.revision, actor), {
    errorKey: 'acc_subject_delete_blocked',
  })
  const candidates = await acc.subjectParentOptions(
    { bookId: book.id, page: 1, pageSize: 20 },
    actor,
  )
  assert.ok(!candidates.items.some((item) => item.id === child.id))
  const app = createApp({
    acc,
    management: new ManagementService(db, { passwordMinLength: 12 }),
    session: {
      authenticate: async () => ({
        sessionId: ulid(),
        user: {
          id: principal.userId,
          code: principal.username,
          name: '维护者',
        },
        csrfToken: 'csrf',
        apiPaths,
        passwordChangeRequired: false,
        passwordMinLength: 12,
        absoluteExpiresAt: new Date('2100-01-01'),
      }),
    } as unknown as SessionService,
    config: loadConfig({
      DATABASE_URL: url,
      APP_SESSION_COOKIE_SECURE: 'false',
    }),
  })
  async function request(path: string, input?: object) {
    return (
      await app.request(
        path,
        input
          ? {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-zerp-model-build': modelBuildId,
              },
              body: JSON.stringify(input),
            }
          : { headers: { 'x-zerp-model-build': modelBuildId } },
      )
    ).json()
  }
  const httpBook = await request('/acc/book/get', { id: book.id })
  assert.equal(httpBook.code, 0)
  assert.deepEqual(
    httpBook.data.availableActions,
    (await acc.getBook(book.id, actor)).availableActions,
  )
  const httpSubject = await request('/acc/subject/get', { id: child.id })
  assert.equal(httpSubject.code, 0)
  assert.equal(httpSubject.data.frozen, true)
  assert.equal(httpSubject.data.parentName, '根科目')
  assert.equal(
    (await acc.querySubjects({ bookId: book.id }, actor)).items.find(
      (row) => row.id === child.id,
    )?.parentName,
    '根科目',
  )
  const users = await request(
    `/app/user/options?page=1&pageSize=20&ids=${principal.userId}`,
  )
  assert.equal(users.code, 0, JSON.stringify(users))
  assert.deepEqual(Object.keys(users.data.items[0]).sort(), [
    'code',
    'enabled',
    'id',
    'name',
  ])
  assert.equal(users.data.items[0].id, principal.userId)
  const httpParents = await request(
    `/acc/subject/parent-options?page=1&pageSize=20&bookId=${book.id}&subjectId=${root.id}`,
  )
  assert.equal(httpParents.code, 0)
  assert.deepEqual(httpParents.data.items, [])
  const invalidSave = await request('/acc/book/save', {
    id: book.id,
    expectedRevision: book.revision,
    name: book.name,
    description: '',
    baseCurrency: 'CNY',
    queryUserIds: [],
    operateUserIds: [],
    startMonth: '2027-01',
  })
  assert.equal(invalidSave.errorKey, 'validation_failed')
  assert.equal((await acc.getBook(book.id, actor)).startMonth, '2026-01')
})

test('ACC scopes remain independent of action permission and book templates are copied only on creation', async (t) => {
  const url = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(url)
  const db = createDatabase(url)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = ulid()
  const passwordHash = await hashPassword(`Test!${suffix}`)
  const principals = ['owner', 'reader', 'operator', 'outsider'].map(
    (name) => ({
      userId: ulid(),
      roleId: ulid(),
      username: `${name}-${suffix}`,
      passwordHash,
    }),
  )
  for (const principal of principals)
    await bootstrap.createE2EPrincipal(principal, false)
  const books: string[] = []
  t.after(async () => {
    try {
      for (const id of books) {
        await db.deleteFrom('acc_subjects').where('book_id', '=', id).execute()
        await db.deleteFrom('acc_books').where('id', '=', id).execute()
      }
      await db
        .deleteFrom('approval_events')
        .where(
          'actor_id',
          'in',
          principals.map((p) => p.userId),
        )
        .execute()
      for (const principal of principals)
        await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })
  const paths = ['book', 'subject', 'period'].flatMap((entity) =>
    ['query', 'get', 'create', 'save', 'delete', 'lock', 'unlock'].map(
      (action) => `/acc/${entity}/${action}`,
    ),
  )
  const [owner, reader, operator, outsider] = principals.map((principal) => ({
    id: principal.userId,
    permissions: paths,
  }))
  const acc = new AccService(db)
  const book = await acc.createBook(
    {
      id: ulid(),
      name: '范围分离',
      description: '',
      startMonth: '2026-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'ENTERPRISE',
      queryUserIds: [reader!.id],
      operateUserIds: [operator!.id],
    },
    owner!,
  )
  books.push(book.id)
  const initial = await acc.querySubjects(
    { bookId: book.id, pageSize: 200 },
    owner!,
  )
  assert.ok(initial.total > 0)
  assert.ok(book.queryUserIds.includes(owner!.id))
  assert.ok(book.operateUserIds.includes(owner!.id))
  assert.deepEqual((await acc.getBook(book.id, reader!)).availableActions, [])
  assert.ok(
    (await acc.querySubjects({ bookId: book.id }, reader!)).items.every(
      (row) => row.availableActions.length === 0,
    ),
  )
  assert.equal((await acc.queryBooks({}, operator!)).total, 0)
  assert.equal((await acc.queryBooks({}, outsider!)).total, 0)
  await assert.rejects(acc.getBook(book.id, operator!), {
    errorKey: 'acc_book_access_denied',
  })
  await assert.rejects(
    acc.subjectParentOptions(
      { bookId: book.id, page: 1, pageSize: 20 },
      outsider!,
    ),
    { errorKey: 'acc_book_access_denied' },
  )
  await assert.rejects(
    acc.saveBook(
      {
        id: book.id,
        expectedRevision: book.revision,
        name: '非法修改',
        description: '',
        baseCurrency: 'CNY',
        queryUserIds: [],
        operateUserIds: [],
      },
      reader!,
    ),
    { errorKey: 'acc_book_access_denied' },
  )
  const saved = await acc.saveBook(
    {
      id: book.id,
      expectedRevision: book.revision,
      name: '更新账簿',
      description: '说明',
      baseCurrency: 'CNY',
      queryUserIds: [owner!.id, reader!.id],
      operateUserIds: [owner!.id],
    },
    operator!,
  )
  assert.ok(saved.operateUserIds.includes(operator!.id))
  assert.ok(!saved.queryUserIds.includes(operator!.id))
  assert.equal(saved.startMonth, '2026-01')
  assert.deepEqual(
    (
      await acc.querySubjects({ bookId: book.id, pageSize: 200 }, owner!)
    ).items.map((row) => row.id),
    initial.items.map((row) => row.id),
  )
  assert.equal((await acc.queryBooks({}, operator!)).total, 0)
  const queryOnly = {
    ...owner!,
    permissions: ['/acc/book/query', '/acc/subject/query'],
  }
  assert.deepEqual(
    (await acc.queryBooks({}, queryOnly)).items[0]!.availableActions,
    [],
  )
  assert.ok(
    (await acc.querySubjects({ bookId: book.id }, queryOnly)).items.every(
      (row) => row.availableActions.length === 0,
    ),
  )
  await assert.rejects(
    acc.saveBook(
      {
        id: book.id,
        expectedRevision: book.revision,
        name: '过期修改',
        description: '',
        baseCurrency: 'CNY',
        queryUserIds: [],
        operateUserIds: [],
      },
      owner!,
    ),
    { errorKey: 'approval_stale_revision' },
  )
  if (book.controlBook) {
    assert.ok(!saved.availableActions.includes('delete'))
    await assert.rejects(acc.deleteBook(book.id, saved.revision, owner!), {
      errorKey: 'acc_control_book_delete_forbidden',
    })
  }
  const parentPage = await acc.subjectParentOptions(
    { bookId: book.id, page: 1, pageSize: 20 },
    owner!,
  )
  assert.equal(parentPage.items.length, Math.min(20, initial.total))
  const otherBook = await acc.createBook(
    {
      id: ulid(),
      name: '其他账簿',
      description: '',
      startMonth: '2026-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    owner!,
  )
  books.push(otherBook.id)
  const subjectInput = {
    id: ulid(),
    bookId: otherBook.id,
    code: '1000',
    name: '库存科目',
    parentId: null,
    balanceDirection: 'DEBIT' as const,
    enabled: true,
    requiredDimensions: ['PRODUCT' as const, 'WAREHOUSE' as const],
    inventoryQuantity: true,
    settlementPurpose: 'NONE' as const,
  }
  const inventory = await acc.createSubject(subjectInput, owner!)
  const detail = await acc.getSubject(inventory.id, owner!)
  assert.equal(detail.inventoryQuantity, true)
  assert.deepEqual(detail.requiredDimensions, ['PRODUCT', 'WAREHOUSE'])
  await assert.rejects(
    acc.saveSubject(
      {
        ...subjectInput,
        bookId: book.id,
        expectedRevision: inventory.revision,
      },
      owner!,
    ),
    { errorKey: 'acc_subject_not_found' },
  )
  await assert.rejects(
    acc.saveSubject(
      {
        ...subjectInput,
        parentId: initial.items[0]!.id,
        expectedRevision: inventory.revision,
      },
      owner!,
    ),
    { errorKey: 'acc_subject_parent_invalid' },
  )
  assert.equal(
    (await acc.getSubject(inventory.id, owner!)).bookId,
    otherBook.id,
  )
  await acc.deleteSubject(inventory.id, inventory.revision, owner!)
  await acc.deleteBook(otherBook.id, otherBook.revision, owner!)
  assert.equal(
    (await acc.queryBooks({}, owner!)).items.some(
      (row) => row.id === otherBook.id,
    ),
    false,
  )
})

test('ACC HTTP locks only the next ended month and unlocks in reverse order without partial periods', async (t) => {
  const url = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(url)
  const db = createDatabase(url)
  const bootstrap = new TargetBootstrapService(db)
  const suffix = ulid()
  const passwordHash = await hashPassword(`Test!${suffix}`)
  const principals = ['submitter', 'reviewer'].map((name) => ({
    userId: ulid(),
    roleId: ulid(),
    username: `${name}-${suffix}`,
    passwordHash,
  }))
  for (const principal of principals)
    await bootstrap.createE2EPrincipal(principal, false)
  const [submitter, reviewer] = principals.map((principal) => ({
    id: principal.userId,
    permissions: ['/acc/mapping/save'],
    trusted: true,
  }))
  const acc = new AccService(db)
  const opening = new VouOpeningService(db, acc)
  const vou = new VouService(db, { acc, wfl: { async apply() {} } })
  const bookId = ulid()
  t.after(async () => {
    try {
      await db
        .deleteFrom('acc_period_balances')
        .where('book_id', '=', bookId)
        .execute()
      await db
        .deleteFrom('acc_journal_entries')
        .where('book_id', '=', bookId)
        .execute()
      await db
        .deleteFrom('acc_mappings')
        .where('book_id', '=', bookId)
        .execute()
      await db
        .deleteFrom('approval_entries')
        .where(
          'submitted_by',
          'in',
          principals.map((p) => p.userId),
        )
        .execute()
      await db
        .deleteFrom('vou_documents')
        .where(
          'created_by',
          'in',
          principals.map((p) => p.userId),
        )
        .execute()
      await db.deleteFrom('acc_books').where('id', '=', bookId).execute()
      await db
        .deleteFrom('vou_intermediary_scripts')
        .where(
          'updated_by',
          'in',
          principals.map((p) => p.userId),
        )
        .execute()
      await db
        .deleteFrom('approval_events')
        .where(
          'actor_id',
          'in',
          principals.map((p) => p.userId),
        )
        .execute()
      for (const principal of principals)
        await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })
  await acc.createBook(
    {
      id: bookId,
      name: '期间验收',
      description: '',
      startMonth: '2020-01',
      baseCurrency: 'CNY',
      subjectTemplate: 'EMPTY',
      queryUserIds: [],
      operateUserIds: [],
    },
    submitter!,
  )
  const openingId = ulid()
  const pending = await opening.submitOpening(
    {
      bookId,
      submissionId: openingId,
      idempotencyKey: openingId,
      lines: [],
      assets: [],
      bills: [],
      containers: [],
    },
    submitter!,
    'period-opening',
  )
  await opening.reviewOpening(
    'approve',
    {
      bookId,
      submissionId: openingId,
      expectedRevision: pending.approval.revision,
    },
    reviewer!,
    'period-opening-approve',
  )
  await new AccMappingCatalogService(db).save(
    {
      bookId,
      vouEntity: 'intermediary-calculation',
      expectedRevision: null,
      defaultResult: 'UN_POST',
      definition: {
        defaultTemplateId: null,
        rules: [],
        templates: [],
        assetConfiguration: null,
      },
    },
    submitter!,
  )
  const currentScript = await vou.getIntermediaryScript(submitter!)
  const script = await vou.saveIntermediaryScript(
    {
      expectedRevision: currentScript?.revision ?? null,
      name: '空来源月度计算',
      source: 'globalThis.calculate = () => ({lines:[], summaries:[]})',
    },
    submitter!,
  )
  async function approveMonth(businessDate: string) {
    const source = await vou.getIntermediarySource(businessDate, submitter!)
    const id = ulid()
    const pending = await vou.submit(
      'intermediary-calculation',
      'submit-new',
      {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload: {
          businessDate,
          currency: 'CNY',
          remark: '',
          attachments: [],
          intermediaryCalculation: {
            ...source,
            script,
            result: { lines: [], summaries: [] },
          },
        },
      },
      submitter!,
      'period-intermediary',
    )
    await vou.review(
      'intermediary-calculation',
      'approve',
      {
        documentId: pending.documentId,
        submissionId: id,
        expectedRevision: pending.revision,
      },
      reviewer!,
      'period-intermediary-approve',
    )
  }
  await approveMonth('2020-01-31')
  await approveMonth('2020-02-29')
  const app = createApp({
    acc,
    session: {
      authenticate: async () => ({
        sessionId: ulid(),
        user: { id: submitter!.id, code: 'accountant', name: '会计' },
        csrfToken: 'csrf',
        apiPaths: ['query', 'lock', 'unlock'].map(
          (action) => `/acc/period/${action}`,
        ),
        passwordChangeRequired: false,
        passwordMinLength: 12,
        absoluteExpiresAt: new Date('2100-01-01'),
      }),
    } as unknown as SessionService,
    config: loadConfig({
      DATABASE_URL: url,
      APP_SESSION_COOKIE_SECURE: 'false',
    }),
  })
  async function post(action: string, input: object) {
    return (
      await app.request(`/acc/period/${action}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zerp-model-build': modelBuildId,
        },
        body: JSON.stringify(input),
      })
    ).json()
  }
  const before = await post('query', { bookId })
  assert.deepEqual(before.data[0].availableActions, ['lock'])
  const skipped = await post('lock', {
    bookId,
    month: '2020-02',
    expectedRevision: null,
  })
  assert.equal(skipped.errorKey, 'acc_period_not_continuous')
  assert.deepEqual((await post('query', { bookId })).data, before.data)
  const first = await post('lock', {
    bookId,
    month: '2020-01',
    expectedRevision: null,
  })
  assert.equal(first.code, 0, JSON.stringify(first))
  assert.equal(first.data.revision, '1')
  const afterFirst = await post('query', { bookId })
  assert.deepEqual(afterFirst.data[0].availableActions, ['unlock'])
  assert.deepEqual(afterFirst.data[1].availableActions, ['lock'])
  const second = await post('lock', {
    bookId,
    month: '2020-02',
    expectedRevision: null,
  })
  assert.equal(second.code, 0, JSON.stringify(second))
  const wrongUnlock = await post('unlock', {
    bookId,
    month: '2020-01',
    expectedRevision: '1',
  })
  assert.equal(wrongUnlock.errorKey, 'acc_period_unlock_not_latest')
  const stale = await post('unlock', {
    bookId,
    month: '2020-02',
    expectedRevision: '9007199254740993',
  })
  assert.equal(stale.errorKey, 'approval_stale_revision')
  assert.equal((await post('query', { bookId })).data[1].locked, true)
  const ended = await post('lock', {
    bookId,
    month: new Date().toISOString().slice(0, 7),
    expectedRevision: null,
  })
  assert.equal(ended.errorKey, 'acc_period_not_ended')
  const unlocked = await post('unlock', {
    bookId,
    month: '2020-02',
    expectedRevision: '1',
  })
  assert.equal(unlocked.data.revision, '2')
  assert.deepEqual(unlocked.data.availableActions, ['lock'])
  const relocked = await post('lock', {
    bookId,
    month: '2020-02',
    expectedRevision: '2',
  })
  assert.equal(relocked.data.revision, '3')
  assert.equal(
    (await post('unlock', { bookId, month: '2020-02', expectedRevision: '3' }))
      .code,
    0,
  )
  assert.equal(
    (await post('unlock', { bookId, month: '2020-01', expectedRevision: '1' }))
      .code,
    0,
  )
  const final = await post('query', { bookId })
  assert.deepEqual(final.data[0], {
    bookId,
    month: '2020-01',
    locked: false,
    revision: '2',
    availableActions: ['lock'],
  })
  assert.deepEqual(final.data[1].availableActions, [])
})
