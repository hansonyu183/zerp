import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ulid } from 'ulid'

import { TargetBootstrapService } from '../../src/app/bootstrap.ts'
import {
  auxPeoplePermissionMappings,
  preserveLegacyAuxAssetPermissionCatalog,
} from '../../src/aux/migration.ts'
import { auxAssetPermissionMappings } from '../../src/aux/migration-assets.ts'
import { bobArchivePermissionMappings } from '../../src/bob/migration.ts'
import { preserveLegacyBobArchivePermissionCatalog } from '../../src/bob/migration-guard.ts'
import { customerPermissionMappings } from '../../src/bob/customer-permissions.ts'
import {
  productPermissionMappings,
  preserveLegacyMappedPermissions,
} from '../../src/bob/product-permissions.ts'
import { createDatabase } from '../../src/db/database.ts'
import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'

// Exercise the real catalog writer in one rollback-only outer transaction:
// this regression does not re-run data migrations or commit catalog changes.
test('AUX people, AUX assets and all BOB catalog stages preserve exact role grants in order', async () => {
  assert.ok(process.env.TARGET_TEST_DATABASE_URL)
  const db = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
  const bootstrap = new TargetBootstrapService(db)
  const allMappings = [
    ...bobArchivePermissionMappings,
    ...productPermissionMappings,
    ...customerPermissionMappings,
  ]
  const catalog = JSON.parse(
    await readFile(
      new URL(
        '../../src/generated/target-permission-catalog.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as TargetPermissionCatalogEntry[]
  const rollback = new Error('rollback successful sequence fixture')
  try {
    await assert.rejects(
      db.transaction().execute(async (tx) => {
        const roleId = ulid()
        await tx
          .insertInto('app_roles')
          .values({
            id: roleId,
            code: `sequence-${roleId}`,
            name: '迁移顺序回归',
            status: 'ENABLED',
          })
          .execute()
        for (const mapping of allMappings) {
          let permission = await tx
            .selectFrom('app_permissions')
            .select('id')
            .where('path', '=', mapping.from)
            .executeTakeFirst()
          if (!permission) {
            permission = { id: ulid() }
            await tx
              .insertInto('app_permissions')
              .values({
                id: permission.id,
                path: mapping.from,
                domain: 'dcl',
                status: 'ENABLED',
                entity: mapping.from.split('/')[2]!,
                action: mapping.from.split('/')[3]!,
                description: '迁移顺序回归',
              })
              .execute()
          }
          await tx
            .insertInto('app_role_permissions')
            .values({ role_id: roleId, permission_id: permission.id })
            .execute()
        }
        const existing = () =>
          tx
            .selectFrom('app_permissions')
            .select(['id', 'path', 'domain', 'entity', 'action', 'description'])
            .execute()
        const grants = async () =>
          (
            await tx
              .selectFrom('app_role_permissions as rp')
              .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
              .select('p.path')
              .where('rp.role_id', '=', roleId)
              .execute()
          )
            .map((row) => row.path)
            .sort()
        const legacy = allMappings.map((mapping) => mapping.from).sort()
        await bootstrap.migratePermissionCatalogInTransaction(
          tx,
          preserveLegacyAuxAssetPermissionCatalog(catalog, await existing()),
          auxPeoplePermissionMappings,
        )
        assert.deepEqual(await grants(), legacy)
        await bootstrap.migratePermissionCatalogInTransaction(
          tx,
          preserveLegacyBobArchivePermissionCatalog(catalog, await existing()),
          auxAssetPermissionMappings,
        )
        assert.deepEqual(await grants(), legacy)
        await bootstrap.migratePermissionCatalogInTransaction(
          tx,
          preserveLegacyMappedPermissions(catalog, await existing(), [
            ...productPermissionMappings,
            ...customerPermissionMappings,
          ]),
          bobArchivePermissionMappings,
        )
        assert.deepEqual(
          await grants(),
          [
            ...bobArchivePermissionMappings.flatMap((mapping) => mapping.to),
            ...productPermissionMappings.map((mapping) => mapping.from),
            ...customerPermissionMappings.map((mapping) => mapping.from),
          ].sort(),
        )
        await bootstrap.migratePermissionCatalogInTransaction(
          tx,
          preserveLegacyMappedPermissions(
            catalog,
            await existing(),
            customerPermissionMappings,
          ),
          productPermissionMappings,
        )
        assert.deepEqual(
          await grants(),
          [
            ...bobArchivePermissionMappings.flatMap((mapping) => mapping.to),
            ...productPermissionMappings.flatMap((mapping) => mapping.to),
            ...customerPermissionMappings.map((mapping) => mapping.from),
          ].sort(),
        )
        await bootstrap.migratePermissionCatalogInTransaction(
          tx,
          catalog,
          customerPermissionMappings,
        )
        assert.deepEqual(
          await grants(),
          allMappings.flatMap((mapping) => mapping.to).sort(),
        )
        assert.equal(
          (await grants()).some(
            (path) => path.endsWith('/enable') || path.endsWith('/disable'),
          ),
          false,
        )
        throw rollback
      }),
      (error) => error === rollback,
    )
  } finally {
    await db.destroy()
  }
})
