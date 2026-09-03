import { serve } from '@hono/node-server'

import { createApp } from './app.ts'
import { SessionService } from './app/session.ts'
import { createDatabase } from './db/database.ts'
import { loadConfig } from './platform/config.ts'
import { jsonLogger } from './platform/logging.ts'
import { closeRuntime } from './platform/shutdown.ts'
import { WarehouseService } from './dcl/warehouse.ts'

const config = loadConfig()
const database = createDatabase(config.databaseUrl.toString())
const app = createApp({
  database: {
    ping: async () =>
      database
        .selectFrom('app_users')
        .select('id')
        .limit(1)
        .execute()
        .then(() => undefined),
  },
  session: new SessionService(database, config),
  warehouse: new WarehouseService(database),
  config,
  corsAllowedOrigins: config.corsAllowedOrigins,
  bodyLimitBytes: config.bodyLimitBytes,
  logger: jsonLogger,
})
const [host, port] = config.httpAddress.split(':')
const server = serve({
  fetch: app.fetch,
  hostname: host || '0.0.0.0',
  port: Number(port || '8080'),
})

let shutdownStarted = false
const shutdown = async (signal: NodeJS.Signals) => {
  if (shutdownStarted) return
  shutdownStarted = true
  jsonLogger.info({ event: 'shutdown_started', signal })
  try {
    await closeRuntime(server, database, config.shutdownTimeoutMs)
    jsonLogger.info({ event: 'shutdown_completed', signal })
  } catch (error) {
    process.exitCode = 1
    jsonLogger.error({
      event: 'shutdown_failed',
      signal,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
