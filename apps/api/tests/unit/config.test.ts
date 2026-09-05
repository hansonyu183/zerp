import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertTargetDatabaseBoundary,
  loadConfig,
} from '../../src/platform/config.ts'

test('target configuration refuses a non-disposable database unless production scope is explicit', () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL: 'postgres://zerp:password@127.0.0.1:5432/zerp',
      }),
    /_test/,
  )
})

test('target configuration permits the production database only in explicit production scope', () => {
  const config = loadConfig({
    DATABASE_URL: 'postgres://zerp:password@127.0.0.1:5432/zerp',
    TARGET_DATABASE_SCOPE: 'production',
  })

  assert.equal(config.databaseUrl.pathname, '/zerp')
  assert.equal(config.databaseScope, 'production')
})

test('target configuration rejects an unknown database scope', () => {
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL:
          'postgres://zerp:password@127.0.0.1:55436/zerp_target_test',
        TARGET_DATABASE_SCOPE: 'preview',
      }),
    /TARGET_DATABASE_SCOPE/,
  )
})

test('catalog jobs share the explicit production database boundary', () => {
  assert.equal(
    assertTargetDatabaseBoundary(
      'postgres://zerp:password@127.0.0.1:5432/zerp',
      'production',
    ),
    'production',
  )
  assert.throws(
    () =>
      assertTargetDatabaseBoundary(
        'postgres://zerp:password@127.0.0.1:5432/zerp',
        undefined,
      ),
    /_test/,
  )
})

test('target configuration parses the isolated runtime settings', () => {
  const config = loadConfig({
    DATABASE_URL: 'postgres://zerp:password@127.0.0.1:55436/zerp_target_test',
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:5174, http://localhost:5174',
    APP_SESSION_COOKIE_SECURE: 'false',
    ATTACHMENT_STORAGE_ROOT: '/var/lib/zerp/attachments',
  })

  assert.equal(config.databaseUrl.pathname, '/zerp_target_test')
  assert.equal(config.databaseScope, 'isolated')
  assert.deepEqual(config.corsAllowedOrigins, [
    'http://127.0.0.1:5174',
    'http://localhost:5174',
  ])
  assert.equal(config.sessionCookieSecure, false)
  assert.equal(config.passwordMinLength, 12)
  assert.equal(config.attachmentStorageRoot, '/var/lib/zerp/attachments')
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
