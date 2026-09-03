import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../../', import.meta.url)

test('isolated target schema contains only APP and Warehouse slice facts', async () => {
  const schema = await readFile(
    new URL('apps/api/db/target-schema.sql', root),
    'utf8',
  )
  const compose = await readFile(new URL('compose.target.yaml', root), 'utf8')
  const tables = [...schema.matchAll(/CREATE TABLE ([a-z0-9_]+)/g)].map(
    (match) => match[1],
  )
  assert.deepEqual(tables, [
    'app_users',
    'app_user_profiles',
    'app_permissions',
    'app_roles',
    'app_role_permissions',
    'app_user_roles',
    'app_sessions',
    'dcl_code_counters',
    'dcl_subjects',
    'approval_entries',
    'dcl_warehouse_versions',
    'approval_events',
    'dcl_warehouse_idempotency',
    'dcl_warehouse_manager_reference_facts',
    'dcl_warehouse_reference_facts',
    'dcl_warehouse_usage_facts',
  ])
  assert.match(schema, /status IN \('PENDING', 'APPROVED', 'REJECTED'\)/)
  for (const legacy of ['DRAFT', 'WITHDRAWN', 'REVOKED', 'UNSUBMITTED'])
    assert.doesNotMatch(schema, new RegExp(`\\b${legacy}\\b`))
  assert.match(compose, /apps\/api\/db\/target-schema\.sql/)
  assert.doesNotMatch(compose, /backend\/db\/schema\.sql/)
})
