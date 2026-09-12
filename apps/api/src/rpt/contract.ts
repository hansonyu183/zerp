import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi'
import type { Schema } from 'hono'
import { optionPageInput } from '../app/options-contract.ts'

import type { TargetRouteEnvironment } from '../app/contract.ts'

const codeParameter = z.object({ code: z.string().regex(/^rpt-[0-9]{6}$/) })
const parameters = z.record(z.string(), z.unknown())
const referenceQuery = z
  .object({
    parameterKey: z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/),
    keyword: z.string().max(200).optional(),
    selectedId: z.string().max(64).optional(),
    page: optionPageInput.shape.page.default(1),
    pageSize: z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number)
      .pipe(z.number().int().max(50))
      .default(20),
  })
  .strict()
const reportParameter = z
  .object({
    key: z.string(),
    name: z.string(),
    type: z.enum([
      'TEXT',
      'INTEGER',
      'DECIMAL',
      'BOOLEAN',
      'DATE',
      'DATE_RANGE',
      'ENUM',
      'REFERENCE',
    ]),
    required: z.boolean(),
    defaultValue: z.unknown().optional(),
    enumValues: z.array(z.string()).readonly().optional(),
    enumCaptions: z.record(z.string(), z.string().trim().min(1)).optional(),
    referenceType: z
      .enum([
        'ACCOUNTING_BOOK',
        'ACCOUNT_SUBJECT',
        'CUSTOMER_SUBUNIT',
        'SUPPLIER',
        'OTHER_UNIT',
        'EMPLOYEE',
        'SALES_PARTNER',
        'DEPARTMENT',
        'PRODUCT',
        'WAREHOUSE',
        'FUND_ACCOUNT',
        'ASSET',
        'BILL',
        'COUNTERPARTY',
      ])
      .optional(),
  })
  .strict()
const reportColumn = z
  .object({
    alias: z.string(),
    name: z.string(),
    order: z.number().int().positive(),
    type: z.enum([
      'TEXT',
      'INTEGER',
      'DECIMAL',
      'BOOLEAN',
      'DATE',
      'DATETIME',
      'ID',
    ]),
    width: z.number().int(),
    visible: z.boolean(),
    format: z.string().optional(),
    drilldownEntity: z.literal('VOU').optional(),
  })
  .strict()
const directoryItem = z
  .object({
    subjectId: z.string().length(26),
    revision: z.string().regex(/^[1-9][0-9]*$/),
    code: z.string().regex(/^rpt-[0-9]{6}$/),
    name: z.string(),
    parameters: z.array(reportParameter),
    columns: z.array(reportColumn),
  })
  .strict()
export const definitionInput = z
  .object({
    subjectId: z.string().length(26),
    expectedRevision: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .nullable(),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(1000),
    enabled: z.boolean(),
    sql: z.string().min(1),
    parameters: z.array(reportParameter),
    columns: z.array(reportColumn),
  })
  .strict()
const definitionResult = directoryItem.extend({
  description: z.string(),
  enabled: z.boolean(),
  sql: z.string(),
  validity: z.enum(['VALID', 'INVALID']),
})
const row = z.record(z.string(), z.unknown())
const queryResult = z
  .object({
    revision: z.string().regex(/^[1-9][0-9]*$/),
    columns: z.array(reportColumn),
    rows: z.array(row),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    hasMore: z.boolean(),
  })
  .strict()
const exportResult = z
  .object({
    revision: z.string().regex(/^[1-9][0-9]*$/),
    columns: z.array(reportColumn),
    rows: z.array(row),
  })
  .strict()
