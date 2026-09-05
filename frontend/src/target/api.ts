import { createTargetApiClient } from '@zerp/api-client'
import {
  modelBuildId,
  type ApprovalAction,
  type VouEntity,
  type VouPayloadFor,
} from '@zerp/model'

const client = createTargetApiClient({
  baseUrl: import.meta.env.VITE_TARGET_API_BASE_URL ?? 'http://127.0.0.1:18082',
  modelBuildId,
})

type RequestJson<Input> = Input extends { json: infer Json } ? Json : never
type PostJson<Post extends (...args: never[]) => unknown> = RequestJson<
  Parameters<Post>[0]
>
type ClientRequestInput<ClientMethod> = ClientMethod extends (
  ...args: infer Arguments
) => unknown
  ? NonNullable<Arguments[0]>
  : never
type ResponseJson<Response> = Response extends {
  json(): Promise<infer Output>
}
  ? Output
  : never
type ClientResponseOutput<ClientMethod> = ClientMethod extends (
  ...args: never[]
) => Promise<infer Response>
  ? ResponseJson<Response>
  : never

export type TargetWorkbenchQueryInput = PostJson<
  (typeof client.app.workbench.query)['$post']
>

export type TargetUserQueryInput = PostJson<
  (typeof client.app.user.query)['$post']
>
export type TargetUserCreateInput = PostJson<
  (typeof client.app.user.create)['$post']
>
export type TargetUserSaveInput = PostJson<
  (typeof client.app.user.save)['$post']
>
export type TargetRoleQueryInput = PostJson<
  (typeof client.app.role.query)['$post']
>
export type TargetRoleCreateInput = PostJson<
  (typeof client.app.role.create)['$post']
>
export type TargetRoleSaveInput = PostJson<
  (typeof client.app.role.save)['$post']
>
export type TargetPermissionQueryInput = PostJson<
  (typeof client.app.permission.query)['$post']
>
export type TargetSystemParameterQueryInput = PostJson<
  (typeof client.app)['system-parameter']['query']['$post']
>
export type TargetMenuSaveInput = PostJson<
  (typeof client.app.menu)['save-business']['$post']
>

type WarehouseSubmitInput = PostJson<
  (typeof client.dcl.warehouse)['submit-new']['$post']
>
export type TargetWarehouseQueryInput = PostJson<
  (typeof client.dcl.warehouse.query)['$post']
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

export type TargetCustomerAttachmentStageInput = PostJson<
  (typeof client.dcl.customer)['attachment-stage']['$post']
>

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

export type TargetVouQueryInput = ClientRequestInput<
  (typeof client.vou)[':entity']['query']['$post']
>['json']
export type TargetVouSubmitInput = ClientRequestInput<
  (typeof client.vou)[':entity']['submit-new']['$post']
>['json']
export type TargetVouSubmitInputFor<Entity extends VouEntity> = Omit<
  TargetVouSubmitInput,
  'payload'
> & { payload: VouPayloadFor<Entity> }
type TargetVouReviewWithoutReasonInput = ClientRequestInput<
  (typeof client.vou)[':entity']['approve']['$post']
>['json']
type TargetVouReviewWithReasonInput = ClientRequestInput<
  (typeof client.vou)[':entity']['reject']['$post']
>['json']
export type TargetVouReviewRequest =
  | {
      action: 'approve'
      input: TargetVouReviewWithoutReasonInput
    }
  | {
      action: 'unreject'
      input: TargetVouReviewWithoutReasonInput
    }
  | {
      action: 'reject'
      input: TargetVouReviewWithReasonInput
    }
  | {
      action: 'unapprove'
      input: TargetVouReviewWithReasonInput
    }
type VouStageInput = PostJson<
  (typeof client.vou)[':entity']['attachment-stage']['$post']
>
type VouAttachmentReadInput = PostJson<
  (typeof client.vou)[':entity']['attachment-read']['$post']
>
export type TargetVouDeleteInput = ClientRequestInput<
  (typeof client.vou)[':entity']['delete']['$post']
>['json']
export type TargetVouReferenceQueryInput = ClientRequestInput<
  (typeof client.vou.reference.query)['$post']
>['json']
export type TargetVouSourceLineQueryInput = ClientRequestInput<
  (typeof client.vou)['source-line']['query']['$post']
