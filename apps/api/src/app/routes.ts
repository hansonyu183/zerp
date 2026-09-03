import type { OpenAPIHono } from '@hono/zod-openapi'
import { getCookie, setCookie } from 'hono/cookie'

import type { TargetConfig } from '../platform/config.ts'
import { currentRequestId } from '../platform/request-id.ts'
import {
  registerTargetRoutes,
  targetRouteMetadata,
  type TargetRouteEnvironment,
} from './contract.ts'
import { SessionError, type Principal, type SessionService } from './session.ts'

export { targetRouteMetadata }

function failure(requestId: string, errorKey: string, message: string) {
  const code =
    errorKey === 'unauthenticated'
      ? 1001
      : errorKey === 'forbidden'
        ? 1002
        : 3001
  return { code, errorKey, message, data: null, requestId }
}

function sessionPayload(principal: Principal) {
  return {
    user: principal.user,
    csrfToken: principal.csrfToken,
    permissions: principal.permissions,
    passwordChangeRequired: principal.passwordChangeRequired,
    passwordMinLength: principal.passwordMinLength,
  }
}

function cookieOptions(config: TargetConfig) {
  return {
    httpOnly: true,
    secure: config.sessionCookieSecure,
    sameSite: config.sessionCookieSameSite,
    path: '/',
    maxAge: Math.floor(config.sessionAbsoluteTimeoutMs / 1000),
  } as const
}

function sessionFailure(error: unknown, requestId: string) {
  if (!(error instanceof SessionError)) throw error
  return failure(
    requestId,
    error.errorKey,
    error.errorKey === 'forbidden' ? 'permission denied' : 'session expired',
  )
}

export function registerAppRoutes(
  app: OpenAPIHono<TargetRouteEnvironment>,
  service: SessionService,
  config: TargetConfig,
) {
  return registerTargetRoutes(app, {
    signin: async (context) => {
      const input = context.req.valid('json')
      try {
        const { token, principal } = await service.signin(
          input.username,
          input.password,
        )
        setCookie(
          context,
          config.sessionCookieName,
          token,
          cookieOptions(config),
        )
        return context.json(
          {
            code: 0 as const,
            errorKey: '' as const,
            message: 'ok' as const,
            data: sessionPayload(principal),
            requestId: currentRequestId(context),
          },
          200,
        )
      } catch (error) {
        if (!(error instanceof SessionError)) throw error
        return context.json(
          failure(
            currentRequestId(context),
            'unauthenticated',
            '用户名或密码错误。',
          ),
          200,
        )
      }
    },
    restore: async (context) => {
      try {
        const principal = await service.authenticate(
          getCookie(context, config.sessionCookieName),
          undefined,
          false,
        )
        return context.json(
          {
            code: 0 as const,
            errorKey: '' as const,
            message: 'ok' as const,
            data: sessionPayload(principal),
            requestId: currentRequestId(context),
          },
          200,
        )
      } catch (error) {
        return context.json(
          sessionFailure(error, currentRequestId(context)),
          200,
        )
      }
    },
    queryUsers: async (context) => {
      try {
        const principal = await service.authenticate(
          getCookie(context, config.sessionCookieName),
          context.req.header('X-CSRF-Token'),
          true,
        )
        if (!principal.permissions.includes('/app/user/query')) {
          throw new SessionError('forbidden')
        }
        return context.json(
          {
            code: 0 as const,
            errorKey: '' as const,
            message: 'ok' as const,
            data: await service.queryUsers(context.req.valid('json')),
            requestId: currentRequestId(context),
          },
          200,
        )
      } catch (error) {
        return context.json(
          sessionFailure(error, currentRequestId(context)),
          200,
        )
      }
    },
  })
}
