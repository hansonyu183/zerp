import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { AuxService } from '../../src/aux/service.ts'
import { DclArchiveService } from '../../src/dcl/archives.ts'
import { SessionService } from '../../src/app/session.ts'
import { createApp } from '../../src/app.ts'
import { loadConfig } from '../../src/platform/config.ts'

test('invoice tax choices read current approved associations and enabled AUX revisions through HTTP', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedOrderListFixture(db, 0)
    const actor = {
      id: f.submitter.userId,
      permissions: [
        '/aux/tax-information/create',
        '/aux/tax-information/save',
        '/aux/tax-information/get',
        '/aux/tax-information/disable',
      ],
      trusted: true,
    }
    const reviewer = { ...actor, id: f.reviewer.userId }
    const aux = new AuxService(db),
      dcl = new DclArchiveService(db)
    const data = {
      name: '发票正式名称',
      taxNumber: `HK${ulid()}`,
      registeredAddress: '',
      phone: '',
      bank: '',
      accountNumber: '',
      remark: '',
    }
    const tax = await aux.create('tax-information', data, actor)
    const taxView = await aux.get('tax-information', { id: tax.id }, actor)
    const customerId = f.references.archiveSubjectIds[0]!
    const current = await dcl.get('customer', customerId, actor)
    const submissionId = ulid()
    const linked = await dcl.submit(
      'customer',
      'submit-change',
      {
        subjectId: customerId,
        submissionId,
        idempotencyKey: submissionId,
        expectedLatestApprovedSubmissionId: current.submissionId,
        expectedLatestApprovedRevision: current.revision,
        snapshot: {
          ...current.snapshot,
          taxInformation: [
            { ...data, id: tax.id, code: taxView.code, revision: tax.revision },
          ],
        },
      },
      actor,
      'invoice-link',
    )
    await dcl.review(
      'customer',
      'approve',
      {
        subjectId: customerId,
        submissionId,
        expectedRevision: linked.revision,
      },
      reviewer,
      'invoice-link',
    )
    await aux.save(
      'tax-information',
      { ...data, id: tax.id, revision: tax.revision, name: '开票时最新名称' },
      actor,
    )
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL,
      TARGET_DATABASE_SCOPE: 'isolated',
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou: f.vou,
    })
    const login = await app.request('/session/auth/signin', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zerp-model-build': modelBuildId,
      },
      body: JSON.stringify({
        code: f.submitter.username,
        password: f.submitter.password,
      }),
    })
    assert.equal((await login.json()).code, 0)
    const get = () =>
      app.request(`/vou/sale-invoice/tax-options?objectId=${customerId}`, {
        headers: { cookie: login.headers.getSetCookie()[0]! },
      })
    const response = await get()
    assert.equal(response.status, 200)
    const choices = await response.json()
    assert.equal(choices.code, 0, choices.errorKey)
    assert.equal(choices.data.approvalEntryId, submissionId)
    assert.equal(choices.data.items[0].revision, '2')
    assert.equal(choices.data.items[0].name, '开票时最新名称')
    const secondTaxData = {
      ...data,
      name: '另一条开票资料',
      taxNumber: `SG${ulid()}`,
    }
    const secondTax = await aux.create('tax-information', secondTaxData, actor)
    const secondTaxView = await aux.get(
      'tax-information',
      { id: secondTax.id },
      actor,
    )
    const associated = await dcl.get('customer', customerId, actor)
    const nextEntryId = ulid()
    const next = await dcl.submit(
      'customer',
      'submit-change',
      {
        subjectId: customerId,
        submissionId: nextEntryId,
        idempotencyKey: nextEntryId,
        expectedLatestApprovedSubmissionId: associated.submissionId,
        expectedLatestApprovedRevision: associated.revision,
        snapshot: {
          ...associated.snapshot,
          taxInformation: [
            ...(associated.snapshot.taxInformation as object[]),
            {
              ...secondTaxData,
              id: secondTax.id,
              code: secondTaxView.code,
              revision: secondTax.revision,
            },
          ],
        },
      },
      actor,
      'invoice-multiple-links',
    )
    await dcl.review(
      'customer',
      'approve',
      {
        subjectId: customerId,
        submissionId: nextEntryId,
        expectedRevision: next.revision,
      },
      reviewer,
      'invoice-multiple-links',
    )
    const multiple = await (await get()).json()
    assert.equal(multiple.data.items.length, 2)
    assert.equal(multiple.data.approvalEntryId, nextEntryId)
    await aux.disable(
      'tax-information',
      { id: tax.id, revision: '2' },
      actor,
      'invoice-disable',
    )
    assert.equal((await (await get()).json()).data.items.length, 1)
    await aux.disable(
      'tax-information',
      { id: secondTax.id, revision: secondTax.revision },
      actor,
      'invoice-disable-last',
    )
    assert.deepEqual((await (await get()).json()).data.items, [])
    assert.equal(
      (await dcl.get('customer', customerId, actor)).snapshot
        .taxInformation instanceof Array,
      true,
    )
  })
})

