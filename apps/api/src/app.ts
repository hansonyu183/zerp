import { OpenAPIHono } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { modelBuildId } from '@zerp/model'

import { currentRequestId, requestId } from './platform/request-id.ts'
import type { TargetConfig } from './platform/config.ts'
import { registerAppRoutes } from './app/routes.ts'
import type { SessionService } from './app/session.ts'
import type { ManagementService } from './app/management.ts'
import type { AuxService } from './aux/service.ts'
import type { BobService } from './bob/service.ts'
import { noopLogger, type AppLogger } from './platform/logging.ts'
import type { WarehouseService } from './dcl/warehouse.ts'
import type { ArchiveService } from './dcl/archives.ts'
import type { AccMappingCatalogService } from './acc/mapping-catalog.ts'
import type { VouService } from './vou/service.ts'
import type { AccService } from './acc/service.ts'
import type { WflService } from './wfl/service.ts'
import type { RptService } from './rpt/service.ts'
import type { WorkbenchService } from './app/workbench.ts'

export interface DatabaseReadiness {
  ping(): Promise<void>
}

export interface CreateAppOptions {
  bodyLimitBytes?: number
  corsAllowedOrigins?: string[]
  database?: DatabaseReadiness
  session?: SessionService
  management?: ManagementService
  aux?: AuxService
  bob?: BobService
  config?: TargetConfig
  logger?: AppLogger
  warehouse?: WarehouseService
  archives?: ArchiveService
  accMappingCatalog?: AccMappingCatalogService
  vou?: VouService
  acc?: AccService
  wfl?: WflService
  rpt?: RptService
  workbench?: WorkbenchService
  registerRoutes?: (
    router: OpenAPIHono<{ Variables: { requestId: string } }>,
  ) => void
}

type Variables = { requestId: string }

function envelope(
  requestId: string,
  code: number,
  errorKey: string,
  message: string,
) {
  return { code, errorKey, message, data: null, requestId }
}

export function createApp(options: CreateAppOptions = {}) {
  const logger = options.logger ?? noopLogger
  const app = new OpenAPIHono<{ Variables: Variables }>({
    defaultHook: (result, context) => {
      if (result.success) return undefined
      return context.json(
        envelope(
          currentRequestId(context),
          2001,
          'validation_failed',
          'invalid request',
        ),
      )
    },
  })
  app.use('*', requestId)
  app.use('*', async (context, next) => {
    const startedAt = performance.now()
    try {
      await next()
    } finally {
      logger.info({
        event: 'request_completed',
        requestId: currentRequestId(context),
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      })
    }
  })
  app.use('*', async (context, next) => {
    const origin = context.req.header('Origin')
    if (!origin) return next()
    if (!options.corsAllowedOrigins?.includes(origin))
      return context.body(null, 403)

    context.header('Access-Control-Allow-Origin', origin)
    context.header('Access-Control-Allow-Credentials', 'true')
    context.header(
      'Access-Control-Allow-Headers',
      'Content-Type, X-CSRF-Token, X-Request-ID, X-ZERP-Model-Build',
    )
    context.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
    context.header('Access-Control-Expose-Headers', 'X-Request-ID')
    context.header('Vary', 'Origin')
    if (context.req.method === 'OPTIONS') return context.body(null, 204)
    await next()
  })
  app.use(
    '*',
    bodyLimit({
      maxSize: options.bodyLimitBytes ?? 1_048_576,
      onError: (context) =>
        context.json(
          envelope(
            currentRequestId(context),
            2001,
            'validation_failed',
            'request body is too large',
          ),
        ),
    }),
  )
  app.use('/app/*', async (context, next) => {
    if (context.req.header('X-ZERP-Model-Build') !== modelBuildId) {
      return context.json(
        envelope(
          currentRequestId(context),
          3001,
          'model_version_mismatch',
          '客户端模型版本不匹配，请刷新页面。',
        ),
      )
    }
    await next()
  })
  app.get('/healthz', (context) => context.json({ status: 'ok' }))
  app.get('/readyz', async (context) => {
    try {
      await options.database?.ping()
      return context.json({ status: 'ok' })
    } catch {
      return context.json({ status: 'unavailable' }, 503)
    }
  })
  if (options.session && options.config)
    registerAppRoutes(
      app,
      options.session,
      options.config,
      options.warehouse,
      options.archives,
      options.accMappingCatalog,
      options.management,
      options.aux,
      options.bob,
      options.vou,
      options.acc,
      options.wfl,
      options.rpt,
      options.workbench,
    )
  options.registerRoutes?.(app)
  app.onError((error, context) => {
    if (error instanceof HTTPException) {
      const response = error.getResponse()
      response.headers.set('X-Request-ID', currentRequestId(context))
      return response
    }
    logger.error({
      event: 'request_recovered',
      requestId: currentRequestId(context),
      method: context.req.method,
      path: context.req.path,
      error: error instanceof Error ? error.message : String(error),
    })
    return context.json(
      envelope(
        currentRequestId(context),
        5000,
        'internal_error',
        'internal server error',
      ),
    )
  })

  return app
}
