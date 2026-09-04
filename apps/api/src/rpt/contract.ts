import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const envelope = z.object({ code: z.number().int(), errorKey: z.string(), message: z.string(), data: z.unknown().nullable(), requestId: z.string() })
const codeParameter = z.object({ code: z.string().regex(/^rpt-[0-9]{6}$/) })
const parameters = z.record(z.string(), z.unknown())
function route<const Path extends string>(path: Path, request: z.ZodType, params?: z.ZodType) {
  return createRoute({ method: 'post', path, request: { ...(params ? { params } : {}), body: { content: { 'application/json': { schema: request } } } } as never, responses: { 200: { description: path, content: { 'application/json': { schema: envelope } } } } })
}
export const rptRouteSet = {
  directory: route('/rpt/directory/query', z.object({}).strict()),
  query: route('/rpt/{code}/query', z.object({ parameters, page: z.number().int().positive(), pageSize: z.number().int().positive().max(100) }).strict(), codeParameter),
  export: route('/rpt/{code}/export', z.object({ parameters }).strict(), codeParameter),
} as const
export const rptRouteMetadata = [
  { method: 'post', path: '/rpt/directory/query', permission: '/rpt/directory/query', title: '报表目录' },
  { method: 'post', path: '/rpt/{code}/query', title: '报表查询' },
  { method: 'post', path: '/rpt/{code}/export', title: '报表导出' },
]
export type RptRouteAction = keyof typeof rptRouteSet
export type RptRouteHandler = (action: RptRouteAction, context: any) => Promise<Response>
export function registerRptRoutes<AppSchema extends Schema, BasePath extends string>(app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>, handler: RptRouteHandler) {
  const directory = app.openapi(rptRouteSet.directory, (c) => handler('directory', c) as never)
  const query = directory.openapi(rptRouteSet.query, (c) => handler('query', c) as never)
  return query.openapi(rptRouteSet.export, (c) => handler('export', c) as never)
}
