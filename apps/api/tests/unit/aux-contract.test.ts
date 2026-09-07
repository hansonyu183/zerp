import assert from 'node:assert/strict'
import test from 'node:test'

import { createApp } from '../../src/app.ts'
import type { SessionService } from '../../src/app/session.ts'
import type { AuxService } from '../../src/aux/service.ts'
import { loadConfig } from '../../src/platform/config.ts'

const id = '01J00000000000000000000003'
const principal = {
  sessionId: '01J00000000000000000000001',
  user: { id: '01J00000000000000000000002', code: 'admin', name: '管理员' },
  csrfToken: 'csrf',
  apiPaths: [
    '/aux/employee-category/query',
    '/aux/employee-category/get',
    '/aux/employee-category/create',
    '/aux/employee-category/save',
    '/aux/employee-category/enable',
    '/aux/employee-category/disable',
    '/aux/employee-category/delete',
    '/aux/measurement-unit/query',
  ],
  passwordChangeRequired: false,
  passwordMinLength: 12,
  absoluteExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
}

function appWith(aux: AuxService) {
  return createApp({
    session: {
      authenticate: async () => principal,
    } as unknown as SessionService,
    aux,
    config: loadConfig({
      DATABASE_URL: 'postgres://zerp:password@127.0.0.1:5432/zerp_test',
      APP_SESSION_COOKIE_SECURE: 'false',
    }),
  })
}

