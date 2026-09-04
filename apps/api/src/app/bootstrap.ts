import type { Kysely, Transaction } from 'kysely'

import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import type { DB, JsonValue } from '../db/generated.ts'

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

export interface TargetE2EArchiveFacts {
  createdBy: string
  auxObjects: readonly {
    id: string
    entity:
      | 'dictionary-item'
      | 'product-type'
      | 'product-category'
      | 'measurement-unit'
      | 'employee-category'
      | 'department'
      | 'position'
    code: string
    data: JsonValue
  }[]
  accounting: {
    book: { id: string; code: string; name: string }
    vouEntity: {
      id: string
      code: string
      name: string
      fieldCatalog: { headerFields: string[]; lineFields: string[] }
    }
    subjects: readonly {
      id: string
      code: string
      name: string
      leaf: boolean
      requiredDimensions: string[]
    }[]
  }
}

export interface PermissionCatalogMigrationReport {
  preservedRoleGrants: number
  droppedStaleRoleGrants: number
  orphanedRoleGrants: number
  duplicateRoleGrants: number
}

interface EffectiveAuthoritySnapshot {
  roles: Map<string, { wildcard: boolean; paths: string[] }>
  users: Map<string, { wildcard: boolean; paths: string[] }>
}

async function effectiveAuthoritySnapshot(
  database: Kysely<DB> | Transaction<DB>,
  targetPaths: ReadonlySet<string>,
): Promise<EffectiveAuthoritySnapshot> {
  const [permissions, roles, grants, users, userRoles] = await Promise.all([
    database
      .selectFrom('app_permissions')
      .select(['id', 'path', 'status'])
      .execute(),
    database.selectFrom('app_roles').select(['id', 'code', 'status']).execute(),
    database
      .selectFrom('app_role_permissions')
      .select(['role_id', 'permission_id'])
      .execute(),
    database.selectFrom('app_users').select(['id', 'status']).execute(),
    database
      .selectFrom('app_user_roles')
      .select(['user_id', 'role_id'])
      .execute(),
  ])
  const permissionById = new Map(
    permissions.map((permission) => [permission.id, permission]),
  )
  const roleAuthorities = new Map(
    roles.map((role) => {
      const wildcard = role.status === 'ENABLED' && role.code === 'superadmin'
      const paths =
        role.status !== 'ENABLED' || wildcard
          ? []
          : grants
              .filter((grant) => grant.role_id === role.id)
              .flatMap((grant) => {
                const permission = permissionById.get(grant.permission_id)
                return permission?.status === 'ENABLED' &&
                  targetPaths.has(permission.path)
                  ? [permission.path]
                  : []
              })
      return [role.id, { wildcard, paths: [...new Set(paths)].sort() }] as const
    }),
  )
  return {
    roles: roleAuthorities,
    users: new Map(
      users.map((user) => [
        user.id,
        (() => {
          if (user.status !== 'ENABLED') return { wildcard: false, paths: [] }
          const authorities = userRoles
            .filter((assignment) => assignment.user_id === user.id)
            .flatMap((assignment) => {
              const authority = roleAuthorities.get(assignment.role_id)
              return authority ? [authority] : []
            })
          const wildcard = authorities.some((authority) => authority.wildcard)
          return {
            wildcard,
            paths: wildcard
              ? []
              : [
                  ...new Set(
                    authorities.flatMap((authority) => authority.paths),
                  ),
                ].sort(),
          }
        })(),
      ]),
    ),
  }
}

