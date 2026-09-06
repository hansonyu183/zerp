import assert from 'node:assert/strict'
import test from 'node:test'

import { modelBuildId } from '@zerp/model'

import { createApp } from '../../src/app.ts'
import type { ManagementService } from '../../src/app/management.ts'
import type { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'

const principal = {
  sessionId: '01J00000000000000000000001',
  user: {
    id: '01J00000000000000000000002',
    code: 'admin',
    name: '管理员',
  },
  csrfToken: 'csrf',
  apiPaths: ['/app/user/query'],
  passwordChangeRequired: false,
  passwordMinLength: 12,
  absoluteExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
}

test('app/user query exposes only the native user contract', async () => {
  let received: unknown
  const session = {
    authenticate: async () => principal,
  } as unknown as SessionService
  const management = {
    queryUsers: async (input: unknown) => {
      received = input
      return {
        items: [
          {
            id: '01J00000000000000000000003',
            code: 'u001',
            py: 'zhangsan',
            name: '张三',
            enabled: true,
            revision: '9007199254740993',
            availableActions: ['VIEW', 'EDIT', 'DISABLE'],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }
    },
  } as unknown as ManagementService
  const config = loadConfig({
    DATABASE_URL: 'postgres://zerp:password@127.0.0.1:5432/zerp_test',
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({ session, management, config })
  const headers = {
    'content-type': 'application/json',
    'x-zerp-model-build': modelBuildId,
  }

  const response = await app.request('/app/user/query', {
    method: 'POST',
    headers,
    body: JSON.stringify({ keyword: '张三', page: 1, pageSize: 20 }),
  })
  const payload = await response.json()

  assert.equal(payload.code, 0)
  assert.deepEqual(received, { keyword: '张三', page: 1, pageSize: 20 })
  assert.deepEqual(Object.keys(payload.data.items[0]).sort(), [
    'availableActions',
    'code',
    'enabled',
    'id',
    'name',
    'py',
    'revision',
  ])
  assert.equal(payload.data.items[0].revision, '9007199254740993')

  const legacy = await app.request('/app/user/query', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      page: 1,
      pageSize: 20,
      filters: { search: '张三', status: 'ENABLED' },
      sort: [{ field: 'username', order: 'asc' }],
    }),
  })
  assert.equal((await legacy.json()).errorKey, 'validation_failed')
})
