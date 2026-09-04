import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const envelope = z.object({ code: z.number().int(), errorKey: z.string(), message: z.string(), data: z.unknown().nullable(), requestId: z.string() })
const codeParameter = z.object({ code: z.string().regex(/^rpt-[0-9]{6}$/) })
const parameters = z.record(z.string(), z.unknown())
const referenceQuery = z.object({
  parameterKey: z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/),
  keyword: z.string().max(200).optional(),
  selectedId: z.string().max(64).optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(50).default(20),
}).strict()
function route<const Path extends string>(path: Path, request: z.ZodType, params?: z.ZodType) {
  return createRoute({ method: 'post', path, request: { ...(params ? { params } : {}), body: { content: { 'application/json': { schema: request } } } } as never, responses: { 200: { description: path, content: { 'application/json': { schema: envelope } } } } })
}
export const rptRouteSet = {
  directory: route('/rpt/directory/query', z.object({}).strict()),
  query: route('/rpt/{code}/query', z.object({ parameters, page: z.number().int().positive(), pageSize: z.number().int().positive().max(100) }).strict(), codeParameter),
  export: route('/rpt/{code}/export', z.object({ parameters }).strict(), codeParameter),
  referenceQuery: route('/rpt/{code}/reference-query', referenceQuery, codeParameter),
} as const
export const rptRouteMetadata = [
  { method: 'post', path: '/rpt/directory/query', permission: '/rpt/directory/query', title: '报表目录' },
  { method: 'post', path: '/rpt/{code}/query', title: '报表查询' },
  { method: 'post', path: '/rpt/{code}/export', title: '报表导出' },
  { method: 'post', path: '/rpt/{code}/reference-query', title: '报表参数引用' },
]
export type RptRouteAction = keyof typeof rptRouteSet
export type RptRouteHandler = (action: RptRouteAction, context: any) => Promise<Response>
export function registerRptRoutes<AppSchema extends Schema, BasePath extends string>(app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>, handler: RptRouteHandler) {
  const directory = app.openapi(rptRouteSet.directory, (c) => handler('directory', c) as never)
  const query = directory.openapi(rptRouteSet.query, (c) => handler('query', c) as never)
  const exported = query.openapi(rptRouteSet.export, (c) => handler('export', c) as never)
  return exported.openapi(rptRouteSet.referenceQuery, (c) => handler('referenceQuery', c) as never)
}