const referencePage = z
  .object({
    items: z.array(z.record(z.string(), z.string())),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict()
const failureEnvelope = z
  .object({
    code: z
      .number()
      .int()
      .refine((value) => value !== 0),
    errorKey: z.string().min(1),
    message: z.string(),
    data: z.null(),
    requestId: z.string(),
  })
  .strict()
function envelope<Data extends z.ZodType>(data: Data) {
  return z.union([
    z
      .object({
        code: z.literal(0),
        errorKey: z.literal(''),
        message: z.literal('ok'),
        data,
        requestId: z.string(),
      })
      .strict(),
    failureEnvelope,
  ])
}
function route<
  const Path extends string,
  Request extends z.ZodType,
  Response extends z.ZodType,
>(path: Path, request: Request, response: Response, params?: z.ZodObject) {
  return createRoute({
    method: 'post',
    path,
    request: {
      ...(params ? { params } : {}),
      body: { content: { 'application/json': { schema: request } } },
    },
    responses: {
      200: {
        description: path,
        content: { 'application/json': { schema: response } },
      },
    },
  })
}
function auxiliary<
  const Path extends string,
  Request extends z.ZodObject,
  Response extends z.ZodType,
>(path: Path, query: Request, response: Response, params?: z.ZodObject) {
  return createRoute({
    method: 'get',
    path,
    request: { query, ...(params ? { params } : {}) },
    responses: {
      200: {
        description: path,
        content: { 'application/json': { schema: response } },
      },
    },
  })
}
export const rptRouteSet = {
  get: route(
    '/rpt/definition/get',
    z.object({ subjectId: z.string().length(26) }).strict(),
    envelope(definitionResult),
  ),
  save: route(
    '/rpt/definition/save',
    definitionInput,
    envelope(definitionResult),
  ),
  directory: auxiliary(
    '/rpt/directory/options',
    z.object({}).strict(),
    envelope(z.array(directoryItem)),
  ),
  query: route(
    '/rpt/{code}/query',
    z
      .object({
        parameters,
        page: z.number().int().positive(),
        pageSize: z.number().int().positive().max(100),
      })
      .strict(),
    envelope(queryResult),
    codeParameter,
  ),
  export: route(
    '/rpt/{code}/export',
    z.object({ parameters }).strict(),
    envelope(exportResult),
    codeParameter,
  ),
  referenceQuery: auxiliary(
    '/rpt/{code}/reference-query',
    referenceQuery,
    envelope(referencePage),
    codeParameter,
  ),
} as const
export const rptRouteMetadata = [
  {
    method: 'post',
    path: '/rpt/definition/get',
    permission: '/rpt/definition/get',
    title: '报表定义读取',
  },
  {
    method: 'post',
    path: '/rpt/definition/save',
    permission: '/rpt/definition/save',
    title: '报表定义保存',
  },
  {
    method: 'get',
    path: '/rpt/directory/options',
    title: '报表目录',
  },
  { method: 'post', path: '/rpt/{code}/query', title: '报表查询' },
  { method: 'post', path: '/rpt/{code}/export', title: '报表导出' },
  {
    method: 'get',
    path: '/rpt/{code}/reference-query',
    title: '报表参数引用',
  },
]
export type RptRouteAction = keyof typeof rptRouteSet
export type RptRouteHandler = (
  action: RptRouteAction,
  context: any,
) => Promise<Response>
export function registerRptRoutes<
  AppSchema extends Schema,
  BasePath extends string,
>(
  app: OpenAPIHono<TargetRouteEnvironment, AppSchema, BasePath>,
  handler: RptRouteHandler,
) {
  const saved = app.openapi(
    rptRouteSet.save,
    (c) => handler('save', c) as never,
  )
  const configured = saved.openapi(
    rptRouteSet.get,
    (c) => handler('get', c) as never,
  )
  const directory = configured.openapi(
    rptRouteSet.directory,
    (c) => handler('directory', c) as never,
  )
  const query = directory.openapi(
    rptRouteSet.query,
    (c) => handler('query', c) as never,
  )
  const exported = query.openapi(
    rptRouteSet.export,
    (c) => handler('export', c) as never,
  )
  return exported.openapi(
    rptRouteSet.referenceQuery,
    (c) => handler('referenceQuery', c) as never,
  )
}
