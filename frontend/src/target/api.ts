import { createTargetApiClient } from '@zerp/api-client'
import { modelBuildId } from '@zerp/model'

const client = createTargetApiClient({
  baseUrl: import.meta.env.VITE_TARGET_API_BASE_URL ?? 'http://127.0.0.1:18082',
  modelBuildId,
})

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
