import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'
import { modelBuildId } from '@zerp/model'
import { createApp } from '../../src/app.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'
import { withWflDatabase } from './wfl-fixture.ts'

// The 13 original resources, specified independently of generated metadata.
const migratedResources = [
  ['operating-entity', 'aux/operating-entity'],
  ['employee', 'aux/employee'],
  ['warehouse', 'aux/warehouse'],
  ['fund-account', 'aux/fund-account'],
  ['vehicle', 'aux/vehicle'],
  ['product', 'bob/product'],
  ['customer', 'bob/customer'],
  ['supplier', 'bob/supplier'],
  ['other-unit', 'bob/other-unit'],
  ['sales-partner', 'bob/sales-partner'],
  ['acc-mapping', 'acc/mapping'],
  ['rpt-definition', 'rpt/definition'],
  ['wfl-process-definition', 'wfl/process-definition'],
] as const

test('real Session exposes all migrated owners and rejects every old DCL entry without compatibility aliases', async () => {
  await withWflDatabase(async (db) => {
    const password = randomBytes(24).toString('base64url')
    const principal = {
      userId: ulid(),
      roleId: ulid(),
      username: `batch405-${ulid()}`,
      passwordHash: await hashPassword(password),
    }
    await new TargetBootstrapService(db).createE2EPrincipal(principal)
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL,
      TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({ config, session: new SessionService(db, config) })
    const headers = {
      'Content-Type': 'application/json',
      'x-zerp-model-build': modelBuildId,
    }
    const login = await app.request('/session/auth/signin', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: principal.username, password }),
    })
    const signedIn = await login.json()
    assert.equal(signedIn.code, 0)
    const cookie = login.headers.getSetCookie()[0]!
    const restored = await app.request('/session/auth/restore', {
      method: 'POST',
      headers: { ...headers, cookie },
      body: '{}',
    })
    const session = await restored.json()
    assert.equal(session.code, 0)
    assert.deepEqual(session.data.apiPaths, signedIn.data.apiPaths)
    const paths: string[] = session.data.apiPaths
    assert.equal(
      paths.some((path) => path.startsWith('/dcl/')),
      false,
    )
    for (const [oldEntity, resource] of migratedResources) {
      assert.ok(
        paths.includes(
          `/${resource}/${resource === 'rpt/definition' ? 'get' : 'query'}`,
        ),
        resource,
      )
      const versioned =
        resource.startsWith('bob/') || resource.startsWith('wfl/')
      assert.equal(paths.includes(`/${resource}/approve`), versioned, resource)
      assert.equal(paths.includes(`/${resource}/versions`), versioned, resource)
      if (versioned) {
        assert.ok(paths.includes(`/${resource}/submission-query`))
        assert.ok(paths.includes(`/${resource}/submission-get`))
      }
      for (const action of [
        'query',
        'get',
        'submit-new',
        'submit-change',
        'approve',
        'reject',
        'unreject',
        'unapprove',
        'versions',
        'enable',
        'disable',
        'delete',
      ]) {
        const response = await app.request(`/dcl/${oldEntity}/${action}`, {
          method: 'POST',
          headers: {
            ...headers,
            cookie,
            'x-csrf-token': session.data.csrfToken,
          },
          body: '{}',
        })
        assert.equal(response.status, 404, `${oldEntity}/${action}`)
      }
    }
    assert.ok(paths.includes('/vou/opening/approve'))
    assert.equal(paths.includes('/vou/opening/versions'), false)
    assert.equal(
      paths.some((path) => path.startsWith('/acc/opening/')),
      false,
    )
  })
})
