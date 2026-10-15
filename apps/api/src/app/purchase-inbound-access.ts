import { sql, type Kysely } from 'kysely'
import {
  isPurchaseInboundPermission,
  mergePurchaseInboundScopes,
  type PurchaseInboundScope,
  type PurchaseInboundScopes,
} from '@zerp/model'
import type { DB } from '../db/generated.ts'

type Actor = { id: string; trusted?: boolean }

/** Resolve each action from current grants, including inside write transactions. */
export async function purchaseInboundAccess(
  db: Kysely<DB>,
  actor: Actor,
  includeDisabledUser = false,
): Promise<PurchaseInboundScopes> {
  const rows = await sql<{
    path: string
    scope: PurchaseInboundScope
  }>`WITH current_roles AS (
      SELECT r.id, r.code FROM app_users u
      JOIN app_user_roles ur ON ur.user_id = u.id
      JOIN app_roles r ON r.id = ur.role_id AND r.status = 'ENABLED'
      WHERE u.id = ${actor.id} AND (${includeDisabledUser} OR u.status = 'ENABLED')
    )
    SELECT p.path, 'ALL' AS scope FROM app_permissions p
    WHERE p.status = 'ENABLED' AND (p.domain = 'vou' AND p.entity = 'purchase-inbound' OR p.path = '/wfl/process-instance/create-purchase-inbound')
      AND (${actor.trusted === true} OR EXISTS (SELECT 1 FROM current_roles WHERE code = 'superadmin'))
    UNION ALL
    SELECT p.path, rp.purchase_inbound_scope AS scope
    FROM current_roles r
    JOIN app_role_permissions rp ON rp.role_id = r.id
    JOIN app_permissions p ON p.id = rp.permission_id AND p.status = 'ENABLED'
    WHERE (p.domain = 'vou' AND p.entity = 'purchase-inbound' OR p.path = '/wfl/process-instance/create-purchase-inbound')
    ORDER BY path`.execute(db)
  const byPath = new Map<string, PurchaseInboundScope[]>()
  for (const row of rows.rows) {
    if (!isPurchaseInboundPermission(row.path))
      throw new Error('purchase inbound permission path differs from resource')
    const scopes = byPath.get(row.path) ?? []
    scopes.push(row.scope)
    byPath.set(row.path, scopes)
  }
  return Object.fromEntries(
    [...byPath].map(([path, scopes]) => [
      path,
      mergePurchaseInboundScopes(scopes)!,
    ]),
  )
}
