import assert from 'node:assert/strict'
import test from 'node:test'

import { closeRuntime } from '../../src/platform/shutdown.ts'

test('runtime stops accepting connections before destroying the database', async () => {
  const events: string[] = []
  await closeRuntime(
    {
      close(callback) {
        events.push('server.close')
        callback()
        return this
      },
    },
    { destroy: async () => void events.push('database.destroy') },
    100,
  )

  assert.deepEqual(events, ['server.close', 'database.destroy'])
})

test('runtime force-closes lingering connections after the shutdown deadline', async () => {
  const events: string[] = []
  let closed: ((error?: Error) => void) | undefined
  await closeRuntime(
    {
      close(callback) {
        events.push('server.close')
        closed = callback
        return this
      },
      closeAllConnections() {
        events.push('server.closeAllConnections')
        closed?.()
      },
    },
    { destroy: async () => void events.push('database.destroy') },
    1,
  )

  assert.deepEqual(events, [
    'server.close',
    'server.closeAllConnections',
    'database.destroy',
  ])
})
