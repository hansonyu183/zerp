import assert from 'node:assert/strict'
import test from 'node:test'
import { modelBuildId } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { SessionService } from '../../src/app/session.ts'
import { BobService } from '../../src/bob/service.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'

test('order HTTP lists summarize and filter before pagination, get immutable details, and review with exact permissions', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedOrderListFixture(db)
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou: fixture.vou,
      bob: new BobService(db),
    })
    async function client(user: typeof fixture.submitter) {
      const response = await app.request('/session/auth/signin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-zerp-model-build': modelBuildId,
        },
        body: JSON.stringify({ code: user.username, password: user.password }),
      })
      const auth = await response.json()
      assert.equal(auth.code, 0)
      const headers = {
        'Content-Type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        'x-csrf-token': auth.data.csrfToken,
        cookie: response.headers.getSetCookie()[0]!,
      }
      return async (path: string, input: unknown) =>
        (
          await app.request(path, {
            method: 'POST',
            headers,
            body: JSON.stringify(input),
          })
        ).json()
    }
    const read = await client(fixture.submitter),
      review = await client(fixture.reviewer),
      denied = await client(fixture.noQuery)
    const base = {
      page: 1,
      pageSize: 20,
      filters: {
        dateFrom: '2026-09-04',
        dateTo: '2026-09-04',
        counterpartyObjectId: fixture.salePayload.customerSubunit.objectId,
      },
    }
    const result = await read('/vou/sale-order/query', base)
    assert.equal(result.code, 0, result.errorKey)
    assert.equal(result.data.total, 21)
    assert.equal(result.data.items.length, 20)
    for (const row of result.data.items) {
      assert.equal(row.vouType, 'sale-order')
      assert.equal(row.handlerName, null)
      assert.equal(row.counterpartyName, 'HTTP 客户子单位')
      assert.equal(row.amount, '1.00')
      for (const key of [
        'payload',
        'versionNo',
        'enabled',
        'id',
        'code',
        'py',
        'name',
      ])
        assert.equal(key in row, false)
    }
    const second = await read('/vou/sale-order/query', { ...base, page: 2 })
    assert.equal(second.data.total, 21)
    assert.equal(second.data.items.length, 1)
    for (const filters of [
      { ...base.filters, documentNo: '%' },
      { ...base.filters, documentNo: '_' },
      { ...base.filters, counterpartyObjectId: fixture.supplierId },
      { ...base.filters, dateFrom: '2026-09-05', dateTo: '2026-09-05' },
      { ...base.filters, submittedFrom: '2099-01-01' },
    ]) {
      const empty = await read('/vou/sale-order/query', { ...base, filters })
      assert.equal(empty.code, 0, empty.errorKey)
      assert.equal(empty.data.total, 0)
    }
    for (const filters of [
      { keyword: 'old' },
      { dateFrom: '2026-09-30', dateTo: '2026-09-01' },
      { submittedFrom: '2026-09-30', submittedTo: '2026-09-01' },
    ])
      assert.notEqual(
        (await read('/vou/sale-order/query', { ...base, filters })).code,
        0,
      )
    assert.notEqual((await denied('/vou/sale-order/query', base)).code, 0)
    for (const [entity, doc, expectedName] of [
      ['sale-order', fixture.sales[0]!, 'HTTP 客户子单位'],
      ['purchase-order', fixture.purchase, '订单测试供应商'],
    ] as const) {
      const one = await read(`/vou/${entity}/query`, {
        page: 1,
        pageSize: 20,
        filters: { documentNo: doc.documentNo },
      })
      assert.equal(one.data.total, 1)
      assert.equal(one.data.items[0].counterpartyName, expectedName)
      const detail = await read(`/vou/${entity}/get`, {
        documentId: doc.documentId,
      })
      assert.equal(detail.code, 0)
      assert.deepEqual(detail.data.payload, doc.payload)
      assert.equal(
        detail.data.availableApprovalActions.includes('approve'),
        false,
      )
      let current = (
        await review(`/vou/${entity}/get`, { documentId: doc.documentId })
      ).data
      for (const [action, status] of [
        ['reject', 'REJECTED'],
        ['unreject', 'PENDING'],
        ['approve', 'APPROVED'],
        ['unapprove', 'PENDING'],
      ] as const) {
        assert.ok(current.availableApprovalActions.includes(action))
        const changed = await review(`/vou/${entity}/${action}`, {
          documentId: current.documentId,
          submissionId: current.submissionId,
          expectedRevision: current.revision,
          ...(['reject', 'unapprove'].includes(action)
            ? { reason: '订单验收原因' }
            : {}),
        })
        assert.equal(changed.code, 0, changed.errorKey)
        current = changed.data
        assert.equal(current.status, status)
        assert.deepEqual(current.payload, doc.payload)
        const filtered = await read(`/vou/${entity}/query`, {
          page: 1,
          pageSize: 20,
          filters: { documentNo: doc.documentNo, status: [status] },
        })
        assert.equal(filtered.data.total, 1)
      }
    }
  })
})
