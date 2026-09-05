import assert from 'node:assert/strict'
import test from 'node:test'

import { projectRptPage } from '../../src/rpt/service.ts'

test('RPT page projects one lookahead row into typed hasMore', () => {
  assert.deepEqual(projectRptPage([{ id: 1 }, { id: 2 }], 1), {
    rows: [{ id: 1 }],
    hasMore: true,
  })
  assert.deepEqual(projectRptPage([{ id: 1 }], 1), {
    rows: [{ id: 1 }],
    hasMore: false,
  })
})
