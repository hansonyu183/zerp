import { createTargetApiClient } from '@zerp/api-client'
import { modelBuildId, type ApprovalAction } from '@zerp/model'

const client = createTargetApiClient({
  baseUrl: import.meta.env.VITE_TARGET_API_BASE_URL ?? 'http://127.0.0.1:18082',
  modelBuildId,
})

type PostJson<Post extends (...args: never[]) => unknown> =
  Parameters<Post>[0] extends { json: infer Json } ? Json : never

type WarehouseSubmitInput = PostJson<
  (typeof client.dcl.warehouse)['submit-new']['$post']
>
type WarehouseReviewInput = PostJson<
  (typeof client.dcl.warehouse)['approve']['$post']
>
type WarehouseDeleteInput = PostJson<
  (typeof client.dcl.warehouse)['delete']['$post']
>

export const targetArchiveEntities = [
  'operating-entity',
  'vehicle',
  'fund-account',
  'product',
  'employee',
  'supplier',
  'customer',
  'other-unit',
  'sales-partner',
  'acc-mapping',
  'rpt-definition',
] as const

export type TargetArchiveEntity = (typeof targetArchiveEntities)[number]

type TargetArchiveCommonQueryInput = PostJson<
  (typeof client.dcl.vehicle.query)['$post']
>
type TargetArchiveProductQueryInput = PostJson<
  (typeof client.dcl.product.query)['$post']
>
type TargetArchiveAccMappingQueryInput = PostJson<
  (typeof client.dcl)['acc-mapping']['query']['$post']
>

export type TargetArchiveCommonEntity = Exclude<
  TargetArchiveEntity,
  'product' | 'acc-mapping'
>

export type TargetArchiveQueryRequest =
  | {
      entity: TargetArchiveCommonEntity
      input: TargetArchiveCommonQueryInput
    }
  | { entity: 'product'; input: TargetArchiveProductQueryInput }
  | { entity: 'acc-mapping'; input: TargetArchiveAccMappingQueryInput }

export type TargetArchiveSubmitInput<Entity extends TargetArchiveEntity> =
  Entity extends 'operating-entity'
    ? PostJson<(typeof client.dcl)['operating-entity']['submit-new']['$post']>
    : Entity extends 'vehicle'
      ? PostJson<(typeof client.dcl.vehicle)['submit-new']['$post']>
      : Entity extends 'fund-account'
        ? PostJson<(typeof client.dcl)['fund-account']['submit-new']['$post']>
        : Entity extends 'product'
          ? PostJson<(typeof client.dcl.product)['submit-new']['$post']>
          : Entity extends 'employee'
            ? PostJson<(typeof client.dcl.employee)['submit-new']['$post']>
            : Entity extends 'supplier'
              ? PostJson<(typeof client.dcl.supplier)['submit-new']['$post']>
              : Entity extends 'customer'
                ? PostJson<(typeof client.dcl.customer)['submit-new']['$post']>
                : Entity extends 'other-unit'
                  ? PostJson<
                      (typeof client.dcl)['other-unit']['submit-new']['$post']
                    >
                  : Entity extends 'sales-partner'
                    ? PostJson<
                        (typeof client.dcl)['sales-partner']['submit-new']['$post']
                      >
                    : Entity extends 'acc-mapping'
                      ? PostJson<
                          (typeof client.dcl)['acc-mapping']['submit-new']['$post']
                        >
                      : PostJson<
                          (typeof client.dcl)['rpt-definition']['submit-new']['$post']
                        >

export type TargetArchiveSubmitRequest = {
  [Entity in TargetArchiveEntity]: {
    entity: Entity
    mode: 'NEW' | 'CHANGE'
    input: TargetArchiveSubmitInput<Entity>
  }
}[TargetArchiveEntity]

type ArchiveReviewWithoutReason = PostJson<
  (typeof client.dcl)['operating-entity']['approve']['$post']
>
type ArchiveReviewWithReason = PostJson<
  (typeof client.dcl)['operating-entity']['reject']['$post']
>

export type TargetArchiveReviewRequest = { entity: TargetArchiveEntity } & (
  | {
      action: 'approve' | 'unreject'
      input: ArchiveReviewWithoutReason
    }
  | {
      action: 'reject' | 'unapprove'
      input: ArchiveReviewWithReason
    }
)

