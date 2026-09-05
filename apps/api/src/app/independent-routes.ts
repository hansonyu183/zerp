import { getCookie } from 'hono/cookie'
import type { Context } from 'hono'

import type { TargetConfig } from '../platform/config.ts'
import { currentRequestId } from '../platform/request-id.ts'
import {
  AuxApplicationError,
  type AuxEntity,
  type AuxQueryInput,
  type AuxReferenceQueryInput,
  type AuxService,
} from '../aux/service.ts'
import {
  BobApplicationError,
  type BobEntity,
  type BobQueryInput,
  type BobReferenceQueryInput,
  type BobService,
} from '../bob/service.ts'
import type { IndependentRouteHandlers } from './independent-contract.ts'
import type { TargetRouteEnvironment } from './contract.ts'
import type { ManagementService, PageInput } from './management.ts'
import {
  applicationFailure,
  clearSessionCookie,
  clearUnauthenticatedSessionCookie,
} from './response.ts'
import {
  AppServiceError,
  type Principal,
  type SessionService,
} from './session.ts'

type JsonInput = Record<string, unknown>

export interface IndependentServices {
  session: SessionService
  config: TargetConfig
  management?: ManagementService
  aux?: AuxService
  bob?: BobService
}

function success(requestId: string, data: unknown) {
  return {
    code: 0 as const,
    errorKey: '' as const,
    message: 'ok' as const,
    data,
    requestId,
  }
}

function independentFailure(requestId: string, error: unknown) {
  if (
    !(error instanceof AppServiceError) &&
    !(error instanceof AuxApplicationError) &&
    !(error instanceof BobApplicationError)
  )
    throw error
  return applicationFailure(
    requestId,
    error,
    error instanceof AuxApplicationError ? error.data : null,
  )
}

function required<Service>(
  service: Service | undefined,
  name: string,
): Service {
  if (!service) throw new Error(`${name} service is unavailable`)
  return service
}

function asInput(value: unknown): JsonInput {
  return value as JsonInput
}

function text(input: JsonInput, key: string): string {
  return input[key] as string
}

function integer(input: JsonInput, key: string): number {
  return input[key] as number
}

function strings(input: JsonInput, key: string): string[] {
  return input[key] as string[]
}

function pageInput(input: JsonInput): PageInput {
  return input as unknown as PageInput
}

