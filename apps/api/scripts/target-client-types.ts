import { hc } from 'hono/client'
import type { OpenAPIHono } from '@hono/zod-openapi'

import type { TargetAppType } from '../src/app/contract.ts'
import type { registerIndependentRoutes } from '../src/app/independent-contract.ts'
import {
  dclArchiveRouteSets,
  type registerDclArchiveRoutes,
} from '../src/dcl/archive-contract.ts'

type SchemaOf<T> =
  T extends OpenAPIHono<any, infer Schema, any> ? Schema : never
const noWidePath: string extends keyof SchemaOf<TargetAppType> ? false : true =
  true
const noWideArchivePath: string extends keyof SchemaOf<
  ReturnType<typeof registerDclArchiveRoutes>
>
  ? false
  : true = true
const noWideIndependentPath: string extends keyof SchemaOf<
  ReturnType<typeof registerIndependentRoutes>
>
  ? false
  : true = true
const supplierDeletePath: '/dcl/supplier/delete' =
  dclArchiveRouteSets.supplier.delete.path

const client = hc<TargetAppType>('http://target.invalid')
const archiveClient = hc<ReturnType<typeof registerDclArchiveRoutes>>(
  'http://target.invalid',
)

// These seams are consumed by @zerp/api-client, which derives its client from
// TargetAppType. Keep their literal paths in the executable Hono composition.
void client.aux.department.options.$get
void client.bob.customer['subunit-options'].$get
void client.vou[':entity'].options.$get
void client.acc.mapping.query.$post
void client.acc.mapping.get.$post
void client.acc.mapping.catalog.$get
void client.vou[':entity'].get.$post({
  param: { entity: 'sales-receipt' },
  json: { documentId: '01J00000000000000000000000' },
})
void client.dcl.supplier.delete.$post({
  json: {
    subjectId: '01J00000000000000000000000',
    submissionId: '01J00000000000000000000001',
    expectedRevision: '1',
  },
})
void archiveClient.dcl.supplier.delete.$post({
  json: {
    subjectId: '01J00000000000000000000000',
    submissionId: '01J00000000000000000000001',
    expectedRevision: '1',
  },
})
void noWidePath
void noWideArchivePath
void noWideIndependentPath
void supplierDeletePath