type ArchiveDeleteInput<Entity extends TargetArchiveEntity> =
  Entity extends 'operating-entity'
    ? PostJson<(typeof client.dcl)['operating-entity']['delete']['$post']>
    : Entity extends 'vehicle'
      ? PostJson<(typeof client.dcl.vehicle)['delete']['$post']>
      : Entity extends 'fund-account'
        ? PostJson<(typeof client.dcl)['fund-account']['delete']['$post']>
        : Entity extends 'product'
          ? PostJson<(typeof client.dcl.product)['delete']['$post']>
          : Entity extends 'employee'
            ? PostJson<(typeof client.dcl.employee)['delete']['$post']>
            : Entity extends 'supplier'
              ? PostJson<(typeof client.dcl.supplier)['delete']['$post']>
              : Entity extends 'customer'
                ? PostJson<(typeof client.dcl.customer)['delete']['$post']>
                : Entity extends 'other-unit'
                  ? PostJson<
                      (typeof client.dcl)['other-unit']['delete']['$post']
                    >
                  : Entity extends 'sales-partner'
                    ? PostJson<
                        (typeof client.dcl)['sales-partner']['delete']['$post']
                      >
                    : Entity extends 'acc-mapping'
                      ? PostJson<
                          (typeof client.dcl)['acc-mapping']['delete']['$post']
                        >
                      : PostJson<
                          (typeof client.dcl)['rpt-definition']['delete']['$post']
                        >

export type TargetArchiveDeleteRequest = {
  [Entity in TargetArchiveEntity]: {
    entity: Entity
    input: ArchiveDeleteInput<Entity>
  }
}[TargetArchiveEntity]

export class TargetApiError extends Error {
  readonly errorKey: string
  readonly requestId: string

  constructor(errorKey: string, message: string, requestId: string) {
    super(message)
    this.name = 'TargetApiError'
    this.errorKey = errorKey
    this.requestId = requestId
  }
}

export async function restoreTargetSession() {
  const payload = await (
    await client.app.user.session.$post({ json: {} })
  ).json()
  if (payload.code !== 0 || !payload.data)
    throw new TargetApiError(
      payload.errorKey,
      payload.message,
      payload.requestId,
    )
  return payload.data
}

export async function signInTarget(username: string, password: string) {
  const payload = await (
    await client.app.user.signin.$post({ json: { username, password } })
  ).json()
  if (payload.code !== 0 || !payload.data)
    throw new TargetApiError(
      payload.errorKey,
      payload.message,
      payload.requestId,
    )
  return payload.data
}

export async function queryTargetUsers(csrfToken: string) {
  const payload = await (
    await client.app.user.query.$post(
      {
        json: {
          page: 1,
          pageSize: 20,
          sort: [{ field: 'username', order: 'asc' }],
        },
      },
      { headers: { 'X-CSRF-Token': csrfToken } },
    )
  ).json()
  if (payload.code !== 0 || !payload.data)
    throw new TargetApiError(
      payload.errorKey,
      payload.message,
      payload.requestId,
    )
  return payload.data
}

type TargetSuccessData<T> = T extends { code: 0; data: infer Data }
  ? Data
  : never

function unwrapTarget<
  T extends {
    code: number
    errorKey: string
    message: string
    requestId: string
    data: unknown
  },
>(payload: T): Promise<TargetSuccessData<T>>
function unwrapTarget(payload: unknown): Promise<unknown>
async function unwrapTarget(payload: unknown): Promise<unknown> {
  if (
    !isTargetEnvelope(payload) ||
    payload.code !== 0 ||
    payload.data === null
  ) {
    const failure = isTargetEnvelope(payload) ? payload : undefined
    throw new TargetApiError(
      failure?.errorKey ?? 'invalid_response',
      failure?.message ?? 'invalid target response',
      failure?.requestId ?? '',
    )
  }
  return payload.data
}

function isTargetEnvelope(payload: unknown): payload is {
  code: number
  errorKey: string
  message: string
  requestId: string
  data: unknown
} {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Record<string, unknown>
  return (
    typeof value.code === 'number' &&
    typeof value.errorKey === 'string' &&
    typeof value.message === 'string' &&
    typeof value.requestId === 'string' &&
    'data' in value
  )
}

