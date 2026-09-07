import { getCookie } from 'hono/cookie'
import type { Context } from 'hono'

import type { TargetConfig } from '../platform/config.ts'
import { currentRequestId } from '../platform/request-id.ts'
import {
  AuxApplicationError,
  type AuxEntity,
  type AuxIdentifierInput,
  type AuxQueryInput,
  type AuxReferenceQueryInput,
  type AuxRevisionInput,
  type AuxSaveInput,
  type AuxService,
  type AuxWriteData,
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
        if (path === '/session/app/get')
          return context.json(
            success(requestId, await management.getBranding()),
            200,
          )

        const principal = await authenticate(context, path)
        let data: unknown
        switch (path) {
          case '/session/auth/signout':
            await services.session.signout(principal, requestId)
            clearSessionCookie(context, services.config)
            data = {}
            break
          case '/session/user/get':
            data = await services.session.getProfile(principal)
            break
          case '/session/user/save':
            data = await services.session.saveProfile(
              principal,
              {
                name: text(input, 'name'),
                avatarUrl: input.avatarUrl as string | null | undefined,
              },
              requestId,
            )
            break
          case '/session/user/change-password':
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
                code: text(input, 'code'),
                name: text(input, 'name'),
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
                name: text(input, 'name'),
                roleIds: strings(input, 'roleIds'),
                revision: text(input, 'revision'),
              },
              principal,
              requestId,
            )
            break
          case '/app/user/enable':
          case '/app/user/disable':
            data = await management.setUserStatus(
              { id: text(input, 'id'), revision: text(input, 'revision') },
              path.endsWith('/enable') ? 'ENABLED' : 'DISABLED',
              principal,
              requestId,
            )
            break
          case '/app/user/reset-password':
            data = await management.resetUserPassword(
              { id: text(input, 'id'), revision: text(input, 'revision') },
              principal,
              requestId,
            )
            break
          case '/app/role/query':
            data = await management.queryRoles(
              {
                keyword: typeof input.keyword === 'string' ? input.keyword : '',
                page: integer(input, 'page'),
                pageSize: 20,
              },
              principal,
            )
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
                revision: text(input, 'revision'),
              },
              principal,
              requestId,
            )
            break
          case '/app/role/enable':
          case '/app/role/disable':
            data = await management.setRoleStatus(
              { id: text(input, 'id'), revision: text(input, 'revision') },
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
          permissions: principal.apiPaths,
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
          data = await service.get(
            entity,
            input as unknown as AuxIdentifierInput,
            actor,
          )
        else if (binding.action === 'create')
          data = await service.create(
            entity,
            input as unknown as AuxWriteData<typeof entity>,
            actor,
            requestId,
          )
        else if (binding.action === 'save')
          data = await service.save(
            entity,
            input as unknown as AuxSaveInput<typeof entity>,
            actor,
            requestId,
          )
        else if (binding.action === 'enable' || binding.action === 'disable')
          data = await service[binding.action](
            entity,
            input as unknown as AuxRevisionInput,
            actor,
            requestId,
          )
        else {
          await service.delete(
            entity,
            input as unknown as AuxRevisionInput,
            actor,
            requestId,
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
          permissions: principal.apiPaths,
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
