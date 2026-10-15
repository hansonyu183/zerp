import assert from 'node:assert/strict'
import test from 'node:test'
import { ulid } from 'ulid'
import { modelBuildId, servicePermissionContexts } from '@zerp/model'
import { withCommittedPurchaseDatabase } from '../fixtures/vou-purchase-http.ts'
import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../../src/app/session.ts'
import { ManagementService } from '../../src/app/management.ts'
import { createApp } from '../../src/app.ts'
import { loadConfig } from '../../src/platform/config.ts'

test('normal role creation and save preserve all five service contract contexts without widening delegated scope', async () => {
  await withCommittedPurchaseDatabase(async (db) => {
    const path = '/vou/service-contract/query'
    const contexts = servicePermissionContexts(path)
    assert.equal(contexts.length, 5)
    const permissions = [
      '/app/role/create',
      '/app/role/save',
      '/app/role/get',
      '/app/role/query',
      '/app/user/get',
      '/app/user/query',
      path,
    ]
    const bootstrap = new TargetBootstrapService(db)
    const password = `Contexts!Aa1${ulid()}`
    const principals = []
    for (let i = 0; i < 2; i++) {
      const principal = {
        userId: ulid(),
        roleId: ulid(),
        username: `contexts-${ulid()}`,
        passwordHash: await hashPassword(password),
      }
      await bootstrap.createE2EPrincipal(principal, false, permissions)
      principals.push(principal)
    }
    const permission = await db
      .selectFrom('app_permissions')
      .select('id')
      .where('path', '=', path)
      .executeTakeFirstOrThrow()
    const narrowContexts = contexts.filter((context) => context !== 'PRIOR_AD')
    await db
      .updateTable('app_role_permissions')
      .set({ service_contexts: [...narrowContexts] })
      .where('role_id', '=', principals[1]!.roleId)
      .where('permission_id', '=', permission.id)
      .execute()
    const config = loadConfig({
      DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
      APP_SESSION_COOKIE_SECURE: 'false',
    })
    const app = createApp({
      config,
      session: new SessionService(db, config),
      management: new ManagementService(db, { passwordMinLength: 12 }),
    })
    async function login(code: string) {
      const response = await app.request('/session/auth/signin', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zerp-model-build': modelBuildId,
        },
        body: JSON.stringify({ code, password }),
      })
      const session = await response.json()
      assert.equal(session.code, 0)
      const headers = {
        'content-type': 'application/json',
        'x-zerp-model-build': modelBuildId,
        'x-csrf-token': session.data.csrfToken,
        cookie: response.headers.getSetCookie()[0]!,
      }
      return async (path: string, body: unknown = {}) =>
        (
          await app.request(path, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          })
        ).json()
    }
    const full = await login(principals[0]!.username)
    const narrow = await login(principals[1]!.username)
    try {
      const input = {
        name: 'All legal service contract types',
        description: null,
        permissionIds: [permission.id],
        purchaseInboundScopes: {},
        serviceContexts: { [permission.id]: [...contexts] },
      }
      const created = await full('/app/role/create', input)
      assert.equal(created.code, 0, JSON.stringify(created))
      assert.deepEqual(created.data.serviceContexts, input.serviceContexts)
      const saved = await full('/app/role/save', {
        ...input,
        id: created.data.id,
        revision: created.data.revision,
        name: 'All legal service contract types saved',
      })
      assert.equal(saved.code, 0, JSON.stringify(saved))
      assert.deepEqual(saved.data.serviceContexts, input.serviceContexts)
      const read = await full('/app/role/get', { id: created.data.id })
      assert.deepEqual(read.data.serviceContexts, input.serviceContexts)
      const denied = await narrow('/app/role/create', input)
      assert.equal(denied.errorKey, 'forbidden')
      const deniedSave = await narrow('/app/role/save', {
        ...input,
        id: saved.data.id,
        revision: saved.data.revision,
      })
      assert.equal(deniedSave.errorKey, 'forbidden')
      const narrower = await narrow('/app/role/create', {
        ...input,
        serviceContexts: { [permission.id]: narrowContexts },
      })
      assert.equal(narrower.code, 0, JSON.stringify(narrower))
      const wrongEntity = await full('/app/role/create', {
        ...input,
        serviceContexts: { [permission.id]: ['PRIOR_AB'] },
      })
      assert.equal(wrongEntity.errorKey, 'validation_failed')
      const duplicate = await full('/app/role/create', {
        ...input,
        serviceContexts: {
          [permission.id]: [...contexts, contexts[0]!],
        },
      })
      assert.equal(duplicate.errorKey, 'validation_failed')
    } finally {
      await full('/session/auth/signout')
      await narrow('/session/auth/signout')
    }
  })
})
