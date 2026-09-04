import { hc } from 'hono/client'
import type { OpenAPIHono } from '@hono/zod-openapi'

import type { TargetAppType } from '../src/app/contract.ts'
import type { registerIndependentRoutes } from '../src/app/independent-contract.ts'
import {
  auxReferenceRoute,
  bobReferenceRoute,
} from '../src/app/independent-contract.ts'
import {
  archiveRouteSets,
  type registerArchiveRoutes,
} from '../src/dcl/archive-contract.ts'

type SchemaOf<T> =
  T extends OpenAPIHono<any, infer Schema, any> ? Schema : never
const noWidePath: string extends keyof SchemaOf<TargetAppType> ? false : true =
  true
const noWideArchivePath: string extends keyof SchemaOf<
  ReturnType<typeof registerArchiveRoutes>
>
  ? false
  : true = true
const noWideIndependentPath: string extends keyof SchemaOf<
  ReturnType<typeof registerIndependentRoutes>
>
  ? false
  : true = true
const auxReferencePath: '/aux/reference/query' = auxReferenceRoute.path
const bobReferencePath: '/bob/reference/query' = bobReferenceRoute.path
const vehicleDeletePath: '/dcl/vehicle/delete' =
  archiveRouteSets.vehicle.delete.path

const client = hc<TargetAppType>('http://target.invalid')
const archiveClient = hc<ReturnType<typeof registerArchiveRoutes>>(
  'http://target.invalid',
)

// These seams are consumed by @zerp/api-client, which derives its client from
// TargetAppType. Keep their literal paths in the executable Hono composition.
void client.aux.reference.query.$post
void client.bob.reference.query.$post
void client.acc.mapping.query.$post
void client.acc.mapping.get.$post
void client.acc.mapping.catalog.$post
void client.dcl.vehicle.delete.$post({
  json: {
    subjectId: '01J00000000000000000000000',
    submissionId: '01J00000000000000000000001',
    expectedRevision: '1',
  },
})
void archiveClient.dcl.vehicle.delete.$post({
  json: {
    subjectId: '01J00000000000000000000000',
    submissionId: '01J00000000000000000000001',
    expectedRevision: '1',
  },
})
void noWidePath
void noWideArchivePath
void noWideIndependentPath
void auxReferencePath
void bobReferencePath
void vehicleDeletePath
