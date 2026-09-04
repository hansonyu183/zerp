import type { OpenAPIHono } from '@hono/zod-openapi'
import { getCookie, setCookie } from 'hono/cookie'
import type { VouEntity } from '@zerp/model'

import type { TargetConfig } from '../platform/config.ts'
import { currentRequestId } from '../platform/request-id.ts'
import type { AuxService } from '../aux/service.ts'
import type { BobService } from '../bob/service.ts'
import {
  WarehouseApplicationError,
  type WarehouseService,
} from '../dcl/warehouse.ts'
import {
  ArchiveApplicationError,
  type ArchiveReviewInput,
  type ArchiveService,
  type ArchiveSubmitInput,
} from '../dcl/archives.ts'
import {
  archiveQuerySchemas,
  type ArchiveRouteHandler,
} from '../dcl/archive-contract.ts'
import {
  AccMappingCatalogError,
  type AccMappingCatalogService,
} from '../acc/mapping-catalog.ts'
import { VouApplicationError, type VouService } from '../vou/service.ts'
import {
  registerVouRoutes,
  vouRouteMetadata,
  type VouRouteAction,
} from '../vou/contract.ts'
import { AccApplicationError, type AccService } from '../acc/service.ts'
import { registerAccRoutes, accRouteMetadata, type AccRouteAction } from '../acc/contract.ts'
import { WflApplicationError, type WflService } from '../wfl/service.ts'
import { registerWflRoutes, wflRouteMetadata, type WflRouteAction } from '../wfl/contract.ts'
import { RptApplicationError, type RptService } from '../rpt/service.ts'
import { registerRptRoutes, rptRouteMetadata, type RptRouteAction } from '../rpt/contract.ts'
import { healthRouteMetadata } from './health-contract.ts'
import {
  registerTargetRoutes,
  targetRouteMetadata as baseTargetRouteMetadata,
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

export const targetRouteMetadata = [
  ...healthRouteMetadata,
  ...baseTargetRouteMetadata,
  ...vouRouteMetadata,
  ...accRouteMetadata,
  ...wflRouteMetadata,
  ...rptRouteMetadata,
]

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

function archiveFailure(requestId: string, error: ArchiveApplicationError) {
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
  archives?: ArchiveService,
  accMappingCatalog?: AccMappingCatalogService,
  management?: ManagementService,
  aux?: AuxService,
  bob?: BobService,
  vou?: VouService,
  acc?: AccService,
  wfl?: WflService,
  rpt?: RptService,
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
  async function executeArchive<T>(
    context: {
      req: { header(name: string): string | undefined; path: string }
    },
    requestId: string,
    operation: (actor: { id: string; permissions: string[] }) => Promise<T>,
  ) {
    try {
      if (!archives) throw new Error('DCL archive service is unavailable')
      const current = await service.authenticate(
        getCookie(
          context as Parameters<typeof getCookie>[0],
          config.sessionCookieName,
        ),
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
      if (error instanceof ArchiveApplicationError)
        return archiveFailure(requestId, error)
      throw error
    }
  }
  async function executeAccCatalog<T>(
    context: {
      req: { header(name: string): string | undefined; path: string }
    },
    requestId: string,
    operation: (actor: { permissions: string[] }) => Promise<T>,
  ) {
    try {
      if (!accMappingCatalog)
        throw new Error('ACC mapping catalog service is unavailable')
      const current = await service.authenticate(
        getCookie(
          context as Parameters<typeof getCookie>[0],
          config.sessionCookieName,
        ),
        context.req.header('X-CSRF-Token'),
        true,
        context.req.path,
      )
      return {
        code: 0 as const,
        errorKey: '' as const,
        message: 'ok' as const,
        data: await operation({ permissions: current.permissions }),
        requestId,
      }
    } catch (error) {
      if (error instanceof SessionError) return sessionFailure(error, requestId)
      if (error instanceof AccMappingCatalogError)
        return {
          code:
            error.errorKey === 'forbidden' ? (1002 as const) : (3001 as const),
          errorKey: error.errorKey,
          message: error.errorKey,
          data: null,
          requestId,
        }
      throw error
    }
  }
  async function executeVou<T>(
    context: any,
    operation: (actor: { id: string; permissions: string[] }) => Promise<T>,
  ) {
    const requestId = currentRequestId(context)
    try {
      if (!vou) throw new Error('VOU service is unavailable')
      const current = await service.authenticate(
        getCookie(context, config.sessionCookieName),
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
      if (error instanceof VouApplicationError)
        return {
          code: 3001 as const,
          errorKey: error.errorKey,
          message: error.errorKey,
          data: error.data,
          requestId,
        }
      if (
        error instanceof AccApplicationError ||
        error instanceof WflApplicationError ||
        error instanceof RptApplicationError
      )
        return {
          code: 3001 as const,
          errorKey: error.errorKey,
          message: error.errorKey,
          data: 'data' in error ? error.data : null,
          requestId,
        }
      throw error
    }
  }
  async function executeCore<T>(context: any, operation: (actor: { id: string; permissions: string[] }) => Promise<T>) {
    const requestId = currentRequestId(context)
    try {
      const current = await service.authenticate(getCookie(context, config.sessionCookieName), context.req.header('X-CSRF-Token'), true, context.req.path)
      return { code: 0 as const, errorKey: '' as const, message: 'ok' as const, data: await operation({ id: current.user.id, permissions: current.permissions }), requestId }
    } catch (error) {
      if (error instanceof SessionError) return sessionFailure(error, requestId)
      if (error instanceof AccApplicationError || error instanceof WflApplicationError || error instanceof RptApplicationError)
        return { code: 3001 as const, errorKey: error.errorKey, message: error.errorKey, data: 'data' in error ? error.data : null, requestId }
      throw error
    }
  }
  const archiveHandler: ArchiveRouteHandler = async (
    entity,
    action,
    context,
  ) => {
    const requestId = currentRequestId(context)
    const input = context.req.valid('json')
    const response = await executeArchive(context, requestId, async (actor) => {
      if (action === 'query') {
        return archives!.query(
          entity,
          archiveQuerySchemas[entity].parse(input),
          actor,
        )
      }
      if (action === 'get')
        return archives!.get(
          entity,
          (input as { subjectId: string }).subjectId,
          actor,
          entity === 'rpt-definition'
            ? (input as { approvalEntryId?: string }).approvalEntryId
            : undefined,
        )
      if (action === 'versions') {
        const items = await archives!.versions(
          entity,
          (input as { subjectId: string }).subjectId,
          actor,
        )
        return { items, total: items.length }
      }
      if (action === 'audit-history')
        return archives!.auditHistory(
          entity,
          (input as { subjectId: string }).subjectId,
          actor,
        )
      if (action === 'submit-new' || action === 'submit-change')
        return archives!.submit(
          entity,
          action,
          input as ArchiveSubmitInput,
          actor,
          requestId,
        )
      if (action === 'delete')
        return archives!.delete(
          entity,
          input as ArchiveReviewInput,
          actor,
          requestId,
        )
      return archives!.review(
        entity,
        action,
        input as ArchiveReviewInput,
        actor,
        requestId,
      )
    })
    return context.json(response as never, 200)
  }
  const target = registerTargetRoutes(app, {
    independent: createIndependentHandlers({
      session: service,
      config,
      management,
      aux,
      bob,
    }),
    archive: archiveHandler,
    archiveAttachments: {
      stage: async (context) =>
        context.json(
          (await executeArchive(context, currentRequestId(context), (actor) =>
            archives!.stageCustomerAttachment(context.req.valid('json'), actor),
          )) as never,
          200,
        ),
      cleanup: async (context) =>
        context.json(
          (await executeArchive(context, currentRequestId(context), (actor) =>
            archives!.cleanupCustomerAttachments(actor),
          )) as never,
          200,
        ),
    },
    accMappingQuery: async (context) =>
      context.json(
        (await executeAccCatalog(context, currentRequestId(context), (actor) =>
          accMappingCatalog!.query(context.req.valid('json'), actor),
        )) as never,
        200,
      ),
    accMappingGet: async (context) =>
      context.json(
        (await executeAccCatalog(context, currentRequestId(context), (actor) =>
          accMappingCatalog!.get(
            context.req.valid('json').bookId,
            context.req.valid('json').vouEntity,
            actor,
          ),
        )) as never,
        200,
      ),
    accMappingCatalog: async (context) =>
      context.json(
        (await executeAccCatalog(context, currentRequestId(context), (actor) =>
          accMappingCatalog!.catalog(actor),
        )) as never,
        200,
      ),
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
  const withVou = registerVouRoutes(
    target,
    async (action: VouRouteAction, context: any) => {
      if (action === 'reference') {
        const body = context.req.valid('json')
        const response = await executeVou<unknown>(context, (actor) =>
          vou!.queryReferenceCandidates(body, actor),
        )
        return context.json(response as never, 200)
      }
      const entity = context.req.valid('param').entity as VouEntity
      const body = context.req.valid('json')
      const response = await executeVou<unknown>(context, (actor) => {
        if (action === 'query') return vou!.query(entity, actor)
        if (action === 'get') return vou!.get(entity, body.documentId, actor)
        if (action === 'audit-history')
          return vou!.auditHistory(entity, body.documentId, actor)
        if (action === 'submit-new' || action === 'submit-change')
          return vou!.submit(
            entity,
            action,
            body,
            actor,
            currentRequestId(context),
          )
        if (action === 'attachment-stage')
          return vou!.stageAttachment(entity, body, actor)
        if (action === 'attachment-cleanup')
          return vou!.cleanupAttachments(entity, actor)
        if (action === 'delete')
          return vou!.delete(entity, body, actor, currentRequestId(context))
        return vou!.review(
          entity,
          action,
          body,
          actor,
          currentRequestId(context),
        )
      })
      return context.json(response as never, 200)
    },
  )
  const withAcc = registerAccRoutes(withVou, async (action: AccRouteAction, context: any) => {
    if (!acc) throw new Error('ACC service is unavailable')
    const input = context.req.valid('json')
    const response = await executeCore<unknown>(context, (actor) => {
      if (action === 'bookQuery') return acc.queryBooks(actor)
      if (action === 'bookGet') return acc.getBook(input.id, actor)
      if (action === 'bookCreate') return acc.createBook(input, actor)
      if (action === 'bookSave') return acc.saveBook(input, actor)
      if (action === 'bookDelete') return acc.deleteBook(input.id, input.expectedRevision, actor)
      if (action === 'subjectQuery') return acc.querySubjects(input.bookId, actor)
      if (action === 'subjectGet') return acc.getSubject(input.id, actor)
      if (action === 'subjectCreate') return acc.createSubject(input, actor)
      if (action === 'subjectSave') return acc.saveSubject(input, actor)
      if (action === 'subjectDelete') return acc.deleteSubject(input.id, input.expectedRevision, actor)
      if (action === 'openingQuery') return acc.getOpening(input.bookId, actor)
      if (action === 'openingSubmit') return acc.submitOpening(input, actor, currentRequestId(context))
      if (action === 'openingDelete') return acc.deleteOpening(input, actor, currentRequestId(context))
      if (action === 'openingApprove') return acc.reviewOpening('approve', input, actor, currentRequestId(context))
      if (action === 'openingReject') return acc.reviewOpening('reject', input, actor, currentRequestId(context))
      if (action === 'openingUnreject') return acc.reviewOpening('unreject', input, actor, currentRequestId(context))
      if (action === 'openingUnapprove') return acc.reviewOpening('unapprove', input, actor, currentRequestId(context))
      if (action === 'periodQuery') return acc.queryPeriods(input.bookId, actor)
      return acc.setPeriod(input, action === 'periodLock', actor)
    })
    return context.json(response as never, 200)
  })
  const withWfl = registerWflRoutes(withAcc, async (action: WflRouteAction, context: any) => {
    if (!wfl) throw new Error('WFL service is unavailable')
    const input = context.req.valid('json')
    const response = await executeCore<unknown>(context, (actor) => {
      if (action === 'submitNew' || action === 'submitChange') return wfl.submit(action === 'submitNew' ? 'submit-new' : 'submit-change', input, actor, currentRequestId(context))
      if (action === 'approve') return wfl.review('approve', input, actor, currentRequestId(context))
      if (action === 'reject') return wfl.review('reject', input, actor, currentRequestId(context))
      if (action === 'unreject') return wfl.review('unreject', input, actor, currentRequestId(context))
      if (action === 'unapprove') return wfl.review('unapprove', input, actor, currentRequestId(context))
      if (action === 'query') return wfl.query(actor)
      if (action === 'get') return wfl.get(input.subjectId, actor, input.approvalEntryId)
      if (action === 'versions') return wfl.versions(input.subjectId, actor)
      if (action === 'auditHistory') return wfl.auditHistory(input.subjectId, actor)
      if (action === 'delete') return wfl.delete(input, actor, currentRequestId(context))
      if (action === 'enable' || action === 'disable') return wfl.setEnabled(input, action === 'enable', actor)
      if (action === 'currentQuery') return wfl.queryCurrentDefinitions(input, actor)
      if (action === 'current') return wfl.current(input.code, actor)
      if (action === 'trial') return wfl.trial(input, actor)
      if (action === 'instanceQuery') return wfl.queryInstances(input, actor)
      if (action === 'instanceGet') return wfl.getInstance(input.processId, actor)
      if (action === 'instanceAuditHistory') return wfl.instanceAuditHistory(input.processId, actor)
      return wfl.executeNodeAction(input, actor, currentRequestId(context))
    })
    return context.json(response as never, 200)
  })
  return registerRptRoutes(withWfl, async (action: RptRouteAction, context: any) => {
    if (!rpt) throw new Error('RPT service is unavailable')
    const input = context.req.valid('json')
    const response = await executeCore<unknown>(context, (actor) => {
      if (action === 'directory') return rpt.directory(actor)
      const code = context.req.valid('param').code
      if (action === 'query') return rpt.query(code, input, actor, currentRequestId(context))
      if (action === 'referenceQuery') return rpt.referenceQuery(code, input, actor)
      return rpt.export(code, input.parameters, actor, currentRequestId(context))
    })
    return context.json(response as never, 200)
  })
}
