import { createTargetApiClient } from '@zerp/api-client'
import { modelBuildId } from '@zerp/model'

const client = createTargetApiClient({
  baseUrl: import.meta.env.VITE_TARGET_API_BASE_URL ?? 'http://127.0.0.1:18082',
  modelBuildId,
})

type RequestJson<Input> = Input extends { json: infer Json } ? Json : never
type PostJson<Post extends (...args: never[]) => unknown> = RequestJson<
  Parameters<Post>[0]
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
export type TargetUserEnabledInput = PostJson<
  (typeof client.app.user.enable)['$post']
>
export type TargetRoleQueryInput = PostJson<
  (typeof client.app.role.query)['$post']
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
    await client.session.auth.restore.$post({ json: {} })
  ).json()
  if (payload.code !== 0 || !payload.data)
    throw new TargetApiError(
      payload.errorKey,
      payload.message,
      payload.requestId,
    )
  return payload.data
}

export async function signInTarget(code: string, password: string) {
  const payload = await (
    await client.session.auth.signin.$post({ json: { code, password } })
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
    await (await client.session.app.get.$post({ json: {} })).json(),
  )
}

export async function getTargetProfile(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.session.user.get.$post({ json: {} }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function saveTargetProfile(
  csrfToken: string,
  input: { name: string; avatarUrl?: string | null },
) {
  return unwrapTarget(
    await (
      await client.session.user.save.$post(
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
      await client.session.user['change-password'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function signOutTarget(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.session.auth.signout.$post(
        { json: {} },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetUsers(
  csrfToken: string,
  input: TargetUserQueryInput = {
    keyword: '',
    page: 1,
    pageSize: 20,
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
  input: TargetUserEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled ? client.app.user.enable : client.app.user.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
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
