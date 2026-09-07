import assert from 'node:assert/strict'
import test from 'node:test'
import { wflRouteMetadata } from '../../src/wfl/contract.ts'

test('WFL owns current definitions and distinct submission lifecycle endpoints', () => {
  const paths = new Set(wflRouteMetadata.map((route) => route.path))
  for (const action of [
    'query',
    'get',
    'submission-query',
    'submission-get',
    'submit-new',
    'submit-change',
    'approve',
    'versions',
    'enable',
    'disable',
  ])
    assert.ok(paths.has(`/wfl/process-definition/${action}` as never), action)
  assert.ok([...paths].every((path) => !path.startsWith('/dcl/')))
})
