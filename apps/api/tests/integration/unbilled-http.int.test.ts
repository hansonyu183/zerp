import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'
import { withWflDatabase } from './wfl-fixture.ts'
import { seedOrderListFixture } from '../fixtures/vou-orders.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { SessionService } from '../../src/app/session.ts'
import { createApp } from '../../src/app.ts'
import { loadConfig } from '../../src/platform/config.ts'

test('unbilled income is a POST action with its own permission and CSRF', async () => {
  await withWflDatabase(async (db) => {
    const fixture = await seedOrderListFixture(db, 0)
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL,
      TARGET_DATABASE_SCOPE: 'isolated',
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      vou: fixture.vou,
    })
    const path = '/vou/sale-invoice/unbilled'
    assert.equal((await app.request(`${path}?periodMonth=2026-09`)).status, 404)
    const bootstrap = new TargetBootstrapService(db)
    async function login(paths: string[]) {
      const principal = {
        ...fixture.submitter,
        userId: ulid(),
        roleId: ulid(),
        username: `unbilled-${ulid()}`,
      }
      await bootstrap.createE2EPrincipal(principal, false, paths)
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
        'content-type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        cookie: response.headers.getSetCookie()[0]!,
        'x-csrf-token': String(body.data.csrfToken),
      }
    }
    const post = async (
      headers: Record<string, string>,
      body: object = { periodMonth: '2026-09' },
    ) =>
      app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
    const headers = await login([path])
    const allowed = await (await post(headers)).json()
    assert.equal(allowed.code, 0, allowed.errorKey)
    assert.deepEqual(allowed.data, { periodMonth: '2026-09', items: [] })
    const { 'x-csrf-token': _csrf, ...withoutCsrf } = headers
    assert.notEqual((await (await post(withoutCsrf)).json()).code, 0)
    for (const action of ['query', 'submit-new', 'approve']) {
      const denied = await (
        await post(await login([`/vou/sale-invoice/${action}`]))
      ).json()
      assert.equal(denied.errorKey, 'approval_invalid_action')
    }
    assert.equal(
      (await (await post(headers, { periodMonth: '2026-13' })).json()).errorKey,
      'validation_failed',
    )
  })
})
