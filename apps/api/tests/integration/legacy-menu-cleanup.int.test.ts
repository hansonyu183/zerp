import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { sql } from 'kysely'

import { createDatabase } from '../../src/db/database.ts'
import { userPinyin } from '../../src/app/user-pinyin.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
const cleanupScript = fileURLToPath(
  new URL('../../scripts/cleanup-legacy-menu.ts', import.meta.url),
)

function runCleanup() {
  return spawnSync(process.execPath, [cleanupScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ZERP_LEGACY_MENU_CLEANUP: 'confirm',
      TARGET_DATABASE_URL: databaseUrl,
      TARGET_DATABASE_SCOPE: 'isolated',
    },
  })
}

async function menuSchemaState(db: ReturnType<typeof createDatabase>) {
  const [tables, columns] = await Promise.all([
    sql<{ settings: string | null; items: string | null }>`
      SELECT to_regclass('public.app_menu_settings')::text AS settings,
        to_regclass('public.app_business_menu_items')::text AS items
    `.execute(db),
    sql<{ column_name: string }>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_permissions'
        AND column_name IN ('menu_group', 'menu_order')
      ORDER BY column_name
    `.execute(db),
  ])
  return {
    settings: tables.rows[0]?.settings ?? null,
    items: tables.rows[0]?.items ?? null,
    permissionColumns: columns.rows.map((row) => row.column_name),
  }
}

test('legacy menu cleanup preserves facts and rejects a partial baseline', async (context) => {
  assert.ok(databaseUrl, 'TARGET_TEST_DATABASE_URL is required')
  const db = createDatabase(databaseUrl)
  const suffix = randomBytes(8).toString('hex').toUpperCase()
  const userId = `M${suffix}`.padEnd(26, '0')
  const roleId = `R${suffix}`.padEnd(26, '0')
  const auditId = `A${suffix}`.padEnd(26, '0')
  const menuItemId = `legacy-menu-${suffix}`
  const permission = await db
    .selectFrom('app_permissions')
    .select('id')
    .where('path', '=', '/app/user/query')
    .executeTakeFirst()
  assert.ok(permission, 'target catalog must contain /app/user/query')

  context.after(async () => {
    try {
      await sql`DROP TABLE IF EXISTS public.app_business_menu_items`.execute(db)
      await sql`DROP TABLE IF EXISTS public.app_menu_settings`.execute(db)
      await sql`
        ALTER TABLE public.app_permissions
        DROP COLUMN IF EXISTS menu_group,
        DROP COLUMN IF EXISTS menu_order
      `.execute(db)
      await db
        .deleteFrom('app_audit_events')
        .where('id', '=', auditId)
        .execute()
      await db
        .deleteFrom('app_user_roles')
        .where('user_id', '=', userId)
        .execute()
      await db
        .deleteFrom('app_role_permissions')
        .where('role_id', '=', roleId)
        .execute()
      await db.deleteFrom('app_roles').where('id', '=', roleId).execute()
      await db.deleteFrom('app_users').where('id', '=', userId).execute()
    } finally {
      await db.destroy()
    }
  })

  await db
    .insertInto('app_users')
    .values({
      id: userId,
      username: `legacy-menu-${suffix.toLowerCase()}`,
      display_name: 'Legacy menu cleanup user',
      py: userPinyin('Legacy menu cleanup user'),
      password_hash: 'not-used',
      status: 'ENABLED',
      password_changed_at: new Date(),
    })
    .execute()
  await db
    .insertInto('app_roles')
    .values({
      id: roleId,
      code: `legacy-menu-${suffix.toLowerCase()}`,
      name: 'Legacy menu cleanup role',
      status: 'ENABLED',
    })
    .execute()
  await db
    .insertInto('app_user_roles')
    .values({ user_id: userId, role_id: roleId })
    .execute()
  await db
    .insertInto('app_role_permissions')
    .values({ role_id: roleId, permission_id: permission.id })
    .execute()
  await db
    .insertInto('app_audit_events')
    .values({
      id: auditId,
      event_type: 'LEGACY_MENU_CLEANUP_TEST',
      actor_user_id: userId,
      target_type: 'menu',
      target_id: '1',
      result: 'SUCCESS',
      request_id: `legacy-menu-${suffix}`,
      summary: { fixture: true },
      created_by: userId,
    })
    .execute()
  await sql`
    ALTER TABLE public.app_permissions
    ADD COLUMN menu_group varchar(128),
    ADD COLUMN menu_order integer
  `.execute(db)
  await sql`
    CREATE TABLE public.app_menu_settings (
      id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      menu_mode varchar(16) NOT NULL DEFAULT 'DEFAULT' CHECK (menu_mode IN ('DEFAULT', 'BUSINESS')),
      revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar(26) REFERENCES app_users(id)
    )
  `.execute(db)
  await sql`
    CREATE TABLE public.app_business_menu_items (
      id varchar(64) PRIMARY KEY,
      parent_id varchar(64) REFERENCES app_business_menu_items(id) ON DELETE CASCADE,
      item_type varchar(8) NOT NULL CHECK (item_type IN ('GROUP', 'ROUTE')),
      item_level smallint NOT NULL CHECK (item_level IN (1, 2)),
      sort_order integer NOT NULL CHECK (sort_order >= 0),
      display_name varchar(128) NOT NULL CHECK (btrim(display_name) <> ''),
      icon varchar(128),
      enabled boolean NOT NULL DEFAULT true,
      route_key varchar(128),
      permission_code varchar(256),
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by varchar(26) REFERENCES app_users(id),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by varchar(26) REFERENCES app_users(id),
      CHECK (
        (item_type = 'GROUP' AND item_level = 1 AND parent_id IS NULL AND route_key IS NULL AND permission_code IS NULL)
        OR (item_type = 'ROUTE' AND item_level = 1 AND parent_id IS NULL AND route_key IS NOT NULL AND permission_code IS NOT NULL)
        OR (item_type = 'ROUTE' AND item_level = 2 AND parent_id IS NOT NULL AND route_key IS NOT NULL AND permission_code IS NOT NULL)
      )
    )
  `.execute(db)
  await sql`INSERT INTO public.app_menu_settings(id, updated_by) VALUES (1, ${userId})`.execute(
    db,
  )
  await sql`
    INSERT INTO public.app_business_menu_items(
      id, item_type, item_level, sort_order, display_name,
      route_key, permission_code, created_by, updated_by
    ) VALUES (
      ${menuItemId}, 'ROUTE', 1, 1, 'Legacy menu',
      'app/user', '/app/user/query', ${userId}, ${userId}
    )
  `.execute(db)

  const factsBefore = await Promise.all([
    db
      .selectFrom('app_users')
      .select(['id', 'username'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('app_roles')
      .select(['id', 'code'])
      .where('id', '=', roleId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('app_role_permissions')
      .selectAll()
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('app_audit_events')
      .select([
        'id',
        'event_type',
        'actor_user_id',
        'target_type',
        'target_id',
        'result',
        'request_id',
        'summary',
        'created_by',
      ])
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow(),
  ])
  const cleanup = runCleanup()
  assert.equal(cleanup.status, 0, cleanup.stderr)
  assert.match(cleanup.stdout, /menuItems=1; menuSettings=1/)
  assert.deepEqual(await menuSchemaState(db), {
    settings: null,
    items: null,
    permissionColumns: [],
  })
  const repeatedCleanup = runCleanup()
  assert.equal(repeatedCleanup.status, 0, repeatedCleanup.stderr)
  assert.match(repeatedCleanup.stdout, /menuItems=0; menuSettings=0/)
  const factsAfter = await Promise.all([
    db
      .selectFrom('app_users')
      .select(['id', 'username'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('app_roles')
      .select(['id', 'code'])
      .where('id', '=', roleId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('app_role_permissions')
      .selectAll()
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('app_audit_events')
      .select([
        'id',
        'event_type',
        'actor_user_id',
        'target_type',
        'target_id',
        'result',
        'request_id',
        'summary',
        'created_by',
      ])
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow(),
  ])
  assert.deepEqual(factsAfter, factsBefore)

  await sql`ALTER TABLE public.app_permissions ADD COLUMN menu_group varchar(128)`.execute(
    db,
  )
  const partialCleanup = runCleanup()
  assert.notEqual(partialCleanup.status, 0)
  assert.match(partialCleanup.stderr, /legacy menu baseline is partial/)
  assert.deepEqual(await menuSchemaState(db), {
    settings: null,
    items: null,
    permissionColumns: ['menu_group'],
  })
  const factsAfterPartialFailure = await Promise.all([
    db
      .selectFrom('app_users')
      .select(['id', 'username'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('app_roles')
      .select(['id', 'code'])
      .where('id', '=', roleId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('app_role_permissions')
      .selectAll()
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('app_audit_events')
      .select([
        'id',
        'event_type',
        'actor_user_id',
        'target_type',
        'target_id',
        'result',
        'request_id',
        'summary',
        'created_by',
      ])
      .where('id', '=', auditId)
      .executeTakeFirstOrThrow(),
  ])
  assert.deepEqual(factsAfterPartialFailure, factsBefore)
})
