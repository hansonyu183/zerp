import assert from 'node:assert/strict'
import test from 'node:test'

import { bobArchivePermissionMappings } from '../../src/bob/migration.ts'
import { requiresBobArchivePermissionMigration } from '../../src/bob/migration-guard.ts'

test('ordinary catalog sync blocks legacy BOB archive grants before the mapped migration', () => {
  assert.equal(
    requiresBobArchivePermissionMigration(
      ['/dcl/supplier/query'],
      ['/bob/supplier/submission-query'],
    ),
    true,
  )
})

test('ordinary catalog sync proceeds when no legacy BOB archive grant exists', () => {
  assert.equal(
    requiresBobArchivePermissionMigration(
      ['/bob/supplier/submission-query'],
      ['/bob/supplier/submission-query'],
    ),
    false,
  )
})

test('guard covers every mapped supplier, other-unit, and sales-partner grant', () => {
  for (const mapping of bobArchivePermissionMappings)
    assert.equal(
      requiresBobArchivePermissionMigration([mapping.from], mapping.to),
      true,
    )
})

test('both preceding AUX catalog stages retain every legacy BOB grant until its own conversion', async () => {
  const { preserveLegacyAuxAssetPermissionCatalog } =
    await import('../../src/aux/migration.ts')
  const { preserveLegacyBobArchivePermissionCatalog } =
    await import('../../src/bob/migration-guard.ts')
  const existing = bobArchivePermissionMappings.map((mapping, index) => ({
    id: `legacy-${index}`,
    path: mapping.from,
    domain: 'dcl',
    entity: mapping.from.split('/')[2]!,
    action: mapping.from.split('/')[3]!,
    description: '旧授权',
  }))
  const target = bobArchivePermissionMappings.flatMap((mapping) =>
    mapping.to.map((path) => ({
      id: path,
      path,
      domain: 'bob',
      entity: path.split('/')[2]!,
      action: path.split('/')[3]!,
      title: '新授权',
    })),
  )
  const people = preserveLegacyAuxAssetPermissionCatalog(target, existing)
  const assets = preserveLegacyBobArchivePermissionCatalog(
    target,
    people.map((entry) => ({ ...entry, description: entry.title })),
  )
  for (const stage of [people, assets])
    for (const permission of existing)
      assert.equal(
        stage.find((entry) => entry.path === permission.path)?.id,
        permission.id,
      )
  assert.deepEqual(
    preserveLegacyBobArchivePermissionCatalog(target, []),
    target,
  )
})

test('product legacy grants survive earlier migrations and block ordinary catalog sync', async () => {
  const { preserveLegacyBobArchivePermissionCatalog } =
    await import('../../src/bob/migration-guard.ts')
  const source = {
    id: 'product-grant',
    path: '/dcl/product/query',
    domain: 'dcl',
    entity: 'product',
    action: 'query',
    description: '产品提交查询',
  }
  assert.equal(
    requiresBobArchivePermissionMigration(
      [source.path],
      ['/bob/product/submission-query'],
    ),
    true,
  )
  assert.equal(
    preserveLegacyBobArchivePermissionCatalog([], [source])[0]?.path,
    source.path,
  )
})