function assertAuthorityPreserved(
  before: EffectiveAuthoritySnapshot,
  after: EffectiveAuthoritySnapshot,
) {
  for (const kind of ['roles', 'users'] as const) {
    for (const [id, paths] of before[kind]) {
      if (
        JSON.stringify(paths) !==
        JSON.stringify(after[kind].get(id) ?? { wildcard: false, paths: [] })
      )
        throw new Error(
          `permission catalog migration changed effective authority for ${kind.slice(0, -1)} ${id}`,
        )
    }
  }
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

  async migratePermissionCatalog(
    catalog: readonly TargetPermissionCatalogEntry[],
  ): Promise<PermissionCatalogMigrationReport> {
    return this.db.transaction().execute(async (transaction) => {
      const desiredPaths = new Set(catalog.map((entry) => entry.path))
      const authorityBefore = await effectiveAuthoritySnapshot(
        transaction,
        desiredPaths,
      )
      const previousPermissions = await transaction
        .selectFrom('app_permissions')
        .select(['path', 'status'])
        .execute()
      const previousGrants = await transaction
        .selectFrom('app_role_permissions as rp')
        .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
        .select(['rp.role_id', 'p.path'])
        .execute()
      const desiredByPath = new Map(catalog.map((entry) => [entry.path, entry]))
      const previousPermissionByPath = new Map(
        previousPermissions.map((permission) => [permission.path, permission]),
      )
      const preserved = previousGrants.filter((grant) =>
        desiredByPath.has(grant.path),
      )
      await transaction.deleteFrom('app_role_permissions').execute()
      await transaction.deleteFrom('app_permissions').execute()
      if (catalog.length > 0) {
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
              status:
                previousPermissionByPath.get(entry.path)?.status ?? 'ENABLED',
              menu_group: entry.group,
              menu_order: entry.order,
            })),
          )
          .execute()
      }
      const uniquePreserved = [
        ...new Map(
          preserved.map((grant) => [`${grant.role_id}\0${grant.path}`, grant]),
        ).values(),
      ]
      if (uniquePreserved.length > 0) {
        await transaction
          .insertInto('app_role_permissions')
          .values(
            uniquePreserved.map((grant) => ({
              role_id: grant.role_id,
              permission_id: desiredByPath.get(grant.path)!.id,
            })),
          )
          .execute()
      }
      const orphaned = await transaction
        .selectFrom('app_role_permissions as rp')
        .leftJoin('app_permissions as p', 'p.id', 'rp.permission_id')
        .leftJoin('app_roles as r', 'r.id', 'rp.role_id')
        .select((builder) => builder.fn.countAll<string>().as('count'))
        .where((builder) =>
          builder.or([
            builder('p.id', 'is', null),
            builder('r.id', 'is', null),
          ]),
        )
        .executeTakeFirstOrThrow()
      const duplicates = await transaction
        .selectFrom('app_role_permissions')
        .select(['role_id', 'permission_id'])
        .groupBy(['role_id', 'permission_id'])
        .having((builder) => builder.fn.countAll(), '>', 1)
        .execute()
      assertAuthorityPreserved(
        authorityBefore,
        await effectiveAuthoritySnapshot(transaction, desiredPaths),
      )
      return {
        preservedRoleGrants: uniquePreserved.length,
        droppedStaleRoleGrants: previousGrants.length - preserved.length,
        orphanedRoleGrants: Number(orphaned.count),
        duplicateRoleGrants: duplicates.length,
      }
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
          password_change_required: false,
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

  async createE2EArchiveFacts(facts: TargetE2EArchiveFacts): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('aux_objects')
        .values(
          facts.auxObjects.map((item) => ({
            id: item.id,
            entity: item.entity,
            code: item.code,
            data: item.data,
            enabled: true,
            created_by: facts.createdBy,
            updated_by: facts.createdBy,
          })),
        )
        .execute()
      await transaction
        .insertInto('dcl_acc_book_facts')
        .values({ ...facts.accounting.book, enabled: true })
        .execute()
      await transaction
        .insertInto('dcl_acc_vou_entity_facts')
        .values({
          id: facts.accounting.vouEntity.id,
          code: facts.accounting.vouEntity.code,
          name: facts.accounting.vouEntity.name,
          field_catalog: facts.accounting.vouEntity.fieldCatalog,
          enabled: true,
        })
        .execute()
      await transaction
        .insertInto('dcl_acc_subject_facts')
        .values(
          facts.accounting.subjects.map((subject) => ({
            id: subject.id,
            book_id: facts.accounting.book.id,
            code: subject.code,
            name: subject.name,
            leaf: subject.leaf,
            enabled: true,
            required_dimensions: JSON.stringify(
              subject.requiredDimensions,
            ) as unknown as JsonValue,
          })),
        )
        .execute()
    })
  }

  async deleteE2EArchiveFacts(facts: TargetE2EArchiveFacts): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom('dcl_acc_subject_facts')
        .where(
          'id',
          'in',
          facts.accounting.subjects.map((subject) => subject.id),
        )
        .execute()
      await transaction
        .deleteFrom('dcl_acc_vou_entity_facts')
        .where('id', '=', facts.accounting.vouEntity.id)
        .execute()
      await transaction
        .deleteFrom('dcl_acc_book_facts')
        .where('id', '=', facts.accounting.book.id)
        .execute()
      await transaction
        .deleteFrom('aux_objects')
        .where(
          'id',
          'in',
          facts.auxObjects.map((item) => item.id),
        )
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

  async deleteE2EWarehouseFixtures(createdByUserId: string): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom('dcl_customer_attachment_staging')
        .where('owner_user_id', '=', createdByUserId)
        .execute()
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
        .deleteFrom('dcl_archive_idempotency')
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
