import { sql, type Kysely } from 'kysely'
import type { DB } from '../db/generated.ts'

/** One-time additive upgrade of the verified administrator-only deployment. */
export async function upgradeDepartmentAccess(
  db: Kysely<DB>,
): Promise<'created' | 'unchanged'> {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(74155000)`.execute(tx)
    const columns = await sql<{ table_name: string; column_name: string }>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (
        (table_name = 'app_users' AND column_name = 'employee_id') OR
        (table_name = 'app_roles' AND column_name = 'customer_scope') OR
        (table_name = 'vou_attachment_download_tokens' AND column_name = 'owner_user_id') OR
        (table_name = 'app_seed_runs' AND column_name = 'key'))`.execute(tx)
    if (columns.rows.length === 4) return 'unchanged'
    if (columns.rows.length !== 0)
      throw new Error(
        'department upgrade requires a complete old or current schema',
      )
    await sql`LOCK TABLE app_roles, app_users, app_user_roles, vou_attachment_download_tokens IN ACCESS EXCLUSIVE MODE`.execute(
      tx,
    )
    const otherRoles = await tx
      .selectFrom('app_roles')
      .select('id')
      .where('code', '!=', 'superadmin')
      .execute()
    if (otherRoles.length)
      throw new Error(
        'department upgrade requires reviewed administrator-only role baseline',
      )
    await sql`ALTER TABLE app_users ADD COLUMN employee_id varchar(26), ADD CONSTRAINT app_users_employee_fk FOREIGN KEY (employee_id) REFERENCES aux_objects(id)`.execute(
      tx,
    )
    await sql`ALTER TABLE app_roles ADD COLUMN customer_scope varchar(8) NOT NULL DEFAULT 'NONE' CHECK (customer_scope IN ('NONE', 'OWN', 'ALL'))`.execute(
      tx,
    )
    await sql`CREATE TABLE app_seed_runs (key varchar(64) PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now())`.execute(
      tx,
    )
    // Existing short-lived bearer links have no owner and must be reissued.
    await sql`DELETE FROM vou_attachment_download_tokens`.execute(tx)
    await sql`ALTER TABLE vou_attachment_download_tokens ADD COLUMN owner_user_id varchar(26) NOT NULL REFERENCES app_users(id)`.execute(
      tx,
    )
    return 'created'
  })
}
