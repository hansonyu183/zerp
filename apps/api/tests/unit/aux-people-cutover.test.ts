import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../../src/app.ts'
import { loadConfig } from '../../src/platform/config.ts'
import type { SessionService } from '../../src/app/session.ts'

test('migrated people expose no old DCL lifecycle or BOB current routes', async () => {
  const app = createApp({session: {} as SessionService, config: loadConfig({DATABASE_URL: 'postgres://unused:unused@127.0.0.1:5432/zerp_test'})})
  assert.notEqual((await app.request('/dcl/product/submit-new', {method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status, 404)
  for (const entity of ['employee', 'operating-entity']) {
    for (const action of ['query', 'get', 'submit-new', 'submit-change', 'approve', 'reject', 'unreject', 'unapprove', 'versions', 'audit-history', 'delete']) {
      const response = await app.request(`/dcl/${entity}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      assert.equal(response.status, 404, `${entity}/${action} must be absent`)
    }
    for (const action of ['query', 'get']) {
      const response = await app.request(`/bob/${entity}/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      assert.equal(response.status, 404, `${entity}/${action} must be absent`)
    }
  }
})
