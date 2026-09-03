import assert from 'node:assert/strict'
import test from 'node:test'

import { validateTargetRouteMetadata } from './target-artifacts.ts'

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
