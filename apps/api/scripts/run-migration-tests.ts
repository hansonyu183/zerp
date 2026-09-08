import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sql } from 'kysely'
import { createDatabase } from '../src/db/database.ts'
import { TargetBootstrapService } from '../src/app/bootstrap.ts'

// Immutable source schemas are test evidence, never runtime compatibility paths.
const cases = [
  ['aux-people', '67b8330cbc52c073ac176166d07d8aa2e786a3b4'],
  ['aux-assets', '14a9e1635f0fbf9d1e15c04dceaf1b8a7b9a9a9e'],
  ['bob', '18de949177f7048be7338b57b621e6ab02267514'],
  ['bob-product', '3053b07f21dfce41c7ccdec5d5052c31beb5be72'],
] as const
const url = new URL(process.env.TARGET_TEST_DATABASE_URL ?? '')
if (!url.pathname.endsWith('_test'))
  throw new Error('migration tests require a disposable *_test database')
const admin = createDatabase(url.href)
try {
  for (const [name, baseline] of cases) {
    const schema = `migration_${randomBytes(12).toString('hex')}`
    await sql.raw(`CREATE SCHEMA ${schema}`).execute(admin)
    const scopedUrl = new URL(url)
    scopedUrl.searchParams.set('options', `-c search_path=${schema}`)
    const db = createDatabase(scopedUrl.href)
    try {
      const source = async (extension: 'sql' | 'json') =>
        gunzipSync(
          await readFile(
            new URL(
              `../tests/migrations/baselines/${baseline}.${extension}.gz`,
              import.meta.url,
            ),
          ),
        ).toString('utf8')
      await sql.raw(await source('sql')).execute(db)
      if (name.startsWith('bob'))
        await new TargetBootstrapService(db).migratePermissionCatalog(
          JSON.parse(await source('json')),
        )
      console.log(`Migration ${name}: pinned baseline ${baseline}`)
      const child = spawn(
        process.execPath,
        ['--test', `tests/migrations/${name}-migration.int.test.ts`],
        {
          cwd: fileURLToPath(new URL('../', import.meta.url)),
          stdio: 'inherit',
          env: {
            ...process.env,
            TARGET_TEST_DATABASE_URL: scopedUrl.href,
            TARGET_DATABASE_SCOPE: 'isolated',
          },
        },
      )
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
      })
      if (code !== 0) throw new Error(`Migration ${name} verification failed`)
    } finally {
      await db.destroy()
      await sql.raw(`DROP SCHEMA ${schema} CASCADE`).execute(admin)
    }
  }
} finally {
  await admin.destroy()
}