async function post(
  app: ReturnType<typeof appWith>,
  path: string,
  body: unknown,
) {
  return (
    await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json()
}

test('AUX management exposes native summary and typed employee-category detail', async () => {
  const received: Array<[string, unknown]> = []
  const detail = {
    id,
    code: 'ECT-0001',
    py: 'yixianyuangong',
    name: '一线员工',
    description: '生产岗位人员',
    enabled: true,
    revision: '9007199254740993',
    availableActions: ['edit', 'disable'] as const,
    updatedAt: '2026-09-06T00:00:00.000Z',
    updatedBy: principal.user.id,
  }
  const app = appWith({
    query: async (_entity: unknown, input: unknown) => {
      received.push(['query', input])
      return {
        items: [
          {
            id: detail.id,
            code: detail.code,
            py: detail.py,
            name: detail.name,
            enabled: detail.enabled,
            revision: detail.revision,
            availableActions: detail.availableActions,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }
    },
    get: async (_entity: unknown, input: unknown) => {
      received.push(['get', input])
      return detail
    },
  } as unknown as AuxService)

  const queried = await post(app, '/aux/employee-category/query', {
    keyword: 'yixian',
    page: 1,
    pageSize: 20,
  })
  const fetched = await post(app, '/aux/employee-category/get', { id })

  assert.equal(queried.code, 0)
  assert.deepEqual(received[0], [
    'query',
    { keyword: 'yixian', page: 1, pageSize: 20 },
  ])
  assert.deepEqual(Object.keys(queried.data.items[0]).sort(), [
    'availableActions',
    'code',
    'enabled',
    'id',
    'name',
    'py',
    'revision',
  ])
  assert.equal(fetched.code, 0)
  assert.deepEqual(received[1], ['get', { id }])
  assert.deepEqual(fetched.data, detail)
})

test('measurement-unit query accepts only its quantity-scale filter', async () => {
  let received: unknown
  const app = appWith({
    query: async (_entity: unknown, input: unknown) => {
      received = input
      return {
        items: [
          {
            id,
            code: 'UNT-0001',
            py: 'qianke',
            name: '千克',
            symbol: 'kg',
            quantityScale: 0,
            enabled: true,
            revision: '1',
            availableActions: ['edit', 'disable'],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      }
    },
  } as unknown as AuxService)

  const queried = await post(app, '/aux/measurement-unit/query', {
    keyword: 'kg',
    quantityScale: 0,
    page: 1,
    pageSize: 20,
  })
  assert.equal(queried.code, 0)
  assert.deepEqual(received, {
    keyword: 'kg',
    quantityScale: 0,
    page: 1,
    pageSize: 20,
  })
  assert.deepEqual(queried.data.items[0], {
    id,
    code: 'UNT-0001',
    py: 'qianke',
    name: '千克',
    symbol: 'kg',
    quantityScale: 0,
    enabled: true,
    revision: '1',
    availableActions: ['edit', 'disable'],
  })

  for (const quantityScale of [-1, 1.5, 7, '0']) {
    const rejected = await post(app, '/aux/measurement-unit/query', {
      keyword: 'kg',
      quantityScale,
      page: 1,
      pageSize: 20,
    })
    assert.equal(rejected.errorKey, 'validation_failed')
  }
})

test('AUX employee-category mutations use direct typed fields and string revisions', async () => {
  const received: Array<[string, unknown]> = []
  const mutation = { id, revision: '9007199254740994', enabled: true }
  const app = appWith({
    create: async (_entity: unknown, input: unknown) => {
      received.push(['create', input])
      return { id, revision: '1', enabled: true }
    },
    save: async (_entity: unknown, input: unknown) => {
      received.push(['save', input])
      return mutation
    },
    enable: async (_entity: unknown, input: unknown) => {
      received.push(['enable', input])
      return mutation
    },
    disable: async (_entity: unknown, input: unknown) => {
      received.push(['disable', input])
      return { ...mutation, enabled: false }
    },
    delete: async (_entity: unknown, input: unknown) => {
      received.push(['delete', input])
    },
  } as unknown as AuxService)

  assert.equal(
    (
      await post(app, '/aux/employee-category/create', {
        name: '一线员工',
        description: '生产岗位人员',
      })
    ).code,
    0,
  )
  assert.equal(
    (
      await post(app, '/aux/employee-category/save', {
        id,
        revision: '9007199254740993',
        name: '生产员工',
        description: '',
      })
    ).code,
    0,
  )
  assert.equal(
    (
      await post(app, '/aux/employee-category/enable', {
        id,
        revision: '9007199254740993',
      })
    ).code,
    0,
  )
  assert.equal(
    (
      await post(app, '/aux/employee-category/delete', {
        id,
        revision: '9007199254740993',
      })
    ).code,
    0,
  )

  assert.deepEqual(received.slice(0, 2), [
    ['create', { name: '一线员工', description: '生产岗位人员' }],
    [
      'save',
      {
        id,
        revision: '9007199254740993',
        name: '生产员工',
        description: '',
      },
    ],
  ])
  assert.deepEqual(received[2]?.[1], {
    id,
    revision: '9007199254740993',
  })
  assert.deepEqual(received[3], [
    'delete',
    { id, revision: '9007199254740993' },
  ])
})

test('AUX management rejects the replaced query and mutation protocol', async () => {
  const app = appWith({} as AuxService)
  const cases: Array<[string, unknown]> = [
    [
      '/aux/employee-category/query',
      { page: 1, pageSize: 20, filters: { keyword: '员工' } },
    ],
    ['/aux/employee-category/query', { keyword: '', page: 1, pageSize: 21 }],
    ['/aux/employee-category/get', { objectId: id }],
    [
      '/aux/employee-category/create',
      { data: { name: '员工', description: '' } },
    ],
    [
      '/aux/employee-category/create',
      { name: '员工', description: '', code: 'ECT-0001' },
    ],
    [
      '/aux/employee-category/save',
      { id, revision: 9007199254740992, name: '员工', description: '' },
    ],
    [
      '/aux/employee-category/save',
      {
        objectId: id,
        objectRevision: 1,
        data: { name: '员工', description: '' },
      },
    ],
    ['/aux/employee-category/disable', { id, revision: '1', enabled: false }],
    ['/aux/employee-category/delete', { objectId: id, objectRevision: 1 }],
  ]

  for (const [path, body] of cases) {
    const response = await post(app, path, body)
    assert.equal(
      response.errorKey,
      'validation_failed',
      `${path} must reject ${JSON.stringify(body)}`,
    )
  }
})

test('all twelve AUX entities expose one strict typed management protocol', async () => {
  const validInputs = {
    'product-category': {
      name: '原料',
      parentId: '',
      description: '',
    },
    'product-type': {
      name: '标准成品',
      behaviorProfile: 'STANDARD_FINISHED',
      description: '',
    },
    'employee-category': { name: '一线员工', description: '' },
    department: { name: '生产部', parentId: '', description: '' },
    position: { name: '操作员', description: '' },
    'settlement-method': {
      name: '月结30天',
      termCode: 'MONTHLY_30',
      ruleType: 'MONTH_END',
      monthOffset: 1,
      dayOfMonth: 0,
      dayOffset: 0,
      defaultSalesSurcharge: '0.00',
      description: '',
    },
    'payment-method': { name: '银行转账' },
    'dictionary-type': { name: '客户类型', description: '' },
    'dictionary-item': {
      name: '普通客户',
      dictionaryTypeId: '01J00000000000000000000004',
      sortOrder: 1,
    },
    'measurement-unit': { name: '千克', symbol: 'kg', quantityScale: 3 },
    'income-expense-type': {
      name: '主营收入',
      direction: 'INCOME',
      parentId: '',
      description: '',
    },
    'asset-category': {
      name: '机器设备',
      defaultUsefulLifeMonths: 120,
      defaultResidualRate: '5.00',
      description: '',
    },
  } as const
  const app = appWith({
    query: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }),
    get: async (entity: keyof typeof validInputs) => ({
      id,
      code: 'AUX-0001',
      py: 'ceshi',
      enabled: true,
      revision: '1',
      availableActions: [],
      ...validInputs[entity],
      ...(entity === 'dictionary-item'
        ? { dictionaryTypeCode: 'DCT-0001', dictionaryTypeName: '客户类型' }
        : {}),
      updatedAt: '2026-09-06T00:00:00.000Z',
      updatedBy: principal.user.id,
    }),
    create: async () => ({ id, revision: '1', enabled: true }),
    save: async () => ({ id, revision: '2', enabled: true }),
    enable: async () => ({ id, revision: '2', enabled: true }),
    disable: async () => ({ id, revision: '2', enabled: false }),
    delete: async () => undefined,
  } as unknown as AuxService)

  for (const [entity, fields] of Object.entries(validInputs)) {
    const query = await post(app, `/aux/${entity}/query`, {
      keyword: '',
      page: 1,
      pageSize: 20,
    })
    assert.equal(query.code, 0, `${entity} query`)
    const get = await post(app, `/aux/${entity}/get`, { id })
    assert.equal(get.code, 0, `${entity} get`)

    if (entity !== 'settlement-method') {
      const create = await post(app, `/aux/${entity}/create`, fields)
      assert.equal(create.code, 0, `${entity} create`)
      const createWithServerField = await post(app, `/aux/${entity}/create`, {
        ...fields,
        code: 'CLIENT-CODE',
      })
      assert.equal(
        createWithServerField.errorKey,
        'validation_failed',
        `${entity} create server field`,
      )
    }

    const save = await post(app, `/aux/${entity}/save`, {
      id,
      revision: '9007199254740993',
      ...fields,
    })
    assert.equal(save.code, 0, `${entity} save`)
    const numericRevision = await post(app, `/aux/${entity}/save`, {
      id,
      revision: 9007199254740992,
      ...fields,
    })
    assert.equal(
      numericRevision.errorKey,
      'validation_failed',
      `${entity} numeric revision`,
    )
  }
  for (const quantityScale of [0, 6]) {
    assert.equal(
      (
        await post(app, '/aux/measurement-unit/create', {
          name: '千克',
          symbol: 'kg',
          quantityScale,
        })
      ).code,
      0,
    )
  }
  for (const fields of [
    { name: '千克', symbol: 'kg', quantityScale: -1 },
    { name: '千克', symbol: 'kg', quantityScale: 7 },
    { name: '千克', symbol: 'kg', quantityScale: 1.5 },
    { name: '千克', symbol: '', quantityScale: 3 },
    { name: '千克', symbol: 'kg', quantityScale: 3, description: '' },
  ])
    assert.equal(
      (await post(app, '/aux/measurement-unit/create', fields)).errorKey,
      'validation_failed',
    )

  for (const [defaultUsefulLifeMonths, defaultResidualRate] of [
    [1, '0.00'],
    [1200, '99.99'],
  ] as const)
    assert.equal(
      (
        await post(app, '/aux/asset-category/create', {
          name: '机器设备',
          defaultUsefulLifeMonths,
          defaultResidualRate,
          description: '',
        })
      ).code,
      0,
    )

  for (const fields of [
    { defaultUsefulLifeMonths: 0, defaultResidualRate: '5.00' },
    { defaultUsefulLifeMonths: 1201, defaultResidualRate: '5.00' },
    { defaultUsefulLifeMonths: 1.5, defaultResidualRate: '5.00' },
    { defaultUsefulLifeMonths: 120, defaultResidualRate: '-0.01' },
    { defaultUsefulLifeMonths: 120, defaultResidualRate: '100.00' },
    { defaultUsefulLifeMonths: 120, defaultResidualRate: '5.001' },
    { defaultUsefulLifeMonths: 120, defaultResidualRate: '01.00' },
  ])
    assert.equal(
      (
        await post(app, '/aux/asset-category/create', {
          name: '机器设备',
          description: '',
          ...fields,
        })
      ).errorKey,
      'validation_failed',
    )
})
