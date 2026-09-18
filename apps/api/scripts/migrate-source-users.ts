import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ManagementService } from '../src/app/management.ts'
import {
  sourceUserPlanSchema,
  SourceUserMigrationError,
} from '../src/app/source-users.ts'
import { prepareSourceUsers } from '../src/app/source-users-upgrade.ts'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      actor: { type: 'string' },
      source: { type: 'string' },
      plan: { type: 'string' },
      'credentials-dir': { type: 'string' },
    },
  })
  const action = positionals[0]
  if (
    positionals.length !== 1 ||
    !['prepare', 'inspect', 'apply'].includes(action)
  )
    throw new SourceUserMigrationError('usage_prepare_inspect_apply')
  const url = process.env.TARGET_DATABASE_URL
  const scope = process.env.TARGET_DATABASE_SCOPE
  if (!url || !scope)
    throw new SourceUserMigrationError('explicit_database_required')
  assertTargetDatabaseBoundary(url, scope)
  const db = createDatabase(url)
  try {
    if (action === 'prepare') {
      process.stdout.write(
        JSON.stringify({ schema: await prepareSourceUsers(db) }) + '\n',
      )
      return
    }
    if (!values.actor) throw new SourceUserMigrationError('actor_required')
    const service = new ManagementService(db, {
      passwordMinLength: Number(process.env.APP_PASSWORD_MIN_LENGTH ?? '12'),
    })
    if (action === 'inspect') {
      if (!values.source) throw new SourceUserMigrationError('source_required')
      process.stdout.write(
        JSON.stringify(
          await service.inspectSourceUsers(values.source, values.actor),
        ) + '\n',
      )
      return
    }
    if (!values.plan || !values['credentials-dir'])
      throw new SourceUserMigrationError(
        'plan_and_credentials_directory_required',
      )
    const plan = sourceUserPlanSchema.parse(
      JSON.parse(await readFile(values.plan, 'utf8')),
    )
    const inventory = await service.inspectSourceUsers(
      plan.source,
      values.actor,
    )
    if (inventory.databaseName !== plan.databaseName)
      throw new SourceUserMigrationError('target_database_mismatch')
    const passwords = new Map<string, string>()
    const directory = resolve(values['credentials-dir'])
    await mkdir(directory, { recursive: true, mode: 0o700 })
    for (const user of plan.users) {
      if (
        inventory.users.some((item) => item.sourceKey === user.sourceKey) ||
        user.deleted
      )
        continue
      const path = resolve(
        directory,
        encodeURIComponent(user.code.trim().toLowerCase()),
      )
      let handle
      try {
        handle = await open(path, 'wx', 0o600)
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'EEXIST'
        )
          throw error
      }
      if (handle) {
        try {
          await handle.writeFile(
            `Initial!Aa1-${randomBytes(24).toString('base64url')}\n`,
          )
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
      passwords.set(user.sourceKey, (await readFile(path, 'utf8')).trimEnd())
    }
    process.stdout.write(
      JSON.stringify(
        await service.migrateSourceUsers(
          plan,
          values.actor,
          passwords,
          `source-users-${randomBytes(12).toString('hex')}`,
        ),
      ) + '\n',
    )
  } finally {
    await db.destroy()
  }
}

try {
  await main()
} catch (error) {
  // Never expose driver errors, filesystem paths, credentials, or raw plan bodies.
  const reason =
    error instanceof SourceUserMigrationError
      ? error.reason
      : 'source_user_migration_failed'
  process.stderr.write(
    JSON.stringify({
      reason,
      ...(error instanceof SourceUserMigrationError && error.sourceKey
        ? { sourceKey: error.sourceKey }
        : {}),
    }) + '\n',
  )
  process.exitCode = 1
}
