import { sql } from 'kysely'

import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'

type CleanupReport = {
  removedBusinessMenuItems: number
  removedMenuSettings: number
}

const legacyMenuColumns = [
  'app_business_menu_items.created_at',
  'app_business_menu_items.created_by',
  'app_business_menu_items.display_name',
  'app_business_menu_items.enabled',
  'app_business_menu_items.icon',
  'app_business_menu_items.id',
  'app_business_menu_items.item_level',
  'app_business_menu_items.item_type',
  'app_business_menu_items.parent_id',
  'app_business_menu_items.permission_code',
  'app_business_menu_items.route_key',
  'app_business_menu_items.sort_order',
  'app_business_menu_items.updated_at',
  'app_business_menu_items.updated_by',
  'app_menu_settings.id',
  'app_menu_settings.menu_mode',
  'app_menu_settings.revision',
  'app_menu_settings.updated_at',
  'app_menu_settings.updated_by',
]

function same(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function cleanupLegacyMenu(databaseUrl: string): Promise<CleanupReport> {
  const database = createDatabase(databaseUrl)
  try {
    return await database.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('zerp:legacy-menu-cleanup', 0))`.execute(
        transaction,
      )
      const [tables, templateColumns, columns, stalePermissions] =
        await Promise.all([
          sql<{ settings: string | null; items: string | null }>`
          SELECT to_regclass('public.app_menu_settings')::text AS settings,
            to_regclass('public.app_business_menu_items')::text AS items
        `.execute(transaction),
          sql<{ table_name: string; column_name: string }>`
          SELECT table_name, column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name IN ('app_menu_settings', 'app_business_menu_items')
          ORDER BY table_name, column_name
        `.execute(transaction),
          sql<{ column_name: string }>`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'app_permissions'
            AND column_name IN ('menu_group', 'menu_order')
          ORDER BY column_name
        `.execute(transaction),
          transaction
            .selectFrom('app_permissions')
            .select('path')
            .where('domain', '=', 'app')
            .where('entity', '=', 'menu')
            .execute(),
        ])
      const hasSettings = tables.rows[0]?.settings !== null
      const hasItems = tables.rows[0]?.items !== null
      const menuColumns = columns.rows.map((row) => row.column_name).sort()
      const menuTemplateColumns = templateColumns.rows
        .map((row) => `${row.table_name}.${row.column_name}`)
        .sort()
      const clean = !hasSettings && !hasItems && menuColumns.length === 0
      if (
        !clean &&
        (!hasSettings ||
          !hasItems ||
          menuColumns.length !== 2 ||
          !same(menuTemplateColumns, legacyMenuColumns))
      )
        throw new Error(
          'legacy menu baseline is partial; inspect schema before cleanup',
        )
      if (stalePermissions.length > 0)
        throw new Error(
          `legacy menu permissions remain; run sync:catalog first: ${stalePermissions.map((permission) => permission.path).join(', ')}`,
        )
      if (clean) return { removedBusinessMenuItems: 0, removedMenuSettings: 0 }

      const [businessMenuItems, menuSettings, factsBefore] = await Promise.all([
        sql<{ count: string }>`
          SELECT count(*)::text AS count FROM public.app_business_menu_items
        `.execute(transaction),
        sql<{ count: string }>`
          SELECT count(*)::text AS count FROM public.app_menu_settings
        `.execute(transaction),
        Promise.all([
          transaction
            .selectFrom('app_permissions')
            .select((builder) => builder.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow(),
          transaction
            .selectFrom('app_role_permissions')
            .select((builder) => builder.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow(),
          transaction
            .selectFrom('app_audit_events')
            .select((builder) => builder.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow(),
        ]),
      ])
      await sql`DROP TABLE public.app_business_menu_items`.execute(transaction)
      await sql`DROP TABLE public.app_menu_settings`.execute(transaction)
      await sql`ALTER TABLE public.app_permissions DROP COLUMN menu_group, DROP COLUMN menu_order`.execute(
        transaction,
      )
      const factsAfter = await Promise.all([
        transaction
          .selectFrom('app_permissions')
          .select((builder) => builder.fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
        transaction
          .selectFrom('app_role_permissions')
          .select((builder) => builder.fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
        transaction
          .selectFrom('app_audit_events')
          .select((builder) => builder.fn.countAll<string>().as('count'))
          .executeTakeFirstOrThrow(),
      ])
      if (
        factsBefore.some((row, index) => row.count !== factsAfter[index]?.count)
      )
        throw new Error(
          'legacy menu cleanup changed permission, role-grant, or audit facts',
        )
      return {
        removedBusinessMenuItems: Number(businessMenuItems.rows[0]?.count),
        removedMenuSettings: Number(menuSettings.rows[0]?.count),
      }
    })
  } finally {
    await database.destroy()
  }
}

async function main(): Promise<void> {
  if (process.env.ZERP_LEGACY_MENU_CLEANUP !== 'confirm')
    throw new Error('ZERP_LEGACY_MENU_CLEANUP=confirm is required')
  const databaseUrl = required('TARGET_DATABASE_URL')
  assertTargetDatabaseBoundary(databaseUrl, required('TARGET_DATABASE_SCOPE'))
  const report = await cleanupLegacyMenu(databaseUrl)
  process.stdout.write(
    `legacy menu cleanup completed: menuItems=${report.removedBusinessMenuItems}; menuSettings=${report.removedMenuSettings}\n`,
  )
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`legacy menu cleanup failed: ${message}\n`)
  process.exitCode = 1
}
