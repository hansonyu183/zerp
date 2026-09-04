import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
  z,
} from '@hono/zod-openapi'

interface DatabaseReadiness {
  ping(): Promise<void>
}

type HealthRouteEnvironment = { Variables: { requestId: string } }

const healthy = z.object({ status: z.literal('ok') })
const unavailable = z.object({ status: z.literal('unavailable') })

export const healthRouteSet = {
  health: createRoute({
    method: 'get',
    path: '/healthz',
    responses: {
      200: {
        description: 'Service health',
        content: { 'application/json': { schema: healthy } },
      },
    },
  }),
  readiness: createRoute({
    method: 'get',
    path: '/readyz',
    responses: {
      200: {
        description: 'Service ready',
        content: { 'application/json': { schema: healthy } },
      },
      503: {
        description: 'Service unavailable',
        content: { 'application/json': { schema: unavailable } },
      },
    },
  }),
} as const

export const healthRouteMetadata = Object.values(healthRouteSet).map(
  (route) => ({ method: route.method, path: route.path }),
)

export function registerHealthRoutes(
  app: OpenAPIHono<HealthRouteEnvironment>,
  database?: DatabaseReadiness,
) {
  const health: RouteHandler<
    typeof healthRouteSet.health,
    HealthRouteEnvironment
  > = (context) => context.json({ status: 'ok' as const }, 200)
  const readiness: RouteHandler<
    typeof healthRouteSet.readiness,
    HealthRouteEnvironment
  > = async (context) => {
    try {
      await database?.ping()
      return context.json({ status: 'ok' as const }, 200)
    } catch {
      return context.json({ status: 'unavailable' as const }, 503)
    }
  }

  return app.openapiRoutes([
    { route: healthRouteSet.health, handler: health },
    { route: healthRouteSet.readiness, handler: readiness },
  ] as const)
}
