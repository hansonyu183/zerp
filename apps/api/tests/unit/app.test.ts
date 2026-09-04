import assert from 'node:assert/strict'
import test from 'node:test'

import { createApp } from '../../src/app.ts'

type LogEntry = Record<string, unknown>

function recordingLogger() {
  const info: LogEntry[] = []
  const error: LogEntry[] = []
  return {
    info,
    error,
    logger: {
      info(entry: LogEntry) {
        info.push(entry)
      },
      error(entry: LogEntry) {
        error.push(entry)
      },
    },
  }
}

test('health endpoint returns a request identifier', async () => {
  const logs = recordingLogger()
  const response = await createApp({ logger: logs.logger }).request('/healthz')

  assert.equal(response.status, 200)
  assert.match(response.headers.get('x-request-id') ?? '', /^[A-Z0-9]{26}$/)
  assert.deepEqual(await response.json(), { status: 'ok' })
  assert.equal(logs.info.length, 1)
  assert.equal(logs.info[0]?.method, 'GET')
  assert.equal(logs.info[0]?.path, '/healthz')
  assert.equal(logs.info[0]?.status, 200)
  assert.equal(typeof logs.info[0]?.requestId, 'string')
})

test('preserves a valid caller request identifier and rejects unconfigured CORS origins', async () => {
  const app = createApp({ corsAllowedOrigins: ['https://target.example.test'] })
  const allowed = await app.request('/healthz', {
    headers: {
      Origin: 'https://target.example.test',
      'X-Request-ID': 'target-request-1',
    },
  })
  const denied = await app.request('/healthz', {
    headers: { Origin: 'https://untrusted.example.test' },
  })

  assert.equal(allowed.headers.get('x-request-id'), 'target-request-1')
  assert.equal(
    allowed.headers.get('access-control-allow-origin'),
    'https://target.example.test',
  )
  assert.equal(denied.status, 403)
})

test('returns the standard envelope for recovery, model mismatch, and oversized bodies', async () => {
  const logs = recordingLogger()
  const app = createApp({
    bodyLimitBytes: 1,
    logger: logs.logger,
    registerRoutes: (router) => {
      router.get('/panic', () => {
        throw new Error('test panic')
      })
      router.post('/echo', (context) => context.json({ ok: true }))
    },
  })

  const recovered = await app.request('/panic')
  const mismatch = await app.request('/app/user/session', { method: 'POST' })
  const oversized = await app.request('/echo', {
    method: 'POST',
    headers: { 'Content-Length': '2' },
    body: '{}',
  })

  assert.equal(recovered.status, 200)
  assert.equal(mismatch.status, 200)
  const recoveredPayload = await recovered.json()
  const mismatchPayload = await mismatch.json()
  assert.equal(typeof recoveredPayload.requestId, 'string')
  assert.equal(typeof mismatchPayload.requestId, 'string')
  assert.equal(recoveredPayload.errorKey, 'internal_error')
  assert.equal(mismatchPayload.errorKey, 'model_version_mismatch')
  assert.equal(oversized.status, 200)
  assert.equal((await oversized.json()).errorKey, 'validation_failed')
  assert.equal(logs.error.length, 1)
  assert.equal(logs.error[0]?.event, 'request_recovered')
  assert.equal(logs.error[0]?.path, '/panic')
})

test('readiness pings the configured database', async () => {
  const ready = createApp({ database: { ping: async () => undefined } })
  const unavailable = createApp({
    database: { ping: async () => Promise.reject(new Error('unavailable')) },
  })

  assert.equal((await ready.request('/readyz')).status, 200)
  assert.equal((await unavailable.request('/readyz')).status, 503)
})