export function createIndependentHandlers(
  services: IndependentServices,
): IndependentRouteHandlers {
  async function authenticate(
    context: Context<TargetRouteEnvironment>,
    path: string,
  ): Promise<Principal> {
    return services.session.authenticate(
      getCookie(context, services.config.sessionCookieName),
      context.req.header('X-CSRF-Token'),
      true,
      path,
    )
  }

  return {
    app: async (context) => {
      const requestId = currentRequestId(context)
      const path = context.req.path
      const input = asInput(await context.req.json())
      try {
        const management = required(services.management, 'APP management')
        if (path === '/app/branding/get')
          return context.json(
            success(requestId, await management.getBranding()),
            200,
          )

        const principal = await authenticate(context, path)
        let data: unknown
        switch (path) {
          case '/app/user/signout':
            await services.session.signout(principal, requestId)
            clearSessionCookie(context, services.config)
            data = {}
            break
          case '/app/user/profile':
            data =
              Object.keys(input).length === 0
                ? await services.session.getProfile(principal)
                : await services.session.saveProfile(
                    principal,
                    {
                      displayName: text(input, 'displayName'),
                      avatarUrl: input.avatarUrl as string | null | undefined,
                    },
                    requestId,
                  )
            break
          case '/app/user/change-password':
            await services.session.changePassword(
              principal,
              {
                currentPassword: text(input, 'currentPassword'),
                newPassword: text(input, 'newPassword'),
              },
              requestId,
            )
            clearSessionCookie(context, services.config)
            data = {}
            break
          case '/app/user/get':
            data = await management.getUser(text(input, 'id'), principal)
            break
          case '/app/user/create':
            data = await management.createUser(
              {
                username: text(input, 'username'),
                displayName: text(input, 'displayName'),
                password: text(input, 'password'),
                roleIds: strings(input, 'roleIds'),
              },
              principal,
              requestId,
            )
            break
          case '/app/user/save':
            data = await management.saveUser(
              {
                id: text(input, 'id'),
                displayName: text(input, 'displayName'),
                roleIds: strings(input, 'roleIds'),
                revision: integer(input, 'revision'),
              },
              principal,
              requestId,
            )
            break
          case '/app/user/enable':
          case '/app/user/disable':
            data = await management.setUserStatus(
              { id: text(input, 'id'), revision: integer(input, 'revision') },
              path.endsWith('/enable') ? 'ENABLED' : 'DISABLED',
              principal,
              requestId,
            )
            break
          case '/app/user/reset-password':
            data = await management.resetUserPassword(
              { id: text(input, 'id'), revision: integer(input, 'revision') },
              principal,
              requestId,
            )
            break
          case '/app/role/query':
            data = await management.queryRoles(pageInput(input), principal)
            break
          case '/app/role/get':
            data = await management.getRole(text(input, 'id'), principal)
            break
          case '/app/role/create':
            data = await management.createRole(
              {
                name: text(input, 'name'),
                description: input.description as string | null,
                permissionIds: strings(input, 'permissionIds'),
              },
              principal,
              requestId,
            )
            break
          case '/app/role/save':
            data = await management.saveRole(
              {
                id: text(input, 'id'),
                name: text(input, 'name'),
                description: input.description as string | null,
                permissionIds: strings(input, 'permissionIds'),
                revision: integer(input, 'revision'),
              },
              principal,
              requestId,
            )
            break
          case '/app/role/enable':
          case '/app/role/disable':
            data = await management.setRoleStatus(
              { id: text(input, 'id'), revision: integer(input, 'revision') },
              path.endsWith('/enable') ? 'ENABLED' : 'DISABLED',
              principal,
              requestId,
            )
            break
          case '/app/permission/query':
            data = await management.queryPermissions(
              pageInput(input),
              principal,
            )
            break
          case '/app/permission/get':
            data = await management.getPermission(text(input, 'id'), principal)
            break
          case '/app/system-parameter/query':
            data = await management.querySystemParameters(
              pageInput(input),
              principal,
            )
            break
          case '/app/system-parameter/get':
            data = await management.getSystemParameter(
              text(input, 'key'),
              principal,
            )
            break
          case '/app/system-parameter/save':
            data = await management.saveSystemParameter(
              {
                parameterKey: text(input, 'key'),
                configuredValue: text(input, 'configuredValue'),
                revision: integer(input, 'revision'),
              },
              principal,
              requestId,
            )
            break
          case '/app/system-parameter/reset':
            data = await management.resetSystemParameter(
              {
                parameterKey: text(input, 'key'),
                revision: integer(input, 'revision'),
              },
              principal,
              requestId,
            )
            break
          case '/app/menu/get':
            data = await management.getMenu(principal)
            break
          case '/app/menu/save-business':
            data = await management.saveBusinessMenu(
              {
                revision: integer(input, 'revision'),
                items: input.items as Array<Record<string, unknown>>,
              },
              principal,
              requestId,
            )
            break
          case '/app/menu/activate':
            data = await management.activateMenu(
              {
                mode: input.mode as 'DEFAULT' | 'BUSINESS',
                revision: integer(input, 'revision'),
              },
              principal,
              requestId,
            )
            break
          case '/app/menu/reset-business':
            data = await management.resetBusinessMenu(
              { revision: integer(input, 'revision') },
              principal,
              requestId,
            )
            break
          default:
            throw new Error(`unsupported APP route ${path}`)
        }
        return context.json(success(requestId, data), 200)
      } catch (error) {
        clearUnauthenticatedSessionCookie(context, services.config, error)
        return context.json(independentFailure(requestId, error), 200)
      }
    },

    aux: (binding) => async (context) => {
      const requestId = currentRequestId(context)
      const input = asInput(await context.req.json())
      try {
        const service = required(services.aux, 'AUX')
        const principal = await authenticate(context, binding.permission)
        const actor = {
          id: principal.user.id,
          permissions: principal.permissions,
        }
        if (!('entity' in binding))
          return context.json(
            success(
              requestId,
              await service.queryReferenceCandidates(
                input as unknown as AuxReferenceQueryInput,
                actor,
              ),
            ),
            200,
          )
        const entity: AuxEntity = binding.entity
        let data: unknown
        if (binding.action === 'query')
          data = await service.query(
            entity,
            input as unknown as AuxQueryInput,
            actor,
          )
        else if (binding.action === 'get')
          data = await service.get(entity, text(input, 'objectId'), actor)
        else if (binding.action === 'create')
          data = await service.create(entity, input.data, actor)
        else if (binding.action === 'save')
          data = await service.save(
            entity,
            text(input, 'objectId'),
            integer(input, 'objectRevision'),
            input.data,
            actor,
          )
        else if (binding.action === 'enable' || binding.action === 'disable')
          data = await service[binding.action](
            entity,
            text(input, 'objectId'),
            integer(input, 'objectRevision'),
            actor,
          )
        else {
          await service.delete(
            entity,
            text(input, 'objectId'),
            integer(input, 'objectRevision'),
            actor,
          )
          data = { deleted: true }
        }
        return context.json(success(requestId, data), 200)
      } catch (error) {
        return context.json(independentFailure(requestId, error), 200)
      }
    },

    bob: (binding) => async (context) => {
      const requestId = currentRequestId(context)
      const input = asInput(await context.req.json())
      try {
        const service = required(services.bob, 'BOB')
        const principal = await authenticate(context, binding.permission)
        const actor = {
          id: principal.user.id,
          permissions: principal.permissions,
        }
        const data =
          'entity' in binding
            ? binding.action === 'query'
              ? service.query(
                  binding.entity as BobEntity,
                  input as unknown as BobQueryInput,
                  actor,
                )
              : service.get(
                  binding.entity as BobEntity,
                  text(input, 'objectId'),
                  actor,
                )
            : service.queryReferenceCandidates(
                input as unknown as BobReferenceQueryInput,
                actor,
              )
        return context.json(success(requestId, await data), 200)
      } catch (error) {
        return context.json(independentFailure(requestId, error), 200)
      }
    },
  }
}
