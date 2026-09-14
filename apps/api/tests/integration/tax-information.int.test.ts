import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { AuxService } from '../../src/aux/service.ts'
import { createDatabase } from '../../src/db/database.ts'
import { loadConfig } from '../../src/platform/config.ts'

test('tax information HTTP normalizes foreign tax numbers and protects current facts with revision', async (context) => {
  const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
  assert.ok(databaseUrl)
  const db = createDatabase(databaseUrl)
  const bootstrap = new TargetBootstrapService(db)
  const password = randomBytes(24).toString('base64url')
  const suffix = randomBytes(6).toString('hex')
  const principal = {
    userId: ulid(),
    roleId: ulid(),
    username: `tax-${suffix}`,
    passwordHash: await hashPassword(password),
  }
  await bootstrap.createE2EPrincipal(principal, true)
  context.after(async () => {
    try {
      await bootstrap.deleteE2EPrincipal(principal)
    } finally {
      await db.destroy()
    }
  })
  const config = loadConfig({
    DATABASE_URL: databaseUrl,
    TARGET_DATABASE_SCOPE: 'isolated',
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    aux: new AuxService(db),
  })
  const login = await app.request('/session/auth/signin', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    },
    body: JSON.stringify({ code: principal.username, password }),
  })
  const session = await login.json()
  assert.equal(session.code, 0)
  async function post(action: string, body: unknown) {
    const response = await app.request(`/aux/tax-information/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        'x-csrf-token': session.data.csrfToken,
        cookie: login.headers.getSetCookie()[0]!,
      },
      body: JSON.stringify(body),
    })
    assert.equal(response.status, 200)
    return response.json()
  }
  const input = {
    name: '共享税务主体',
    taxNumber: ` hk ${suffix} `,
    registeredAddress: '',
    phone: '',
    bank: '',
    accountNumber: '',
    remark: '',
  }
  const created = await post('create', input)
  assert.equal(created.code, 0)
  const initial = await post('get', { id: created.data.id })
  assert.equal(initial.data.taxNumber, `HK${suffix.toUpperCase()}`)
  assert.match(initial.data.code, /^TAX-\d{4}$/)
  const duplicate = await post('create', {
    ...input,
    taxNumber: `HK${suffix.toUpperCase()}`,
  })
  assert.equal(duplicate.errorKey, 'tax_information_duplicate_tax_number')
  const invalidBank = await post('save', {
    ...input,
    ...created.data,
    enabled: undefined,
    bank: '开户行',
  })
  assert.equal(invalidBank.errorKey, 'validation_failed')
  const saved = await post('save', {
    ...input,
    id: created.data.id,
    revision: created.data.revision,
    name: '更新税务主体',
  })
  assert.equal(saved.code, 0)
  assert.equal(saved.data.revision, '2')
  const stale = await post('save', {
    ...input,
    id: created.data.id,
    revision: created.data.revision,
  })
  assert.equal(stale.errorKey, 'conflict')
  assert.equal(
    (await post('get', { id: created.data.id })).data.name,
    '更新税务主体',
  )
})
