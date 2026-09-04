import { serve } from '@hono/node-server'
import pg from 'pg'

import { createApp } from './app.ts'
import { SessionService } from './app/session.ts'
import { ManagementService } from './app/management.ts'
import { AuxService } from './aux/service.ts'
import { BobService } from './bob/service.ts'
import { createDatabase } from './db/database.ts'
import { loadConfig } from './platform/config.ts'
import { AttachmentStore } from './platform/attachment-store.ts'
import { jsonLogger } from './platform/logging.ts'
import { closeRuntime } from './platform/shutdown.ts'
import { WarehouseService } from './dcl/warehouse.ts'
import { ArchiveService } from './dcl/archives.ts'
import { AccMappingCatalogService } from './acc/mapping-catalog.ts'
import { VouService } from './vou/service.ts'
import { AccService } from './acc/service.ts'
import { WflService, type WflVouPort } from './wfl/service.ts'
import { PgRptDefinitionValidator, RptService } from './rpt/service.ts'
import { WorkbenchService } from './app/workbench.ts'
import { createNodeWflStarlark } from '@zerp/wfl-starlark/node'

const config = loadConfig()
const database = createDatabase(config.databaseUrl.toString())
const attachmentStore = new AttachmentStore(config.attachmentStorageRoot)
const rptValidationPool = new pg.Pool({
  connectionString: config.databaseUrl.toString(),
})
const rptValidator = new PgRptDefinitionValidator(rptValidationPool, database)
const rpt = new RptService(database, rptValidator)
try {
  await rpt.assertAllEnabled()
} catch (error) {
  await Promise.all([rptValidationPool.end(), database.destroy()])
  throw error
}
const wflRuntime = await createNodeWflStarlark()
const acc = new AccService(database)
let vou!: VouService
const vouPort: WflVouPort = {
  createChild: (...args) => vou.createChild(...args),
  approveChild: (...args) => vou.approveChild(...args),
  rejectChild: (...args) => vou.rejectChild(...args),
  retryChild: (...args) => vou.retryChild(...args),
  cancelChild: (...args) => vou.cancelChild(...args),
}
const wfl = new WflService(database, wflRuntime, vouPort)
vou = new VouService(database, { acc, wfl }, { attachmentStore })
const app = createApp({
  database: {
    ping: async () => {
      await database.selectFrom('app_users').select('id').limit(1).execute()
      await rpt.assertAllEnabled()
    },
  },
  session: new SessionService(database, config),
  management: new ManagementService(database, config),
  aux: new AuxService(database),
  bob: new BobService(database),
  warehouse: new WarehouseService(database),
  archives: new ArchiveService(database, rptValidator, { attachmentStore }),
  accMappingCatalog: new AccMappingCatalogService(database),
  vou,
  acc,
  wfl,
  rpt,
  workbench: new WorkbenchService(database),
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
    try {
      await closeRuntime(server, database, config.shutdownTimeoutMs)
    } finally {
      await rptValidationPool.end()
    }
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
