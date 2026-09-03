import assert from 'node:assert/strict'
import test from 'node:test'

import { loadConfig } from '../../src/platform/config.ts'

test('target configuration refuses every database name outside the disposable _test boundary', () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL: 'postgres://zerp:password@127.0.0.1:5432/zerp',
      }),
    /_test/,
  )
})

test('target configuration parses the isolated runtime settings', () => {
  const config = loadConfig({
    DATABASE_URL: 'postgres://zerp:password@127.0.0.1:55436/zerp_target_test',
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:5174, http://localhost:5174',
    APP_SESSION_COOKIE_SECURE: 'false',
  })

  assert.equal(config.databaseUrl.pathname, '/zerp_target_test')
  assert.deepEqual(config.corsAllowedOrigins, [
    'http://127.0.0.1:5174',
    'http://localhost:5174',
  ])
  assert.equal(config.sessionCookieSecure, false)
  assert.equal(config.passwordMinLength, 12)
})

test('target configuration rejects non-positive sizes and durations', () => {
  const database = 'postgres://zerp:password@127.0.0.1:55436/zerp_target_test'
  assert.throws(
    () => loadConfig({ DATABASE_URL: database, HTTP_BODY_LIMIT_BYTES: '0' }),
    /positive integer/,
  )
  assert.throws(
    () => loadConfig({ DATABASE_URL: database, SHUTDOWN_TIMEOUT: '0s' }),
    /positive duration/,
  )
})