import { seedVouCatalogFixture } from '../fixtures/vou-catalog.ts'
import { VouService } from '../../src/vou/service.ts'
import { AccService } from '../../src/acc/service.ts'
import type { VouPayloadFor } from '@zerp/model'

test('invoice HTTP freezes latest tax and allocates partial cross-period sources without reposting revenue', async () => {
  await withWflDatabase(async (db) => {
    const f = await seedVouCatalogFixture(db)
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL,
      TARGET_DATABASE_SCOPE: 'isolated',
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const vou = new VouService(db, {
      acc: new AccService(db),
      wfl: { async apply() {} },
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou,
    })
    async function login(principal: typeof f.submitter) {
      const response = await app.request('/session/auth/signin', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zerp-model-build': modelBuildId,
        },
        body: JSON.stringify({
          code: principal.username,
          password: principal.password,
        }),
      })
      const body = await response.json()
      assert.equal(body.code, 0)
      return {
        cookie: response.headers.getSetCookie()[0]!,
        'x-csrf-token': body.data.csrfToken,
        'x-zerp-model-build': modelBuildId,
        'content-type': 'application/json',
      }
    }
    const headers = await login(f.submitter),
      reviewHeaders = await login(f.reviewer)
    const post = async (
      entity: string,
      action: string,
      data: unknown,
      reviewer = false,
    ) =>
      (
        await app.request(`/vou/${entity}/${action}`, {
          method: 'POST',
          headers: reviewer ? reviewHeaders : headers,
          body: JSON.stringify(data),
        })
      ).json()
    const get = async (path: string) =>
      (await app.request(path, { headers: { cookie: headers.cookie } })).json()
    const base = f.documents['sale-invoice']
      .payload as VouPayloadFor<'sale-invoice'>
    const taxActor = {
      ...f.actor,
      permissions: [
        ...f.actor.permissions,
        '/aux/tax-information/save',
        '/aux/tax-information/disable',
        '/aux/tax-information/delete',
      ],
    }
    const { id: taxId, code: _code, revision, ...taxData } = base.taxInformation
    await f.aux.save(
      'tax-information',
      { ...taxData, id: taxId, revision, name: '开票最新名称' },
      taxActor,
    )
    const input = (payload: unknown) => {
      const id = ulid()
      return {
        documentId: ulid(),
        submissionId: id,
        idempotencyKey: id,
        expectedRevision: null,
        payload,
      }
    }
    const stale = await post('sale-invoice', 'submit-new', input(base))
    assert.equal(stale.errorKey, 'vou_invoice_tax_stale')
    const choices = await get(
      `/vou/sale-invoice/tax-options?objectId=${base.customer.objectId}`,
    )
    assert.equal(choices.code, 0)
    const latest = choices.data.items[0]
    const otherCustomerId = ulid(),
      otherEntryId = ulid()
    const currentCustomer = await f.bob.get(
      'customer',
      base.customer.objectId,
      f.actor,
    )
    const other = await f.bob.submit(
      'customer',
      'submit-new',
      {
        subjectId: otherCustomerId,
        submissionId: otherEntryId,
        idempotencyKey: otherEntryId,
        expectedLatestApprovedSubmissionId: null,
        expectedLatestApprovedRevision: null,
        snapshot: {
          ...currentCustomer.snapshot,
          displayName: '同税号不同客户',
          taxInformation: [latest],
        },
      },
      f.actor,
      'invoice-other-customer',
    )
    await f.bob.review(
      'customer',
      'approve',
      {
        subjectId: otherCustomerId,
        submissionId: otherEntryId,
        expectedRevision: other.revision,
      },
      f.reviewerActor,
      'invoice-other-customer',
    )
    const crossCustomer = await post(
      'sale-invoice',
      'submit-new',
      input({
        ...base,
        customer: {
          objectId: otherCustomerId,
          approvalEntryId: otherEntryId,
          selectionOrigin: 'CURRENT',
        },
        taxInformation: latest,
      }),
    )
    assert.equal(crossCustomer.errorKey, 'vou_invoice_source_unavailable')
    const period = base.businessDate.slice(0, 7)
    const before = await post('sale-invoice', 'unbilled', {
      periodMonth: period,
    })
    assert.equal(before.code, 0)
    const total = (response: any) =>
      response.data.items.reduce(
        (sum: bigint, row: { amount: string }) =>
          sum + BigInt(row.amount.replace('.', '')),
        0n,
      )
    const baseline = total(before)
    const journalCount = await db
      .selectFrom('acc_journal_entries')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow()
    const sourceQuery = new URLSearchParams({
      objectId: base.customer.objectId,
      operatingEntityId: base.operatingEntity.objectId,
      businessDate: base.businessDate,
      currency: base.currency,
    })
    const capacity = await get(
      `/vou/sale-invoice/invoice-sources?${sourceQuery}`,
    )
    assert.equal(capacity.code, 0, capacity.errorKey)
    const available = capacity.data.items.find(
      (row: any) =>
        row.sourceDocumentId === base.invoiceLines[0]!.sourceDocumentId &&
        row.sourceLineId === base.invoiceLines[0]!.sourceLineId,
    )
    assert.ok(available)
    const reserved = await post(
      'sale-invoice',
      'submit-new',
      input({
        ...base,
        taxInformation: latest,
        invoiceLines: [
          { ...base.invoiceLines[0], amount: available.availableAmount },
        ],
      }),
    )
    assert.equal(reserved.code, 0, reserved.errorKey)
    const returned = f.documents['sale-return']
    const returnCommand = {
      documentId: returned.documentId,
      submissionId: returned.submissionId,
      expectedRevision: returned.revision,
    }
    const returnBlocked = await post(
      'sale-return',
      'approve',
      returnCommand,
      true,
    )
    assert.equal(returnBlocked.errorKey, 'vou_invoice_source_unavailable')
    const released = await post(
      'sale-invoice',
      'reject',
      {
        documentId: reserved.data.documentId,
        submissionId: reserved.data.submissionId,
        expectedRevision: reserved.data.revision,
        reason: '解除金额占用',
      },
      true,
    )
    assert.equal(released.code, 0, released.errorKey)
    const returnApproved = await post(
      'sale-return',
      'approve',
      returnCommand,
      true,
    )
    assert.equal(returnApproved.code, 0, returnApproved.errorKey)
    assert.ok(
      total(await post('sale-invoice', 'unbilled', { periodMonth: period })) <
        baseline,
    )
    const returnReversed = await post(
      'sale-return',
      'unapprove',
      {
        ...returnCommand,
        expectedRevision: returnApproved.data.revision,
        reason: '恢复业务来源',
      },
      true,
    )
    assert.equal(returnReversed.code, 0, returnReversed.errorKey)
    assert.equal(
      total(await post('sale-invoice', 'unbilled', { periodMonth: period })),
      baseline,
    )
    const firstInput = input({
      ...base,
      taxInformation: { ...latest, name: '伪造税务名称' },
    })
    const first = await post('sale-invoice', 'submit-new', firstInput)
    assert.equal(first.code, 0, first.errorKey)
    assert.equal(first.data.payload.taxInformation.name, '开票最新名称')
    assert.equal(first.data.payload.taxInformation.revision, '2')
    const secondInput = input({
      ...base,
      businessDate: '2026-10-01',
      taxInformation: latest,
    })
    const second = await post('sale-invoice', 'submit-new', secondInput)
    assert.equal(second.code, 0, second.errorKey)
    await f.aux.save(
      'tax-information',
      { ...taxData, id: taxId, revision: '2', name: '后续税务名称' },
      taxActor,
    )
    await f.aux.disable(
      'tax-information',
      { id: taxId, revision: '3' },
      taxActor,
      'disable-after-invoice',
    )
    const approve = async (document: any) =>
      post(
        'sale-invoice',
        'approve',
        {
          documentId: document.documentId,
          submissionId: document.submissionId,
          expectedRevision: document.revision,
        },
        true,
      )
    const firstApproved = await approve(first.data),
      secondApproved = await approve(second.data)
    assert.equal(firstApproved.code, 0, firstApproved.errorKey)
    assert.equal(secondApproved.code, 0, secondApproved.errorKey)
    assert.equal(
      (await post('sale-invoice', 'get', { documentId: first.data.documentId }))
        .data.payload.taxInformation.name,
      '开票最新名称',
    )
    assert.equal(
      total(await post('sale-invoice', 'unbilled', { periodMonth: period })),
      baseline - 1n,
    )
    assert.equal(
      total(await post('sale-invoice', 'unbilled', { periodMonth: '2026-10' })),
      baseline - 2n,
    )
    assert.deepEqual(
      await db
        .selectFrom('acc_journal_entries')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
      journalCount,
    )
    const source = f.documents['sale-signoff']
    const blocked = await post(
      'sale-signoff',
      'unapprove',
      {
        documentId: source.documentId,
        submissionId: source.submissionId,
        expectedRevision: source.revision,
        reason: '验证发票引用阻断',
      },
      true,
    )
    assert.notEqual(blocked.code, 0)
    assert.ok(
      JSON.stringify(blocked.data).includes(first.data.documentId),
      JSON.stringify(blocked),
    )
    const reversed = await post(
      'sale-invoice',
      'unapprove',
      {
        documentId: first.data.documentId,
        submissionId: first.data.submissionId,
        expectedRevision: firstApproved.data.revision,
        reason: '验证释放开票金额',
      },
      true,
    )
    assert.equal(reversed.code, 0, reversed.errorKey)
    assert.equal(
      total(await post('sale-invoice', 'unbilled', { periodMonth: period })),
      baseline,
    )
    assert.equal(
      total(await post('sale-invoice', 'unbilled', { periodMonth: '2026-10' })),
      baseline - 1n,
    )
    await assert.rejects(
      () =>
        f.aux.delete('tax-information', { id: taxId, revision: '4' }, taxActor),
      (error) => error instanceof Error && error.message === 'conflict',
    )
  })
})

