import assert from 'node:assert/strict'
import pg from 'pg'

import { readTargetPermissionCatalog } from './target-artifacts.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl)
  throw new Error(
    'TARGET_DATABASE_URL is required to check the target permission catalog',
  )
if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test'))
  throw new Error(
    'target catalog check only accepts a disposable *_test database',
  )

const expected = await readTargetPermissionCatalog()
const pool = new pg.Pool({ connectionString: databaseUrl })
try {
  const result = await pool.query<{
    id: string
    path: string
    domain: string
    entity: string
    action: string
    description: string
    menu_order: number | null
  }>(
    'SELECT id, path, domain, entity, action, description, menu_order FROM public.app_permissions ORDER BY path',
  )
  assert.deepEqual(
    result.rows,
    expected.map((entry) => ({
      id: entry.id,
      path: entry.path,
      domain: entry.domain,
      entity: entry.entity,
      action: entry.action,
      description: entry.title,
      menu_order: entry.order,
    })),
    'target database permission catalog must be exactly generated from target route metadata',
  )
} finally {
  await pool.end()
}
