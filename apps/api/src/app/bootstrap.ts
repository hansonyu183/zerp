import type { Kysely, Transaction } from 'kysely'

import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import type { DB } from '../db/generated.ts'

export interface TargetE2EPrincipal {
  userId: string
  roleId: string
  username: string
  passwordHash: string
}

export interface TargetE2EManagerReference {
  employeeId: string
  latestApprovedEntryId: string
  code: string
  name: string
  enabled: boolean
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
      const permissions = await transaction
        .selectFrom('app_permissions')
        .select('id')
        .execute()
      if (permissions.length === 0)
        throw new Error('target catalog must contain permissions before E2E')
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
        .values(
          permissions.map((permission) => ({
            role_id: principal.roleId,
            permission_id: permission.id,
          })),
        )
        .execute()
      await transaction
        .insertInto('app_user_roles')
        .values({ user_id: principal.userId, role_id: principal.roleId })
        .execute()
    })
  }

  async createE2EManagerReference(
    reference: TargetE2EManagerReference,
  ): Promise<void> {
    await this.db
      .insertInto('dcl_warehouse_manager_reference_facts')
      .values({
        employee_id: reference.employeeId,
        latest_approved_entry_id: reference.latestApprovedEntryId,
        code: reference.code,
        name: reference.name,
        enabled: reference.enabled,
      })
      .execute()
  }

  async deleteE2EManagerReference(employeeId: string): Promise<void> {
    await this.db
      .deleteFrom('dcl_warehouse_manager_reference_facts')
      .where('employee_id', '=', employeeId)
      .execute()
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

  async deleteE2EWarehouseFixtures(createdByUserId: string): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const subjects = await transaction
        .selectFrom('dcl_subjects')
        .select('id')
        .where('created_by', '=', createdByUserId)
        .execute()
      const subjectIds = subjects.map((subject) => subject.id)
      if (subjectIds.length === 0) return
      await transaction
        .deleteFrom('dcl_warehouse_reference_facts')
        .where('warehouse_id', 'in', subjectIds)
        .execute()
      await transaction
        .deleteFrom('dcl_warehouse_usage_facts')
        .where('warehouse_id', 'in', subjectIds)
        .execute()
      await transaction
        .deleteFrom('dcl_warehouse_idempotency')
        .where('subject_id', 'in', subjectIds)
        .execute()
      await transaction
        .deleteFrom('approval_events')
        .where('subject_id', 'in', subjectIds)
        .execute()
      await transaction
        .deleteFrom('dcl_subjects')
        .where('id', 'in', subjectIds)
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
