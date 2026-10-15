import { sql, type Kysely } from 'kysely'
import {
  servicePermissionContexts,
  mergeServiceContexts,
  type ServiceContext,
  type ServiceContexts,
} from '@zerp/model'
import type { DB } from '../db/generated.ts'

/** Each action keeps its own current service contexts; other actions never widen it. */
export async function serviceAccess(
  db: Kysely<DB>,
  actor: { id: string; trusted?: boolean },
  includeDisabledUser = false,
): Promise<ServiceContexts> {
  const result = await sql<{
    path: string
    service_contexts: ServiceContext[]
    unrestricted: boolean
  }>`
    WITH current_roles AS (
      SELECT role.id, role.code FROM app_users user_record
      JOIN app_user_roles membership ON membership.user_id = user_record.id
      JOIN app_roles role ON role.id = membership.role_id AND role.status = 'ENABLED'
      WHERE user_record.id = ${actor.id} AND (${includeDisabledUser} OR user_record.status = 'ENABLED')
    )
    SELECT permission.path, ARRAY[]::text[] AS service_contexts, true AS unrestricted
    FROM app_permissions permission WHERE permission.status = 'ENABLED'
      AND (permission.domain = 'vou' AND permission.entity IN ('service-contract','service-acceptance')
        OR permission.path IN ('/wfl/process-instance/create-service-contract','/wfl/process-instance/create-service-acceptance'))
      AND (${actor.trusted === true} OR EXISTS (SELECT 1 FROM current_roles WHERE code = 'superadmin'))
    UNION ALL
    SELECT permission.path, grant_record.service_contexts, false AS unrestricted
    FROM current_roles role JOIN app_role_permissions grant_record ON grant_record.role_id = role.id
    JOIN app_permissions permission ON permission.id = grant_record.permission_id AND permission.status = 'ENABLED'
    WHERE permission.domain = 'vou' AND permission.entity IN ('service-contract','service-acceptance')
      OR permission.path IN ('/wfl/process-instance/create-service-contract','/wfl/process-instance/create-service-acceptance')
    ORDER BY path
  `.execute(db)
  const byPath = new Map<string, ServiceContext[][]>()
  for (const row of result.rows) {
    const allowed = servicePermissionContexts(row.path)
    if (
      !allowed.length ||
      (!row.unrestricted &&
        (!row.service_contexts.length ||
          row.service_contexts.some((context) => !allowed.includes(context))))
    )
      throw new Error('stored service grant differs from its action contexts')
    const entries = byPath.get(row.path) ?? []
    entries.push(row.unrestricted ? [...allowed] : row.service_contexts)
    byPath.set(row.path, entries)
  }
  return Object.fromEntries(
    [...byPath].map(([path, contexts]) => [
      path,
      mergeServiceContexts(contexts),
    ]),
  )
}
