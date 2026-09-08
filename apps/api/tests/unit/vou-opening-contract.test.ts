import assert from 'node:assert/strict'
import test from 'node:test'
import { targetRouteMetadata } from '../../src/app/routes.ts'

test('opening has one VOU approval entrance and no ACC approval entrance', () => {
  const paths = targetRouteMetadata.map((route) => route.path)
  for (const action of [
    'query',
    'get',
    'submit-new',
    'approve',
    'reject',
    'unreject',
    'unapprove',
    'delete',
  ]) {
    assert.ok(paths.includes(`/vou/opening/${action}`), action)
    assert.ok(!paths.includes(`/acc/opening/${action}`), action)
  }
})
