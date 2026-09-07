import assert from 'node:assert/strict'
import test from 'node:test'

import { modelBuildId } from '@zerp/model'

import { createApp } from '../../src/app.ts'
import type { ManagementService } from '../../src/app/management.ts'
import type { SessionService } from '../../src/app/session.ts'
import { loadConfig } from '../../src/platform/config.ts'

const principal = {
  sessionId: '01J00000000000000000000001',
  user: { id: '01J00000000000000000000002', code: 'admin', name: '管理员' },
  csrfToken: 'csrf',
  apiPaths: ['/app/role/query'],
  passwordChangeRequired: false,
  passwordMinLength: 12,
  absoluteExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
}

function appWith(management: ManagementService) {
  return createApp({
    session: { authenticate: async () => principal } as unknown as SessionService,
    management,
    config: loadConfig({
      DATABASE_URL: 'postgres://zerp:password@127.0.0.1:5432/zerp_test',
      APP_SESSION_COOKIE_SECURE: 'false',
    }),
  })
}

const headers = {
  'content-type': 'application/json',
  'x-zerp-model-build': modelBuildId,
}

test('app/role query exposes the strict native role contract', async () => {
  let received: unknown
  const app = appWith({
    queryRoles: async (input: unknown) => {
      received = input
      return {
        items: [
          {
            id: '01J00000000000000000000003',
            code: 'ROL-001',
            py: 'caiwu',
            name: '财务',
            description: null,
            enabled: true,
            revision: '9007199254740993',
            type: 'NORMAL',
            manageable: true,
            assignable: true,
            availableActions: ['edit', 'disable'],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }
    },
  } as unknown as ManagementService)

  const response = await app.request('/app/role/query', {
    method: 'POST',
    headers,
    body: JSON.stringify({ keyword: '财务', page: 1, pageSize: 20 }),
  })
  const payload = await response.json()

  assert.equal(payload.code, 0)
  assert.deepEqual(received, { keyword: '财务', page: 1, pageSize: 20 })
  assert.deepEqual(Object.keys(payload.data.items[0]).sort(), [
    'assignable',
    'availableActions',
    'code',
    'description',
    'enabled',
    'id',
    'manageable',
    'name',
    'py',
    'revision',
    'type',
  ])
  assert.deepEqual(payload.data.items[0].availableActions, ['edit', 'disable'])
  assert.equal(payload.data.items[0].revision, '9007199254740993')

  for (const body of [
    { keyword: '', page: 1, pageSize: 21 },
    { keyword: '', page: 1, pageSize: 20, status: 'ENABLED' },
    { page: 1, pageSize: 20, filters: { status: 'ENABLED' } },
  ]) {
    const rejected = await app.request('/app/role/query', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    assert.equal((await rejected.json()).errorKey, 'validation_failed')
  }
})

test('app/role mutations reject legacy fields, numeric revisions, and empty permissions', async () => {
  const app = appWith({} as ManagementService)
  const cases: Array<[string, unknown]> = [
    [
      '/app/role/create',
      { name: '财务', description: null, permissionIds: [] },
    ],
    [
      '/app/role/create',
      {
        name: '财务',
        description: null,
        permissionIds: ['01J00000000000000000000004'],
        code: 'ROL-001',
      },
    ],
    [
      '/app/role/save',
      {
        id: '01J00000000000000000000003',
        name: '财务',
        description: null,
        permissionIds: ['01J00000000000000000000004'],
        revision: 9007199254740992,
      },
    ],
    [
      '/app/role/save',
      {
        id: '01J00000000000000000000003',
        name: '财务',
        description: null,
        permissionIds: ['01J00000000000000000000004'],
        revision: '9007199254740993',
        status: 'ENABLED',
      },
    ],
    [
      '/app/role/enable',
      { id: '01J00000000000000000000003', revision: 9007199254740992 },
    ],
  ]

  for (const [path, body] of cases) {
    const response = await app.request(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    assert.equal(
      (await response.json()).errorKey,
      'validation_failed',
      `${path} must reject ${JSON.stringify(body)}`,
    )
  }
})
