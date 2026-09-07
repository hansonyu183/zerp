import assert from 'node:assert/strict'
import test from 'node:test'
import { targetRouteMetadata } from '../../src/app/routes.ts'

test('asset maintenance exposes AUX current actions and removes DCL and BOB asset routes', () => {
  const paths = new Set(targetRouteMetadata.map((route) => route.path))
  for (const entity of ['warehouse', 'fund-account', 'vehicle']) {
    for (const action of [
      'query',
      'get',
      'create',
      'save',
      'enable',
      'disable',
      'delete',
    ])
      assert.ok(
        paths.has(`/aux/${entity}/${action}`),
        `missing AUX ${entity} ${action}`,
      )
    for (const path of paths)
      assert.ok(
        !path.startsWith(`/dcl/${entity}/`) &&
          !path.startsWith(`/bob/${entity}/`),
        path,
      )
  }
})
