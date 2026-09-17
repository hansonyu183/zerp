import { sql, type Kysely, type RawBuilder } from 'kysely'
import type { CustomerScope } from '@zerp/model'
import type { DB } from '../db/generated.ts'
import { SessionError } from './session.ts'

export type CustomerAccessActor = { id: string; trusted?: boolean }
export type CustomerAccess = { scope: CustomerScope; employeeId: string | null }

/** Always read current authorization, including when called inside a write transaction. */
export async function customerAccess(
  db: Kysely<DB>,
  actor: CustomerAccessActor,
): Promise<CustomerAccess> {
  if (actor.trusted) return { scope: 'ALL', employeeId: null }
  const user = await db
    .selectFrom('app_users')
    .select(['employee_id', 'status'])
    .where('id', '=', actor.id)
    .executeTakeFirst()
  if (!user || user.status !== 'ENABLED')
    return { scope: 'NONE', employeeId: null }
  const roles = await db
    .selectFrom('app_user_roles as ur')
    .innerJoin('app_roles as r', 'r.id', 'ur.role_id')
    .select(['r.code', 'r.customer_scope'])
    .where('ur.user_id', '=', actor.id)
    .where('r.status', '=', 'ENABLED')
    .execute()
  const scope: CustomerScope = roles.some(
    (role) => role.code === 'superadmin' || role.customer_scope === 'ALL',
  )
    ? 'ALL'
    : roles.some((role) => role.customer_scope === 'OWN')
      ? 'OWN'
      : 'NONE'
  return { scope, employeeId: user.employee_id }
}

/** Uses current approved ownership, independent of saved transaction snapshots or enablement. */
export function customerPredicate(
  access: CustomerAccess,
  customerId: RawBuilder<unknown>,
): RawBuilder<boolean> {
  if (access.scope === 'ALL') return sql<boolean>`true`
  if (access.scope === 'NONE' || !access.employeeId) return sql<boolean>`false`
  return sql<boolean>`EXISTS (
    SELECT 1 FROM dcl_customer_versions scope_customer
    WHERE scope_customer.approval_entry_id = (
      SELECT scope_entry.id FROM approval_entries scope_entry
      WHERE scope_entry.domain = 'dcl' AND scope_entry.entity = 'customer'
        AND scope_entry.subject_id = ${customerId} AND scope_entry.status = 'APPROVED'
      ORDER BY scope_entry.version_no DESC LIMIT 1
    ) AND scope_customer.primary_sales_attribution_type = 'INTERNAL_EMPLOYEE'
      AND scope_customer.primary_sales_attribution_object_id = ${access.employeeId}
  )`
}

export async function assertCustomerAccess(
  db: Kysely<DB>,
  actor: CustomerAccessActor,
  customerId: string,
): Promise<void> {
  const access = await customerAccess(db, actor)
  const result = await sql<{
    allowed: boolean
  }>`SELECT ${customerPredicate(access, sql`${customerId}`)} AS allowed`.execute(
    db,
  )
  if (!result.rows[0]?.allowed) throw new SessionError('forbidden')
}
