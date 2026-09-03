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

async function unwrapTarget<
  T extends {
    code: number
    errorKey: string
    message: string
    requestId: string
    data: unknown
  },
>(payload: T): Promise<TargetSuccessData<T>> {
  if (payload.code !== 0 || payload.data === null)
    throw new TargetApiError(
      payload.errorKey,
      payload.message,
      payload.requestId,
    )
  return payload.data as TargetSuccessData<T>
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