>['json']

type SuccessfulData<Response> = Response extends { code: 0; data: infer Data }
  ? Data
  : never

export type TargetVouView = SuccessfulData<
  ClientResponseOutput<(typeof client.vou)[':entity']['get']['$post']>
>
export type TargetVouViewFor<Entity extends VouEntity> = Omit<
  TargetVouView,
  'entity' | 'payload'
> & {
  entity: Entity
  payload: VouPayloadFor<Entity>
}
type TargetVouPage = SuccessfulData<
  ClientResponseOutput<(typeof client.vou)[':entity']['query']['$post']>
>
export type TargetVouPageFor<Entity extends VouEntity> = Omit<
  TargetVouPage,
  'items'
> & { items: TargetVouViewFor<Entity>[] }
export type TargetVouReferenceResult = SuccessfulData<
  ClientResponseOutput<(typeof client.vou.reference.query)['$post']>
>
export type TargetVouSourceLineResult = SuccessfulData<
  ClientResponseOutput<(typeof client.vou)['source-line']['query']['$post']>
>
export type TargetVouAttachmentReadResult = SuccessfulData<
  ClientResponseOutput<
    (typeof client.vou)[':entity']['attachment-read']['$post']
  >
>

export async function queryTargetVou<Entity extends VouEntity>(
  csrfToken: string,
  entity: Entity,
  input: TargetVouQueryInput,
): Promise<TargetVouPageFor<Entity>> {
  const result = await unwrapTarget(
    await (
      await client.vou[':entity'].query.$post(
        { param: { entity }, json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
  if (!vouPageMatchesEntity(result, entity))
    throw invalidVouResponse('query entity mismatch')
  return result
}

export async function getTargetVou<Entity extends VouEntity>(
  csrfToken: string,
  entity: Entity,
  documentId: string,
): Promise<TargetVouViewFor<Entity>> {
  const result = await unwrapTarget(
    await (
      await client.vou[':entity'].get.$post(
        { param: { entity }, json: { documentId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
  if (!vouViewMatchesEntity(result, entity))
    throw invalidVouResponse('get entity mismatch')
  return result
}

export async function queryTargetVouReference(
  csrfToken: string,
  input: TargetVouReferenceQueryInput,
) {
  return unwrapTarget(
    await (
      await client.vou.reference.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetVouSourceLine(
  csrfToken: string,
  input: TargetVouSourceLineQueryInput,
) {
  return unwrapTarget(
    await (
      await client.vou['source-line'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function stageTargetVouAttachment(
  csrfToken: string,
  entity: VouEntity,
  input: VouStageInput,
) {
  return unwrapTarget(
    await (
      await client.vou[':entity']['attachment-stage'].$post(
        { param: { entity }, json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function readTargetVouAttachment(
  csrfToken: string,
  entity: VouEntity,
  input: VouAttachmentReadInput,
): Promise<TargetVouAttachmentReadResult> {
  return unwrapTarget(
    await (
      await client.vou[':entity']['attachment-read'].$post(
        { param: { entity }, json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitTargetVou<Entity extends VouEntity>(
  csrfToken: string,
  entity: Entity,
  mode: 'NEW' | 'CHANGE',
  input: TargetVouSubmitInputFor<Entity>,
): Promise<TargetVouViewFor<Entity>> {
  const endpoint =
    mode === 'NEW'
      ? client.vou[':entity']['submit-new']
      : client.vou[':entity']['submit-change']
  const result = await unwrapTarget(
    await (
      await endpoint.$post(
        { param: { entity }, json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
  if (!vouViewMatchesEntity(result, entity))
    throw invalidVouResponse('submit entity mismatch')
  return result
}

export async function reviewTargetVou<Entity extends VouEntity>(
  csrfToken: string,
  entity: Entity,
  request: TargetVouReviewRequest,
): Promise<TargetVouViewFor<Entity>> {
  const response =
    request.action === 'approve'
      ? await client.vou[':entity'].approve.$post(
          { param: { entity }, json: request.input },
          csrfHeaders(csrfToken),
        )
      : request.action === 'unreject'
        ? await client.vou[':entity'].unreject.$post(
            { param: { entity }, json: request.input },
            csrfHeaders(csrfToken),
          )
        : request.action === 'reject'
          ? await client.vou[':entity'].reject.$post(
              { param: { entity }, json: request.input },
              csrfHeaders(csrfToken),
            )
          : await client.vou[':entity'].unapprove.$post(
              { param: { entity }, json: request.input },
              csrfHeaders(csrfToken),
            )
  const result = await unwrapTarget(await response.json())
  if (!vouViewMatchesEntity(result, entity))
    throw invalidVouResponse('review entity mismatch')
  return result
}

export async function deleteTargetVou(
  csrfToken: string,
  entity: VouEntity,
  input: TargetVouDeleteInput,
) {
  return unwrapTarget(
    await (
      await client.vou[':entity'].delete.$post(
        {
          param: { entity },
          json: input,
        },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

function vouViewMatchesEntity<Entity extends VouEntity>(
  view: unknown,
  entity: Entity,
): view is TargetVouViewFor<Entity> {
  return (
    typeof view === 'object' &&
    view !== null &&
    'entity' in view &&
    view.entity === entity
  )
}

function vouPageMatchesEntity<Entity extends VouEntity>(
  page: unknown,
  entity: Entity,
): page is TargetVouPageFor<Entity> {
  return (
    typeof page === 'object' &&
    page !== null &&
    'items' in page &&
    Array.isArray(page.items) &&
    page.items.every((item) => vouViewMatchesEntity(item, entity))
  )
}

function invalidVouResponse(message: string): TargetApiError {
  return new TargetApiError('invalid_response', message, '')
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

export async function getTargetBranding() {
  return unwrapTarget(
    await (await client.app.branding.get.$post({ json: {} })).json(),
  )
}

export async function getTargetMenu(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.app.menu.get.$post({ json: {} }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function getTargetProfile(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.app.user.profile.$post({ json: {} }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function saveTargetProfile(
  csrfToken: string,
  input: { displayName: string; avatarUrl?: string | null },
) {
  return unwrapTarget(
    await (
      await client.app.user.profile.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function changeTargetPassword(
  csrfToken: string,
  input: { currentPassword: string; newPassword: string },
) {
  return unwrapTarget(
    await (
      await client.app.user['change-password'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function signOutTarget(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.app.user.signout.$post({ json: {} }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetUsers(
  csrfToken: string,
  input: TargetUserQueryInput = {
    page: 1,
    pageSize: 20,
    sort: [{ field: 'username', order: 'asc' }],
  },
) {
  return unwrapTarget(
    await (
      await client.app.user.query.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function getTargetUser(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.app.user.get.$post({ json: { id } }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function createTargetUser(
  csrfToken: string,
  input: TargetUserCreateInput,
) {
  return unwrapTarget(
    await (
      await client.app.user.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetUser(
  csrfToken: string,
  input: TargetUserSaveInput,
) {
  return unwrapTarget(
    await (
      await client.app.user.save.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function setTargetUserEnabled(
  csrfToken: string,
  input: { id: string; revision: number },
  enabled: boolean,
) {
  const endpoint = enabled ? client.app.user.enable : client.app.user.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function resetTargetUserPassword(
  csrfToken: string,
  input: { id: string; revision: number },
) {
  return unwrapTarget(
    await (
      await client.app.user['reset-password'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetRoles(
  csrfToken: string,
  input: TargetRoleQueryInput,
) {
  return unwrapTarget(
    await (
      await client.app.role.query.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function getTargetRole(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.app.role.get.$post({ json: { id } }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function createTargetRole(
  csrfToken: string,
  input: TargetRoleCreateInput,
) {
  return unwrapTarget(
    await (
      await client.app.role.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetRole(
  csrfToken: string,
  input: TargetRoleSaveInput,
) {
  return unwrapTarget(
    await (
      await client.app.role.save.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function setTargetRoleEnabled(
  csrfToken: string,
  input: { id: string; revision: number },
  enabled: boolean,
) {
  const endpoint = enabled ? client.app.role.enable : client.app.role.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetPermissions(
  csrfToken: string,
  input: TargetPermissionQueryInput,
) {
  return unwrapTarget(
    await (
      await client.app.permission.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetPermission(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.app.permission.get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetSystemParameters(
  csrfToken: string,
  input: TargetSystemParameterQueryInput,
) {
  return unwrapTarget(
    await (
      await client.app['system-parameter'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetSystemParameter(csrfToken: string, key: string) {
  return unwrapTarget(
    await (
      await client.app['system-parameter'].get.$post(
        { json: { key } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetSystemParameter(
  csrfToken: string,
  input: { key: string; configuredValue: string; revision: number },
) {
  return unwrapTarget(
    await (
      await client.app['system-parameter'].save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function resetTargetSystemParameter(
  csrfToken: string,
  input: { key: string; revision: number },
) {
  return unwrapTarget(
    await (
      await client.app['system-parameter'].reset.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetBusinessMenu(
  csrfToken: string,
  input: TargetMenuSaveInput,
) {
  return unwrapTarget(
    await (
      await client.app.menu['save-business'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function activateTargetMenu(
  csrfToken: string,
  input: { mode: 'DEFAULT' | 'BUSINESS'; revision: number },
) {
  return unwrapTarget(
    await (
      await client.app.menu.activate.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function resetTargetBusinessMenu(
  csrfToken: string,
  revision: number,
) {
  return unwrapTarget(
    await (
      await client.app.menu['reset-business'].$post(
        { json: { revision } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetWorkbench(
  csrfToken: string,
  input: TargetWorkbenchQueryInput,
) {
  return unwrapTarget(
    await (
      await client.app.workbench.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
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

export async function queryTargetWarehouses(
  csrfToken: string,
  input: TargetWarehouseQueryInput,
) {
  return unwrapTarget(
    await (
      await client.dcl.warehouse.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetWarehouse(csrfToken: string, subjectId: string) {
  return unwrapTarget(
    await (
      await client.dcl.warehouse.get.$post(
        { json: { subjectId } },
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

export async function targetWarehouseAuditHistory(
  csrfToken: string,
  subjectId: string,
) {
  return unwrapTarget(
    await (
      await client.dcl.warehouse['audit-history'].$post(
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

export const targetAuxEntities = [
  'product-category',
  'product-type',
  'employee-category',
  'department',
  'position',
  'settlement-method',
  'payment-method',
  'dictionary-type',
  'dictionary-item',
  'measurement-unit',
  'income-expense-type',
  'asset-category',
] as const

export type TargetAuxEntity = (typeof targetAuxEntities)[number]
export type TargetAuxQueryInput = PostJson<
  (typeof client.aux)['product-category']['query']['$post']
>
export type TargetAuxCreateInput = PostJson<
  (typeof client.aux)['product-category']['create']['$post']
>
export type TargetAuxSaveInput = PostJson<
  (typeof client.aux)['product-category']['save']['$post']
>

const targetAuxClients = {
  'product-category': client.aux['product-category'],
  'product-type': client.aux['product-type'],
  'employee-category': client.aux['employee-category'],
  department: client.aux.department,
  position: client.aux.position,
  'settlement-method': client.aux['settlement-method'],
  'payment-method': client.aux['payment-method'],
  'dictionary-type': client.aux['dictionary-type'],
  'dictionary-item': client.aux['dictionary-item'],
  'measurement-unit': client.aux['measurement-unit'],
  'income-expense-type': client.aux['income-expense-type'],
  'asset-category': client.aux['asset-category'],
}

export async function queryTargetAux(
  csrfToken: string,
  entity: TargetAuxEntity,
  input: TargetAuxQueryInput,
) {
  return unwrapTarget(
    await (
      await targetAuxClients[entity].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetAux(
  csrfToken: string,
  entity: TargetAuxEntity,
  objectId: string,
) {
  return unwrapTarget(
    await (
      await targetAuxClients[entity].get.$post(
        { json: { objectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function createTargetAux(
  csrfToken: string,
  entity: Exclude<TargetAuxEntity, 'settlement-method'>,
  input: TargetAuxCreateInput,
) {
  return unwrapTarget(
    await (
      await targetAuxClients[entity].create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetAux(
  csrfToken: string,
  entity: TargetAuxEntity,
  input: TargetAuxSaveInput,
) {
  return unwrapTarget(
    await (
      await targetAuxClients[entity].save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetAuxEnabled(
  csrfToken: string,
  entity: TargetAuxEntity,
  input: { objectId: string; objectRevision: number },
  enabled: boolean,
) {
  const endpoint = enabled
    ? targetAuxClients[entity].enable
    : targetAuxClients[entity].disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function deleteTargetAux(
  csrfToken: string,
  entity: Exclude<TargetAuxEntity, 'settlement-method'>,
  input: { objectId: string; objectRevision: number },
) {
  return unwrapTarget(
    await (
      await targetAuxClients[entity].delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
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
  | 'payment-method'
export type TargetBobReferenceEntity =
  | 'customer-subunit'
  | 'employee'
  | 'other-unit'
  | 'sales-partner'
  | 'product'
  | 'operating-entity'
  | 'supplier'

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
  input: PostJson<(typeof client.acc.mapping.query)['$post']>,
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
  input: PostJson<(typeof client.acc.mapping.get)['$post']>,
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

export type TargetAccBookQueryInput = PostJson<
  (typeof client.acc.book.query)['$post']
>
export type TargetAccSubjectQueryInput = PostJson<
  (typeof client.acc.subject.query)['$post']
>

export async function queryTargetAccBooks(
  csrfToken: string,
  input: TargetAccBookQueryInput,
) {
  return unwrapTarget(
    await (
      await client.acc.book.query.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function createTargetAccBook(
  csrfToken: string,
  input: PostJson<(typeof client.acc.book.create)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.book.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetAccBook(
  csrfToken: string,
  input: PostJson<(typeof client.acc.book.save)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.book.save.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function deleteTargetAccBook(
  csrfToken: string,
  input: PostJson<(typeof client.acc.book.delete)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.book.delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetAccSubjects(
  csrfToken: string,
  input: TargetAccSubjectQueryInput,
) {
  return unwrapTarget(
    await (
      await client.acc.subject.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function createTargetAccSubject(
  csrfToken: string,
  input: PostJson<(typeof client.acc.subject.create)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.subject.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetAccSubject(
  csrfToken: string,
  input: PostJson<(typeof client.acc.subject.save)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.subject.save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function deleteTargetAccSubject(
  csrfToken: string,
  input: PostJson<(typeof client.acc.subject.delete)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.subject.delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetAccOpening(
  csrfToken: string,
  input: PostJson<(typeof client.acc.opening.query)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.opening.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitTargetAccOpening(
  csrfToken: string,
  input: PostJson<(typeof client.acc.opening)['submit-new']['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.opening['submit-new'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function reviewTargetAccOpening(
  csrfToken: string,
  action: ApprovalAction,
  input:
    | PostJson<(typeof client.acc.opening.approve)['$post']>
    | PostJson<(typeof client.acc.opening.reject)['$post']>,
) {
  const options = csrfHeaders(csrfToken)
  if (action === 'approve' || action === 'unreject')
    return unwrapTarget(
      await (
        await client.acc.opening[action].$post(
          {
            json: {
              bookId: input.bookId,
              submissionId: input.submissionId,
              expectedRevision: input.expectedRevision,
            },
          },
          options,
        )
      ).json(),
    )
  if (!('reason' in input))
    throw new Error('ACC opening review reason is required.')
  return unwrapTarget(
    await (
      await client.acc.opening[action].$post({ json: input }, options)
    ).json(),
  )
}

export async function deleteTargetAccOpening(
  csrfToken: string,
  input: PostJson<(typeof client.acc.opening.delete)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.opening.delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetAccPeriods(
  csrfToken: string,
  input: PostJson<(typeof client.acc.period.query)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.period.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetAccPeriod(
  csrfToken: string,
  action: 'lock' | 'unlock',
  input: PostJson<(typeof client.acc.period.lock)['$post']>,
) {
  return unwrapTarget(
    await (
      await client.acc.period[action].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetWflDefinitions(
  csrfToken: string,
  input: PostJson<
    (typeof client.dcl)['wfl-process-definition']['query']['$post']
  >,
) {
  return unwrapTarget(
    await (
      await client.dcl['wfl-process-definition'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetWflDefinition(
  csrfToken: string,
  subjectId: string,
) {
  return unwrapTarget(
    await (
      await client.dcl['wfl-process-definition'].get.$post(
        { json: { subjectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitTargetWflDefinition(
  csrfToken: string,
  mode: 'NEW' | 'CHANGE',
  input: PostJson<
    (typeof client.dcl)['wfl-process-definition']['submit-new']['$post']
  >,
) {
  const endpoint =
    mode === 'NEW'
      ? client.dcl['wfl-process-definition']['submit-new']
      : client.dcl['wfl-process-definition']['submit-change']
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function reviewTargetWflDefinition(
  csrfToken: string,
  action: ApprovalAction,
  input:
    | PostJson<
        (typeof client.dcl)['wfl-process-definition']['approve']['$post']
      >
    | PostJson<
        (typeof client.dcl)['wfl-process-definition']['reject']['$post']
      >,
) {
  const options = csrfHeaders(csrfToken)
  if (action === 'approve' || action === 'unreject')
    return unwrapTarget(
      await (
        await client.dcl['wfl-process-definition'][action].$post(
          {
            json: {
              subjectId: input.subjectId,
              submissionId: input.submissionId,
              expectedRevision: input.expectedRevision,
            },
          },
          options,
        )
      ).json(),
    )
  if (!('reason' in input))
    throw new Error('WFL definition review reason is required.')
  return unwrapTarget(
    await (
      await client.dcl['wfl-process-definition'][action].$post(
        { json: input },
        options,
      )
    ).json(),
  )
}

export async function deleteTargetWflDefinition(
  csrfToken: string,
  input: PostJson<
    (typeof client.dcl)['wfl-process-definition']['delete']['$post']
  >,
) {
  return unwrapTarget(
    await (
      await client.dcl['wfl-process-definition'].delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetWflDefinitionEnabled(
  csrfToken: string,
  action: 'enable' | 'disable',
  input: PostJson<
    (typeof client.dcl)['wfl-process-definition']['enable']['$post']
  >,
) {
  return unwrapTarget(
    await (
      await client.dcl['wfl-process-definition'][action].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function trialTargetWflDefinition(
  csrfToken: string,
  input: PostJson<(typeof client.wfl)['process-definition']['trial']['$post']>,
) {
  return unwrapTarget(
    await (
      await client.wfl['process-definition'].trial.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export type TargetWflQueryInput = PostJson<
  (typeof client.wfl)['process-definition']['query']['$post']
>

export async function queryTargetWflCurrentDefinitions(
  csrfToken: string,
  input: TargetWflQueryInput,
) {
  return unwrapTarget(
    await (
      await client.wfl['process-definition'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetWflCurrentDefinition(
  csrfToken: string,
  code: string,
) {
  return unwrapTarget(
    await (
      await client.wfl['process-definition'].get.$post(
        { json: { code } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetWflInstances(
  csrfToken: string,
  input: PostJson<(typeof client.wfl)['process-instance']['query']['$post']>,
) {
  return unwrapTarget(
    await (
      await client.wfl['process-instance'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetWflInstance(
  csrfToken: string,
  processId: string,
) {
  return unwrapTarget(
    await (
      await client.wfl['process-instance'].get.$post(
        { json: { processId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function actionTargetWflInstance(
  csrfToken: string,
  input: PostJson<(typeof client.wfl)['process-instance']['action']['$post']>,
) {
  return unwrapTarget(
    await (
      await client.wfl['process-instance'].action.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetRptDirectory(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.rpt.directory.query.$post(
        { json: {} },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetRpt(
  csrfToken: string,
  code: string,
  input: PostJson<(typeof client.rpt)[':code']['query']['$post']>,
) {
  return unwrapTarget(
    await (
      await client.rpt[':code'].query.$post(
        { param: { code }, json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function exportTargetRpt(
  csrfToken: string,
  code: string,
  input: PostJson<(typeof client.rpt)[':code']['export']['$post']>,
) {
  return unwrapTarget(
    await (
      await client.rpt[':code'].export.$post(
        { param: { code }, json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetRptReference(
  csrfToken: string,
  code: string,
  input: PostJson<(typeof client.rpt)[':code']['reference-query']['$post']>,
) {
  return unwrapTarget(
    await (
      await client.rpt[':code']['reference-query'].$post(
        { param: { code }, json: input },
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
  input: TargetCustomerAttachmentStageInput,
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
