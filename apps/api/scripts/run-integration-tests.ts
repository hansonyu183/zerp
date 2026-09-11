import { spawnSync } from 'node:child_process'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'

const databaseUrl = process.env.TARGET_TEST_DATABASE_URL
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error(
    'integration CLI requires an explicit disposable TARGET_TEST_DATABASE_URL ending in _test',
  )
assertTargetDatabaseBoundary(databaseUrl, 'isolated')
const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', 'tests/integration/*.test.ts'],
  {
    cwd: new URL('../', import.meta.url),
    stdio: 'inherit',
    env: {
      ...process.env,
      TARGET_DATABASE_URL: databaseUrl,
      TARGET_DATABASE_SCOPE: 'isolated',
    },
  },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
