import type { OpenAPIHono } from '@hono/zod-openapi'
import { getCookie, setCookie } from 'hono/cookie'

import type { TargetConfig } from '../platform/config.ts'
import { currentRequestId } from '../platform/request-id.ts'
import type { AuxService } from '../aux/service.ts'
import type { BobService } from '../bob/service.ts'
import {
  WarehouseApplicationError,
  type WarehouseService,
} from '../dcl/warehouse.ts'
import {
  registerTargetRoutes,
  targetRouteMetadata,
  type TargetRouteEnvironment,
} from './contract.ts'
import { createIndependentHandlers } from './independent-routes.ts'
import type { ManagementService } from './management.ts'
import { applicationFailure } from './response.ts'
import {
  AppServiceError,
  SessionError,
  type Principal,
  type SessionService,
} from './session.ts'

export { targetRouteMetadata }

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
  if (!(error instanceof AppServiceError)) throw error
  return applicationFailure(requestId, error, null)
}

function warehouseFailure(requestId: string, error: WarehouseApplicationError) {
  const code: 1002 | 3001 = error.errorKey === 'forbidden' ? 1002 : 3001
  return {
    code,
    errorKey: error.errorKey,
    message: error.errorKey,
    data: error.data,
    requestId,
  }
}

export function registerAppRoutes(
  app: OpenAPIHono<TargetRouteEnvironment>,
  service: SessionService,
  config: TargetConfig,
  warehouse?: WarehouseService,
  management?: ManagementService,
  aux?: AuxService,
  bob?: BobService,
) {
  async function executeWarehouse<T>(
    context: {
      req: { header(name: string): string | undefined; path: string }
    },
    token: string | undefined,
    requestId: string,
    operation: (actor: { id: string; permissions: string[] }) => Promise<T>,
  ) {
    try {
      if (!warehouse) throw new Error('Warehouse service is unavailable')
      const current = await service.authenticate(
        token,
        context.req.header('X-CSRF-Token'),
        true,
        context.req.path,
      )
      return {
        code: 0 as const,
        errorKey: '' as const,
        message: 'ok' as const,
        data: await operation({
          id: current.user.id,
          permissions: current.permissions,
        }),
        requestId,
      }
    } catch (error) {
      if (error instanceof SessionError) return sessionFailure(error, requestId)
      if (error instanceof WarehouseApplicationError)
        return warehouseFailure(requestId, error)
      throw error
    }
  }
  return registerTargetRoutes(app, {
    independent: createIndependentHandlers({
      session: service,
      config,
      management,
      aux,
      bob,
    }),
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
        if (!(error instanceof AppServiceError)) throw error
        return context.json(
          sessionFailure(error, currentRequestId(context)),
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
        if (!management)
          throw new Error('APP management service is unavailable')
        const principal = await service.authenticate(
          getCookie(context, config.sessionCookieName),
          context.req.header('X-CSRF-Token'),
          true,
          '/app/user/query',
        )
        if (!principal.permissions.includes('/app/user/query')) {
          throw new SessionError('forbidden')
        }
        return context.json(
          {
            code: 0 as const,
            errorKey: '' as const,
            message: 'ok' as const,
            data: await management.queryUsers(
              context.req.valid('json'),
              principal,
            ),
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
    warehouseQuery: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          async (actor) => {
            const items = await warehouse!.query(actor)
            return { items, total: items.length }
          },
        ),
        200,
      ),
    warehouseGet: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) => warehouse!.get(context.req.valid('json').subjectId, actor),
        ),
        200,
      ),
    warehouseVersions: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          async (actor) => {
            const items = await warehouse!.versions(
              context.req.valid('json').subjectId,
              actor,
            )
            return { items, total: items.length }
          },
        ),
        200,
      ),
    warehouseAudit: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.auditHistory(context.req.valid('json').subjectId, actor),
        ),
        200,
      ),
    warehouseManagerReference: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.managerReference(
              context.req.valid('json').employeeId,
              context.req.valid('json').action,
              actor,
            ),
        ),
        200,
      ),
    warehouseSubmitNew: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.submit(
              'submit-new',
              context.req.valid('json'),
              actor,
              currentRequestId(context),
            ),
        ),
        200,
      ),
    warehouseSubmitChange: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.submit(
              'submit-change',
              context.req.valid('json'),
              actor,
              currentRequestId(context),
            ),
        ),
        200,
      ),
    warehouseApprove: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.review(
              'approve',
              context.req.valid('json'),
              actor,
              currentRequestId(context),
            ),
        ),
        200,
      ),
    warehouseReject: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.review(
              'reject',
              context.req.valid('json'),
              actor,
              currentRequestId(context),
            ),
        ),
        200,
      ),
    warehouseUnreject: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.review(
              'unreject',
              context.req.valid('json'),
              actor,
              currentRequestId(context),
            ),
        ),
        200,
      ),
    warehouseUnapprove: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.review(
              'unapprove',
              context.req.valid('json'),
              actor,
              currentRequestId(context),
            ),
        ),
        200,
      ),
    warehouseDelete: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.delete(
              context.req.valid('json'),
              actor,
              currentRequestId(context),
            ),
        ),
        200,
      ),
    warehouseReference: async (context) =>
      context.json(
        await executeWarehouse(
          context,
          getCookie(context, config.sessionCookieName),
          currentRequestId(context),
          (actor) =>
            warehouse!.reference(context.req.valid('json').search, actor),
        ),
        200,
      ),
  })
}
