import type { Kysely, Transaction } from 'kysely'

import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import type { DB } from '../db/generated.ts'

export interface TargetE2EPrincipal {
  userId: string
  roleId: string
  username: string
  passwordHash: string
}

/**
 * Application service for the disposable target database. Operational scripts
 * call this boundary instead of writing APP business tables themselves.
 */
export class TargetBootstrapService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async replacePermissionCatalog(
    catalog: readonly TargetPermissionCatalogEntry[],
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await transaction.deleteFrom('app_role_permissions').execute()
      await transaction.deleteFrom('app_permissions').execute()
      if (catalog.length === 0) return
      await transaction
        .insertInto('app_permissions')
        .values(
          catalog.map((entry) => ({
            id: entry.id,
            path: entry.path,
            domain: entry.domain,
            entity: entry.entity,
            action: entry.action,
            description: entry.title,
            status: 'ENABLED',
            menu_order: entry.order,
          })),
        )
        .execute()
    })
  }

  async createE2EPrincipal(principal: TargetE2EPrincipal): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const permission = await transaction
        .selectFrom('app_permissions')
        .select('id')
        .where('path', '=', '/app/user/query')
        .executeTakeFirst()
      if (!permission)
        throw new Error(
          'target catalog must contain /app/user/query before E2E',
        )
      await transaction
        .insertInto('app_users')
        .values({
          id: principal.userId,
          username: principal.username,
          display_name: 'Target E2E User',
          password_hash: principal.passwordHash,
          status: 'ENABLED',
          password_changed_at: new Date(),
        })
        .execute()
      await transaction
        .insertInto('app_roles')
        .values({
          id: principal.roleId,
          code: principal.username,
          name: 'Target E2E Role',
          status: 'ENABLED',
        })
        .execute()
      await transaction
        .insertInto('app_role_permissions')
        .values({ role_id: principal.roleId, permission_id: permission.id })
        .execute()
      await transaction
        .insertInto('app_user_roles')
        .values({ user_id: principal.userId, role_id: principal.roleId })
        .execute()
    })
  }

  async deleteE2EPrincipal(
    principal: Pick<TargetE2EPrincipal, 'userId' | 'roleId'>,
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await this.deleteFixtureRelations(transaction, principal)
      await transaction
        .deleteFrom('app_roles')
        .where('id', '=', principal.roleId)
        .execute()
      await transaction
        .deleteFrom('app_users')
        .where('id', '=', principal.userId)
        .execute()
    })
  }

  private async deleteFixtureRelations(
    transaction: Transaction<DB>,
    principal: Pick<TargetE2EPrincipal, 'userId' | 'roleId'>,
  ): Promise<void> {
    await transaction
      .deleteFrom('app_sessions')
      .where('user_id', '=', principal.userId)
      .execute()
    await transaction
      .deleteFrom('app_user_roles')
      .where('user_id', '=', principal.userId)
      .execute()
    await transaction
      .deleteFrom('app_role_permissions')
      .where('role_id', '=', principal.roleId)
      .execute()
  }
}
