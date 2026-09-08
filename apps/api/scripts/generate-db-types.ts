import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl)
  throw new Error(
    'TARGET_DATABASE_URL is required to generate target database types',
  )

assertTargetDatabaseBoundary(databaseUrl, process.env.TARGET_DATABASE_SCOPE)

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

// Codegen's default formatting differs from the repository. Reproducibility
// checks must compare the final, committed form of the generated artifact.
const formatted = spawnSync(
  'pnpm',
  [
    'exec',
    'prettier',
    '--write',
    resolve(import.meta.dirname, '../src/db/generated.ts'),
  ],
  { cwd: resolve(import.meta.dirname, '../../..'), stdio: 'inherit' },
)
if (formatted.error) throw formatted.error
if (formatted.status !== 0) process.exit(formatted.status ?? 1)
