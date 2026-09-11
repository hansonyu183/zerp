import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

for (const databaseUrl of ['', 'postgres://localhost/zerp']) {
  test(`integration CLI rejects ${databaseUrl ? 'a non-disposable database' : 'a missing database'} before running tests`, () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/run-integration-tests.ts'],
      {
        cwd: new URL('../', import.meta.url),
        encoding: 'utf8',
        env: {
          ...process.env,
          TARGET_TEST_DATABASE_URL: databaseUrl,
          TARGET_DATABASE_SCOPE: 'production',
        },
      },
    )
    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /requires an explicit disposable TARGET_TEST_DATABASE_URL ending in _test/,
    )
    assert.doesNotMatch(result.stdout, /tests\/integration|TAP version/)
  })
}