function csrfHeaders(csrfToken: string) {
  return { headers: { 'X-CSRF-Token': csrfToken } }
}

export async function queryTargetWarehouses(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.dcl.warehouse.query.$post(
        { json: {} },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function targetWarehouseVersions(
  csrfToken: string,
  subjectId: string,
) {
  return unwrapTarget(
    await (
      await client.dcl.warehouse.versions.$post(
        { json: { subjectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function targetWarehouseManagerReference(
  csrfToken: string,
  employeeId: string,
  action: 'submit-new' | 'submit-change',
) {
  return unwrapTarget(
    await (
      await client.dcl.warehouse['manager-reference'].$post(
        { json: { employeeId, action } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitTargetWarehouse(
  csrfToken: string,
  mode: 'NEW' | 'CHANGE',
  input: WarehouseSubmitInput,
) {
  const route =
    mode === 'NEW'
      ? client.dcl.warehouse['submit-new']
      : client.dcl.warehouse['submit-change']
  return unwrapTarget(
    await (await route.$post({ json: input }, csrfHeaders(csrfToken))).json(),
  )
}

export type TargetWarehouseAction = Extract<
  ApprovalAction,
  keyof typeof client.dcl.warehouse
>

export async function reviewTargetWarehouse(
  csrfToken: string,
  action: TargetWarehouseAction,
  input: WarehouseReviewInput,
) {
  return unwrapTarget(
    await (
      await client.dcl.warehouse[action].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function deleteTargetWarehouseSubmission(
  csrfToken: string,
  input: WarehouseDeleteInput,
) {
  return unwrapTarget(
    await (
      await client.dcl.warehouse.delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetArchive(
  csrfToken: string,
  request: TargetArchiveQueryRequest,
) {
  const headers = csrfHeaders(csrfToken)
  switch (request.entity) {
    case 'operating-entity':
      return unwrapTarget(
        await (
          await client.dcl['operating-entity'].query.$post(
            { json: request.input },
            headers,
          )
        ).json(),
      )
    case 'vehicle':
      return unwrapTarget(
        await (
          await client.dcl.vehicle.query.$post({ json: request.input }, headers)
        ).json(),
      )
    case 'fund-account':
      return unwrapTarget(
        await (
          await client.dcl['fund-account'].query.$post(
            { json: request.input },
            headers,
          )
        ).json(),
      )
    case 'product':
      return unwrapTarget(
        await (
          await client.dcl.product.query.$post({ json: request.input }, headers)
        ).json(),
      )
    case 'employee':
      return unwrapTarget(
        await (
          await client.dcl.employee.query.$post(
            { json: request.input },
            headers,
          )
        ).json(),
      )
    case 'supplier':
      return unwrapTarget(
        await (
          await client.dcl.supplier.query.$post(
            { json: request.input },
            headers,
          )
        ).json(),
      )
    case 'customer':
      return unwrapTarget(
        await (
          await client.dcl.customer.query.$post(
            { json: request.input },
            headers,
          )
        ).json(),
      )
    case 'other-unit':
      return unwrapTarget(
        await (
          await client.dcl['other-unit'].query.$post(
            { json: request.input },
            headers,
          )
        ).json(),
      )
    case 'sales-partner':
      return unwrapTarget(
        await (
          await client.dcl['sales-partner'].query.$post(
            { json: request.input },
            headers,
          )
        ).json(),
      )
    case 'acc-mapping':
      return unwrapTarget(
        await (
          await client.dcl['acc-mapping'].query.$post(
            { json: request.input },
            headers,
          )
        ).json(),
      )
    case 'rpt-definition':
      return unwrapTarget(
        await (
          await client.dcl['rpt-definition'].query.$post(
            { json: request.input },
            headers,
          )
        ).json(),
      )
  }
}

type TargetArchiveReadAction = 'get' | 'versions' | 'audit-history'

async function readTargetArchive(
  csrfToken: string,
  entity: TargetArchiveEntity,
  action: TargetArchiveReadAction,
  subjectId: string,
  approvalEntryId?: string,
) {
  const input = { json: { subjectId } }
  const headers = csrfHeaders(csrfToken)
  switch (entity) {
    case 'operating-entity':
      return unwrapTarget(
        await (
          await client.dcl['operating-entity'][action].$post(input, headers)
        ).json(),
      )
    case 'vehicle':
      return unwrapTarget(
        await (await client.dcl.vehicle[action].$post(input, headers)).json(),
      )
    case 'fund-account':
      return unwrapTarget(
        await (
          await client.dcl['fund-account'][action].$post(input, headers)
        ).json(),
      )
    case 'product':
      return unwrapTarget(
        await (await client.dcl.product[action].$post(input, headers)).json(),
      )
    case 'employee':
      return unwrapTarget(
        await (await client.dcl.employee[action].$post(input, headers)).json(),
      )
    case 'supplier':
      return unwrapTarget(
        await (await client.dcl.supplier[action].$post(input, headers)).json(),
      )
    case 'customer':
      return unwrapTarget(
        await (await client.dcl.customer[action].$post(input, headers)).json(),
      )
    case 'other-unit':
      return unwrapTarget(
        await (
          await client.dcl['other-unit'][action].$post(input, headers)
        ).json(),
      )
    case 'sales-partner':
      return unwrapTarget(
        await (
          await client.dcl['sales-partner'][action].$post(input, headers)
        ).json(),
      )
    case 'acc-mapping':
      return unwrapTarget(
        await (
          await client.dcl['acc-mapping'][action].$post(input, headers)
        ).json(),
      )
    case 'rpt-definition':
      if (action === 'get')
        return unwrapTarget(
          await (
            await client.dcl['rpt-definition'].get.$post(
              {
                json: {
                  subjectId,
                  ...(approvalEntryId && { approvalEntryId }),
                },
              },
              headers,
            )
          ).json(),
        )
      return unwrapTarget(
        await (
          await client.dcl['rpt-definition'][action].$post(input, headers)
        ).json(),
      )
  }
}

export function getTargetArchive(
  csrfToken: string,
  entity: TargetArchiveEntity,
  subjectId: string,
  approvalEntryId?: string,
) {
  return readTargetArchive(csrfToken, entity, 'get', subjectId, approvalEntryId)
}

export function targetArchiveVersions(
  csrfToken: string,
  entity: TargetArchiveEntity,
  subjectId: string,
) {
  return readTargetArchive(csrfToken, entity, 'versions', subjectId)
}

export function targetArchiveAuditHistory(
  csrfToken: string,
  entity: TargetArchiveEntity,
  subjectId: string,
) {
  return readTargetArchive(csrfToken, entity, 'audit-history', subjectId)
}

export type TargetAuxReferenceEntity =
  | 'dictionary-item'
  | 'product-type'
  | 'product-category'
  | 'measurement-unit'
  | 'employee-category'
  | 'department'
  | 'position'
  | 'settlement-method'
export type TargetBobReferenceEntity =
  'operating-entity' | 'employee' | 'other-unit' | 'sales-partner'

export function normalizeTargetBobReferenceCandidate<
  Candidate extends { sourceApprovalEntryId: string },
>(candidate: Candidate) {
  const { sourceApprovalEntryId, ...snapshot } = candidate
  return { ...snapshot, approvalEntryId: sourceApprovalEntryId }
}

export async function queryTargetAuxReference(
  csrfToken: string,
  entity: TargetAuxReferenceEntity,
) {
  return unwrapTarget(
    await (
      await client.aux.reference.query.$post(
        { json: { entity } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetBobReference(
  csrfToken: string,
  entity: TargetBobReferenceEntity,
) {
  const candidates = await unwrapTarget(
    await (
      await client.bob.reference.query.$post(
        { json: { entity } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
  return candidates.map(normalizeTargetBobReferenceCandidate)
}

export async function queryTargetAccMappingCatalog(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.acc.mapping.catalog.$post(
        { json: {} },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetAccMappingCurrent(
  csrfToken: string,
  input: { bookId: string; vouEntity?: string; page: number; pageSize: number },
) {
  return unwrapTarget(
    await (
      await client.acc.mapping.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetAccMappingCurrent(
  csrfToken: string,
  input: { bookId: string; vouEntity: string },
) {
  return unwrapTarget(
    await (
      await client.acc.mapping.get.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitTargetArchive(
  csrfToken: string,
  request: TargetArchiveSubmitRequest,
) {
  const options = csrfHeaders(csrfToken)
  switch (request.entity) {
    case 'operating-entity':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl['operating-entity']['submit-new']
              : client.dcl['operating-entity']['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'vehicle':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl.vehicle['submit-new']
              : client.dcl.vehicle['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'fund-account':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl['fund-account']['submit-new']
              : client.dcl['fund-account']['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'product':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl.product['submit-new']
              : client.dcl.product['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'employee':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl.employee['submit-new']
              : client.dcl.employee['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'supplier':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl.supplier['submit-new']
              : client.dcl.supplier['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'customer':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl.customer['submit-new']
              : client.dcl.customer['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'other-unit':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl['other-unit']['submit-new']
              : client.dcl['other-unit']['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'sales-partner':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl['sales-partner']['submit-new']
              : client.dcl['sales-partner']['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'acc-mapping':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl['acc-mapping']['submit-new']
              : client.dcl['acc-mapping']['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
    case 'rpt-definition':
      return unwrapTarget(
        await (
          await (
            request.mode === 'NEW'
              ? client.dcl['rpt-definition']['submit-new']
              : client.dcl['rpt-definition']['submit-change']
          ).$post({ json: request.input }, options)
        ).json(),
      )
  }
}

export async function stageTargetCustomerAttachment(
  csrfToken: string,
  input: PostJson<(typeof client.dcl.customer)['attachment-stage']['$post']>,
) {
  return unwrapTarget(
    await (
      await client.dcl.customer['attachment-stage'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function reviewTargetArchive(
  csrfToken: string,
  request: TargetArchiveReviewRequest,
) {
  const options = csrfHeaders(csrfToken)
  const endpoints = (() => {
    switch (request.entity) {
      case 'operating-entity':
        return client.dcl['operating-entity']
      case 'vehicle':
        return client.dcl.vehicle
      case 'fund-account':
        return client.dcl['fund-account']
      case 'product':
        return client.dcl.product
      case 'employee':
        return client.dcl.employee
      case 'supplier':
        return client.dcl.supplier
      case 'customer':
        return client.dcl.customer
      case 'other-unit':
        return client.dcl['other-unit']
      case 'sales-partner':
        return client.dcl['sales-partner']
      case 'acc-mapping':
        return client.dcl['acc-mapping']
      case 'rpt-definition':
        return client.dcl['rpt-definition']
    }
  })()
  switch (request.action) {
    case 'approve':
      return unwrapTarget(
        await (
          await endpoints.approve.$post({ json: request.input }, options)
        ).json(),
      )
    case 'unreject':
      return unwrapTarget(
        await (
          await endpoints.unreject.$post({ json: request.input }, options)
        ).json(),
      )
    case 'reject':
      return unwrapTarget(
        await (
          await endpoints.reject.$post({ json: request.input }, options)
        ).json(),
      )
    case 'unapprove':
      return unwrapTarget(
        await (
          await endpoints.unapprove.$post({ json: request.input }, options)
        ).json(),
      )
  }
}

export async function deleteTargetArchive(
  csrfToken: string,
  request: TargetArchiveDeleteRequest,
) {
  const options = csrfHeaders(csrfToken)
  switch (request.entity) {
    case 'operating-entity':
      return unwrapTarget(
        await (
          await client.dcl['operating-entity'].delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'vehicle':
      return unwrapTarget(
        await (
          await client.dcl.vehicle.delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'fund-account':
      return unwrapTarget(
        await (
          await client.dcl['fund-account'].delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'product':
      return unwrapTarget(
        await (
          await client.dcl.product.delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'employee':
      return unwrapTarget(
        await (
          await client.dcl.employee.delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'supplier':
      return unwrapTarget(
        await (
          await client.dcl.supplier.delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'customer':
      return unwrapTarget(
        await (
          await client.dcl.customer.delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'other-unit':
      return unwrapTarget(
        await (
          await client.dcl['other-unit'].delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'sales-partner':
      return unwrapTarget(
        await (
          await client.dcl['sales-partner'].delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'acc-mapping':
      return unwrapTarget(
        await (
          await client.dcl['acc-mapping'].delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
    case 'rpt-definition':
      return unwrapTarget(
        await (
          await client.dcl['rpt-definition'].delete.$post(
            { json: request.input },
            options,
          )
        ).json(),
      )
  }
}
