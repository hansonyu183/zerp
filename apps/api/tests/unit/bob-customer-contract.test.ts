import assert from 'node:assert/strict'
import test from 'node:test'
import { targetRouteMetadata } from '../../src/app/contract.ts'

test('Customer splits formal/history and maintenance capabilities', () => {
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
    'attachment-read',
    'attachment-cleanup',
  ]) {
    assert.ok(
      paths.includes(
        `/${['query', 'get', 'versions', 'audit-history', 'enable', 'disable', 'attachment-read'].includes(action) ? 'bob' : 'dcl'}/customer/${action}`,
      ),
      action,
    )
  }
  assert.equal(paths.includes('/bob/customer/submit-change'), false)
})
