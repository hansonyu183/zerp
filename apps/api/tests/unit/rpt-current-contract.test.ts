import assert from 'node:assert/strict'
import test from 'node:test'
import { rptRouteSet } from '../../src/rpt/contract.ts'
test('RPT current configuration exposes save/get independently of report execution', () => {
  assert.equal(rptRouteSet.save?.path, '/rpt/definition/save')
  assert.equal(rptRouteSet.get?.path, '/rpt/definition/get')
  assert.equal(
    Object.keys(rptRouteSet).some((key) =>
      /approve|submit|versions/i.test(key),
    ),
    false,
  )
})
