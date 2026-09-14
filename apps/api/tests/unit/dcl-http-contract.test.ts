import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionService } from '../../src/app/session.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { createApp } from '../../src/app.ts'

test('DCL owns archive writes and BOB no longer exposes submit-new', async (context) => {
  const config = loadConfig({
    DATABASE_URL: 'postgres://localhost/dcl_contract_test',
    TARGET_DATABASE_SCOPE: 'isolated',
  })
  const db = createDatabase(config.databaseUrl.toString())
  context.after(() => db.destroy())
  const app = createApp({ config, session: new SessionService(db, config) })
  for (const entity of [
    'customer',
    'product',
    'supplier',
    'other-unit',
    'sales-partner',
  ]) {
    const old = await app.request(`/bob/${entity}/submit-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(old.status, 404)
    const current = await app.request(`/dcl/${entity}/submit-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.notEqual(current.status, 404)
    assert.equal((await current.json()).errorKey, 'validation_failed')
  }
})
