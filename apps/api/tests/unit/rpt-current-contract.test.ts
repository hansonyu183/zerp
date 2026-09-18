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

test('maintenance query validates filters and requires fixed twenty-row pages', () => {
  const route = rptRouteSet.definitionQuery
  assert.equal(route?.path, '/rpt/definition/query')
  const schema = route.request.body.content['application/json'].schema
  assert.equal(
    schema.safeParse({
      keyword: '',
      page: 1,
      pageSize: 20,
      validity: 'INVALID',
      enabled: false,
    }).success,
    true,
  )
  assert.equal(schema.safeParse({ page: 0, pageSize: 20 }).success, false)
  assert.equal(schema.safeParse({ page: 1, pageSize: 100 }).success, false)
})
