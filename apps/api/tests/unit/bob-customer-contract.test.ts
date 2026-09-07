import assert from 'node:assert/strict'
import test from 'node:test'
import { targetRouteMetadata } from '../../src/app/contract.ts'

test('Customer exposes BOB current, submission, lifecycle and attachment actions only', () => {
  const paths = targetRouteMetadata.map((route) => route.path)
  for (const action of [
    'query',
    'get',
    'submission-query',
    'submission-get',
    'versions',
    'audit-history',
    'submit-new',
    'submit-change',
    'approve',
    'reject',
    'unreject',
    'unapprove',
    'delete',
    'enable',
    'disable',
    'attachment-stage',
    'attachment-cleanup',
  ]) {
    assert.ok(paths.includes(`/bob/customer/${action}`), action)
  }
  assert.equal(
    paths.some((path) => path.startsWith('/dcl/customer/')),
    false,
  )
})