import { readFile } from 'node:fs/promises'
import { sql } from 'kysely'
import { createDatabase } from '../../src/db/database.ts'
import { readTargetPermissionCatalog } from '../../scripts/target-artifacts.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword } from '../../src/app/session.ts'
import { randomBytes } from 'node:crypto'

test('concurrent HTTP tax edits cannot silently replace an invoice selection and concurrent invoices cannot over-allocate', async (context) => {
  assert.ok(process.env.TARGET_TEST_DATABASE_URL)
  const admin = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const name = `invoice_${ulid().toLowerCase()}_test`
  await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin)
  const url = new URL(process.env.TARGET_TEST_DATABASE_URL)
  url.pathname = `/${name}`
  const db = createDatabase(url.toString())
  context.after(async () => {
    await db.destroy()
    await sql`DROP DATABASE ${sql.id(name)}`.execute(admin)
    await admin.destroy()
  })
  await sql
    .raw(
      await readFile(
        new URL('../../db/target-schema.sql', import.meta.url),
        'utf8',
      ),
    )
    .execute(db)
  const bootstrap = new TargetBootstrapService(db)
  await bootstrap.syncPermissionCatalog(await readTargetPermissionCatalog())
  await new AccService(db).syncVouEntityCatalog()
  const f = await seedVouCatalogFixture(db)
  const password = randomBytes(24).toString('base64url')
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `invoice-${ulid()}`,
    passwordHash: await hashPassword(password),
  }
  await bootstrap.createE2EPrincipal(principal, true)
  const config = loadConfig({
    DATABASE_URL: url.toString(),
    TARGET_DATABASE_SCOPE: 'isolated',
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    vou: f.vou,
    aux: f.aux,
  })
  const login = await app.request('/session/auth/signin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    },
    body: JSON.stringify({ code: principal.username, password }),
  })
  const logged = await login.json()
  assert.equal(logged.code, 0)
  const headers = {
    cookie: login.headers.getSetCookie()[0]!,
    'content-type': 'application/json',
    'x-csrf-token': logged.data.csrfToken,
    'x-zerp-model-build': modelBuildId,
  }
  const post = async (path: string, body: unknown) =>
    (
      await app.request(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
    ).json()
  const base = f.documents['sale-invoice']
    .payload as VouPayloadFor<'sale-invoice'>
  const input = (payload: unknown) => {
    const id = ulid()
    return {
      documentId: ulid(),
      submissionId: id,
      idempotencyKey: id,
      expectedRevision: null,
      payload,
    }
  }
  const command = input(base)
  const { code: _code, ...tax } = base.taxInformation
  const [invoice, edit] = await Promise.all([
    post('/vou/sale-invoice/submit-new', command),
    post('/aux/tax-information/save', { ...tax, name: '并发修改后的名称' }),
  ])
  assert.equal(edit.code, 0, edit.errorKey)
  if (invoice.code === 0) {
    assert.equal(invoice.data.payload.taxInformation.revision, tax.revision)
    assert.equal(invoice.data.payload.taxInformation.name, tax.name)
  } else {
    assert.equal(invoice.errorKey, 'vou_invoice_tax_stale')
    assert.equal(
      (await post('/vou/sale-invoice/get', { documentId: command.documentId }))
        .errorKey,
      'vou_not_found',
    )
  }
  const options = await (
    await app.request(
      `/vou/sale-invoice/tax-options?objectId=${base.customer.objectId}`,
      { headers },
    )
  ).json()
  const query = new URLSearchParams({
    objectId: base.customer.objectId,
    operatingEntityId: base.operatingEntity.objectId,
    businessDate: base.businessDate,
    currency: base.currency,
  })
  const sources = await (
    await app.request(`/vou/sale-invoice/invoice-sources?${query}`, { headers })
  ).json()
  assert.equal(sources.code, 0, sources.errorKey)
  const source = sources.data.items[0]
  const payload = {
    ...base,
    taxInformation: options.data.items[0],
    invoiceLines: [
      {
        sourceDocumentId: source.sourceDocumentId,
        sourceApprovalEntryId: source.sourceApprovalEntryId,
        sourceLineId: source.sourceLineId,
        amount: source.availableAmount,
      },
    ],
  }
  const results = await Promise.all([
    post('/vou/sale-invoice/submit-new', input(payload)),
    post('/vou/sale-invoice/submit-new', input(payload)),
  ])
  assert.equal(results.filter((result) => result.code === 0).length, 1)
  assert.equal(
    results.find((result) => result.code !== 0).errorKey,
    'vou_invoice_source_unavailable',
  )
})
