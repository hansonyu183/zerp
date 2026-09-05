import { setCookie } from 'hono/cookie'
import type { Context } from 'hono'

import type { TargetConfig } from '../platform/config.ts'

export type ApplicationErrorCode = 1001 | 1002 | 2001 | 3001 | 5000

export interface ApplicationError {
  errorKey: string
  message: string
}

export function applicationErrorCode(errorKey: string): ApplicationErrorCode {
  if (
    [
      'unauthenticated',
      'invalid_credentials',
      'account_disabled',
      'account_locked',
    ].includes(errorKey)
  )
    return 1001
  if (errorKey === 'forbidden') return 1002
  if (errorKey === 'validation_failed' || errorKey === 'not_found') return 2001
  if (errorKey === 'internal_error') return 5000
  return 3001
}

export function applicationFailure<Data>(
  requestId: string,
  error: ApplicationError,
  data: Data,
) {
  return {
    code: applicationErrorCode(error.errorKey),
    errorKey: error.errorKey,
    message: error.message,
    data,
    requestId,
  }
}

export function clearSessionCookie(
  context: Context,
  config: TargetConfig,
): void {
  setCookie(context, config.sessionCookieName, '', {
    path: '/',
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: config.sessionCookieSameSite,
    maxAge: 0,
  })
}

export function clearUnauthenticatedSessionCookie(
  context: Context,
  config: TargetConfig,
  error: unknown,
): void {
  if (
    error &&
    typeof error === 'object' &&
    'errorKey' in error &&
    error.errorKey === 'unauthenticated'
  )
    clearSessionCookie(context, config)
}
