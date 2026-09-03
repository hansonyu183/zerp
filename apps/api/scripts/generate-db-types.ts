import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl)
  throw new Error(
    'TARGET_DATABASE_URL is required to generate target database types',
  )

const parsed = new URL(databaseUrl)
if (!parsed.pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'TARGET_DATABASE_URL must name a disposable *_test PostgreSQL database',
  )
}

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'kysely-codegen',
    '--dialect',
    'postgres',
    '--url',
    databaseUrl,
    '--date-parser',
    'timestamp',
    '--out-file',
    resolve(import.meta.dirname, '../src/db/generated.ts'),
  ],
  { cwd: resolve(import.meta.dirname, '..'), stdio: 'inherit' },
)

if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
