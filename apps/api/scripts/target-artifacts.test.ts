import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  auxRouteBinding,
  bobRouteBinding,
} from '../src/app/independent-contract.ts'
import { validateTargetRouteMetadata } from './target-artifacts.ts'

const generatedOpenApi = new URL(
  '../src/generated/openapi.json',
  import.meta.url,
)

const userQuery = {
  method: 'post',
  path: '/app/user/query',
  permission: '/app/user/query',
  menu: { title: '用户管理', group: '系统管理', order: 10 },
} as const

test('target artifact gate rejects missing, duplicate, and extra route metadata', () => {
  assert.throws(
    () => validateTargetRouteMetadata(['POST /app/user/signin'], []),
    /missing=POST \/app\/user\/signin/,
  )
  assert.throws(
    () =>
      validateTargetRouteMetadata(
        ['POST /app/user/query'],
        [userQuery, userQuery],
      ),
    /duplicate target route metadata/,
  )
  assert.throws(
    () =>
      validateTargetRouteMetadata(
        ['POST /app/user/query'],
        [{ method: 'post', path: '/app/user/session' }],
      ),
    /missing=POST \/app\/user\/query extra=POST \/app\/user\/session/,
  )
})

test('target artifact gate emits one exact permission and menu catalog entry', () => {
  assert.deepEqual(
    validateTargetRouteMetadata(['POST /app/user/query'], [userQuery]),
    [
      {
        id: '01J4C89A32EE3460059789A73F',
        path: '/app/user/query',
        domain: 'app',
        entity: 'user',
        action: 'query',
        title: '用户管理',
        group: '系统管理',
        order: 10,
      },
    ],
  )
})

test('target artifact gate emits action permissions without creating duplicate menus', () => {
  assert.deepEqual(
    validateTargetRouteMetadata(
      ['POST /dcl/warehouse/approve'],
      [
        {
          method: 'post',
          path: '/dcl/warehouse/approve',
          permission: '/dcl/warehouse/approve',
          title: '批准仓库申报',
        },
      ],
    ),
    [
      {
        id: '01J9F8A0A4F06EBCAB84681A2E',
        path: '/dcl/warehouse/approve',
        domain: 'dcl',
        entity: 'warehouse',
        action: 'approve',
        title: '批准仓库申报',
        group: null,
        order: null,
      },
    ],
  )
})

test('independent route bindings carry the exact registered permission', () => {
  assert.deepEqual(auxRouteBinding('department', 'create'), {
    entity: 'department',
    action: 'create',
    permission: '/aux/department/create',
  })
  assert.deepEqual(bobRouteBinding('employee', 'get'), {
    entity: 'employee',
    action: 'get',
    permission: '/bob/employee/get',
  })
})

test('target OpenAPI contains the complete issue 363 APP, AUX, and BOB inventory', async () => {
  const document = JSON.parse(await readFile(generatedOpenApi, 'utf8')) as {
    paths: Record<string, unknown>
  }
  const paths = new Set(Object.keys(document.paths))
  const appPaths = [
    '/app/branding/get',
    '/app/menu/activate',
    '/app/menu/get',
    '/app/menu/reset-business',
    '/app/menu/save-business',
    '/app/permission/get',
    '/app/permission/query',
    '/app/role/create',
    '/app/role/disable',
    '/app/role/enable',
    '/app/role/get',
    '/app/role/query',
    '/app/role/save',
    '/app/system-parameter/get',
    '/app/system-parameter/query',
    '/app/system-parameter/reset',
    '/app/system-parameter/save',
    '/app/user/change-password',
    '/app/user/create',
    '/app/user/disable',
    '/app/user/enable',
    '/app/user/get',
    '/app/user/profile',
    '/app/user/query',
    '/app/user/reset-password',
    '/app/user/save',
    '/app/user/session',
    '/app/user/signin',
    '/app/user/signout',
  ]
  const auxEntities = [
    'product-category',
    'product-type',
    'employee-category',
    'department',
    'position',
    'settlement-method',
    'payment-method',
    'dictionary-type',
    'dictionary-item',
    'measurement-unit',
    'income-expense-type',
    'asset-category',
  ]
  const auxPaths = auxEntities.flatMap((entity) =>
    ['query', 'get', 'save', 'enable', 'disable', 'create', 'delete']
      .filter(
        (action) =>
          entity !== 'settlement-method' ||
          (action !== 'create' && action !== 'delete'),
      )
      .map((action) => `/aux/${entity}/${action}`),
  )
  auxPaths.push('/aux/reference/query')
  const bobPaths = [
    'customer',
    'supplier',
    'employee',
    'other-unit',
    'sales-partner',
    'product',
    'warehouse',
    'vehicle',
    'fund-account',
    'operating-entity',
  ].flatMap((entity) => [`/bob/${entity}/query`, `/bob/${entity}/get`])
  bobPaths.push('/bob/reference/query')

  for (const path of [...appPaths, ...auxPaths, ...bobPaths])
    assert.ok(paths.has(path), `missing issue #363 target path ${path}`)
  assert.ok(!paths.has('/app/workbench/query'), 'APP Workbench belongs to #366')
})
