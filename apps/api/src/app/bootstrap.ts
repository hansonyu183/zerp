import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import type { DB } from '../db/generated.ts'
import { hashPassword, verifyPassword } from './session.ts'
import { searchPinyin } from '../platform/pinyin.ts'

export interface TargetE2EPrincipal {
  userId: string
  roleId: string
  username: string
  passwordHash: string
}

export interface TargetOnlineTestUser {
  username: string
  displayName: string
  password: string
}

export interface TargetOnlineTestUserSeedReport {
  roleId: string
  createdUsers: number
  updatedUsers: number
}

export interface PermissionCatalogSyncReport {
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
          `permission catalog synchronization changed effective authority for ${kind.slice(0, -1)} ${id}`,
        )
    }
  }
}

/**
 * Application service for target-runtime setup. Operational scripts call this
 * boundary instead of writing APP business tables themselves.
 */
export class TargetBootstrapService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async syncPermissionCatalog(
    catalog: readonly TargetPermissionCatalogEntry[],
  ): Promise<PermissionCatalogSyncReport> {
    return this.db
      .transaction()
      .execute((transaction) =>
        this.syncPermissionCatalogInTransaction(transaction, catalog),
      )
  }

  /**
   * Reconciles the two fixed online-test accounts before the API starts. The
   * credential files never enter the database adapter or repository.
   */
  async seedOnlineTestUsers(
    users: readonly TargetOnlineTestUser[],
  ): Promise<TargetOnlineTestUserSeedReport> {
    const usernames = users.map((user) => user.username).sort()
    if (
      JSON.stringify(usernames) !== JSON.stringify(['test-admin', 'tester']) ||
      users.some((user) => !user.displayName.trim() || !user.password)
    )
      throw new Error('online-test seed requires test-admin and tester')

    const preparedUsers = await Promise.all(
      users.map(async (user) => ({
        ...user,
        passwordHash: await hashPassword(user.password),
      })),
    )

    return this.db.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('app:online-test-user-seed', 0))`.execute(
        transaction,
      )
      const permission = await transaction
        .selectFrom('app_permissions')
        .select('id')
        .limit(1)
        .executeTakeFirst()
      if (!permission)
        throw new Error(
          'online-test seed requires a non-empty target permission catalog',
        )

      const now = new Date()
      let role = await transaction
        .selectFrom('app_roles')
        .select(['id', 'status'])
        .where('code', '=', 'superadmin')
        .forUpdate()
        .executeTakeFirst()
      if (!role) {
        role = { id: ulid(), status: 'ENABLED' }
        await transaction
          .insertInto('app_roles')
          .values({
            id: role.id,
            code: 'superadmin',
            name: '超级管理员',
            description: '线上测试环境管理员',
            status: 'ENABLED',
          })
          .execute()
      } else if (role.status !== 'ENABLED') {
        await transaction
          .updateTable('app_roles')
          .set({
            status: 'ENABLED',
            updated_at: now,
            revision: sql`revision + 1`,
          })
          .where('id', '=', role.id)
          .execute()
      }

      let createdUsers = 0
      let updatedUsers = 0
      for (const user of preparedUsers) {
        const existing = await transaction
          .selectFrom('app_users')
          .select([
            'id',
            'username',
            'display_name',
            'py',
            'password_hash',
            'status',
            'password_change_required',
          ])
          .where(sql`lower(username)`, '=', user.username.toLowerCase())
          .forUpdate()
          .executeTakeFirst()
        const userId = existing?.id ?? ulid()
        if (existing) {
          const matches =
            existing.username === user.username &&
            existing.display_name === user.displayName &&
            existing.py === searchPinyin(user.displayName) &&
            existing.status === 'ENABLED' &&
            !existing.password_change_required &&
            (await verifyPassword(existing.password_hash, user.password))
          if (!matches) {
            await transaction
              .deleteFrom('app_sessions')
              .where('user_id', '=', userId)
              .execute()
            await transaction
              .updateTable('app_users')
              .set({
                username: user.username,
                display_name: user.displayName,
                py: searchPinyin(user.displayName),
                password_hash: user.passwordHash,
                status: 'ENABLED',
                password_change_required: false,
                password_changed_at: now,
                updated_at: now,
                revision: sql`revision + 1`,
              })
              .where('id', '=', userId)
              .execute()
            updatedUsers += 1
          }
        } else {
          await transaction
            .insertInto('app_users')
            .values({
              id: userId,
              username: user.username,
              display_name: user.displayName,
              py: searchPinyin(user.displayName),
              password_hash: user.passwordHash,
              status: 'ENABLED',
              password_change_required: false,
              password_changed_at: now,
            })
            .execute()
          createdUsers += 1
        }
        const assignment = await transaction
          .selectFrom('app_user_roles')
          .select('user_id')
          .where('user_id', '=', userId)
          .where('role_id', '=', role.id)
          .executeTakeFirst()
        if (!assignment)
          await transaction
            .insertInto('app_user_roles')
            .values({ user_id: userId, role_id: role.id })
            .execute()
      }

      return {
        roleId: role.id,
        createdUsers,
        updatedUsers,
      }
    })
  }

  async syncPermissionCatalogInTransaction(
    transaction: Transaction<DB>,
    catalog: readonly TargetPermissionCatalogEntry[],
  ): Promise<PermissionCatalogSyncReport> {
    const reportPermissions = await transaction
      .selectFrom('app_permissions')
      .selectAll()
      .where('domain', '=', 'rpt')
      .where('entity', '~', '^rpt-[0-9]{6}$')
      .where('action', 'in', ['query', 'export'])
      .execute()
    catalog = [
      ...catalog,
      ...reportPermissions
        .filter((row) => !catalog.some((entry) => entry.path === row.path))
        .map((row) => ({
          id: row.id,
          path: row.path,
          domain: row.domain,
          entity: row.entity,
          action: row.action,
          title: row.description ?? row.entity,
        })),
    ]
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
    const targetStatus = new Map(
      catalog.map((entry) => [
        entry.path,
        previousPermissionByPath.get(entry.path)?.status ?? 'ENABLED',
      ]),
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
            status: targetStatus.get(entry.path)!,
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
        builder.or([builder('p.id', 'is', null), builder('r.id', 'is', null)]),
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
  }

  async createE2EPrincipal(
    principal: TargetE2EPrincipal,
    superadmin = false,
    paths?: readonly string[],
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      const inheritedAdmin = superadmin
        ? await transaction
            .selectFrom('app_roles')
            .select('id')
            .where('code', '=', 'superadmin')
            .executeTakeFirst()
        : undefined
      const permissions = await transaction
        .selectFrom('app_permissions')
        .select('id')
        .$if(paths !== undefined, (query) =>
          query.where('path', 'in', [...paths!]),
        )
        .execute()
      if (permissions.length === 0)
        throw new Error('target catalog must contain permissions before E2E')
      if (paths && (superadmin || permissions.length !== new Set(paths).size))
        throw new Error('restricted E2E principal requires exact catalog paths')
      await transaction
        .insertInto('app_users')
        .values({
          id: principal.userId,
          username: principal.username,
          display_name: 'Target E2E User',
          py: searchPinyin('Target E2E User'),
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
          code:
            superadmin && !inheritedAdmin ? 'superadmin' : principal.username,
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
      if (inheritedAdmin)
        await transaction
          .insertInto('app_user_roles')
          .values({ user_id: principal.userId, role_id: inheritedAdmin.id })
          .execute()
    })
  }

  async deleteE2ECreatedUsers(principalIds: readonly string[]): Promise<void> {
    if (principalIds.length === 0) return
    await this.db.transaction().execute(async (transaction) => {
      await transaction
        .deleteFrom('app_audit_events')
        .where('actor_user_id', 'in', (query) =>
          query
            .selectFrom('app_users')
            .select('id')
            .where('created_by', 'in', [...principalIds]),
        )
        .execute()
      await transaction
        .deleteFrom('app_users')
        .where('created_by', 'in', [...principalIds])
        .execute()
    })
  }

  async deleteE2EPrincipal(
    principal: Pick<TargetE2EPrincipal, 'userId' | 'roleId'>,
  ): Promise<void> {
    await this.db.transaction().execute(async (transaction) => {
      await this.deleteFixtureRelations(transaction, principal)
      await transaction
        .deleteFrom('app_audit_events')
        .where('actor_user_id', '=', principal.userId)
        .execute()
      await transaction
        .deleteFrom('aux_objects')
        .where('created_by', '=', principal.userId)
        .execute()
      await transaction
        .deleteFrom('app_roles')
        .where('created_by', '=', principal.userId)
        .execute()
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
        .deleteFrom('rpt_execution_audits')
        .where(
          'definition_subject_id',
          'in',
          transaction
            .selectFrom('rpt_definitions')
            .select('id')
            .where('created_by', '=', createdByUserId),
        )
        .execute()
      await transaction
        .deleteFrom('rpt_definition_audits')
        .where(
          'definition_id',
          'in',
          transaction
            .selectFrom('rpt_definitions')
            .select('id')
            .where('created_by', '=', createdByUserId),
        )
        .execute()
      await transaction
        .deleteFrom('rpt_definitions')
        .where('created_by', '=', createdByUserId)
        .execute()
      await transaction
        .deleteFrom('bob_customer_attachment_staging')
        .where('owner_user_id', '=', createdByUserId)
        .execute()
      await transaction
        .deleteFrom('vou_attachment_staging')
        .where('owner_user_id', '=', createdByUserId)
        .execute()
      const vouDocuments = await transaction
        .selectFrom('vou_documents')
        .select('id')
        .where('created_by', '=', createdByUserId)
        .execute()
      const vouDocumentIds = vouDocuments.map((document) => document.id)
      if (vouDocumentIds.length > 0) {
        const entries = await transaction
          .selectFrom('approval_entries')
          .select('id')
          .where('domain', '=', 'vou')
          .where('subject_id', 'in', vouDocumentIds)
          .execute()
        const entryIds = entries.map((entry) => entry.id)
        await transaction
          .deleteFrom('wfl_instances')
          .where('root_document_id', 'in', vouDocumentIds)
          .execute()
        await transaction
          .deleteFrom('wfl_trials')
          .where('document_id', 'in', vouDocumentIds)
          .execute()
        if (entryIds.length > 0) {
          await sql`
            DELETE FROM acc_asset_book_values
            WHERE acquisition_vou_approval_entry_id IN (${sql.join(entryIds)})
          `.execute(transaction)
          await sql`
            DELETE FROM acc_asset_registers
            WHERE acquisition_vou_approval_entry_id IN (${sql.join(entryIds)})
               OR state_vou_approval_entry_id IN (${sql.join(entryIds)})
          `.execute(transaction)
          await sql`
            DELETE FROM acc_bill_registers
            WHERE created_vou_approval_entry_id IN (${sql.join(entryIds)})
               OR state_vou_approval_entry_id IN (${sql.join(entryIds)})
          `.execute(transaction)
          await transaction
            .deleteFrom('acc_inventory_entries')
            .where('vou_approval_entry_id', 'in', entryIds)
            .execute()
          await transaction
            .deleteFrom('acc_register_entries')
            .where('vou_approval_entry_id', 'in', entryIds)
            .execute()
          await transaction
            .deleteFrom('acc_container_entries')
            .where('vou_approval_entry_id', 'in', entryIds)
            .execute()
          await transaction
            .deleteFrom('acc_journal_entries')
            .where('vou_approval_entry_id', 'in', entryIds)
            .execute()
        }
        await transaction
          .deleteFrom('vou_idempotency')
          .where('document_id', 'in', vouDocumentIds)
          .execute()
        await transaction
          .deleteFrom('approval_events')
          .where('domain', '=', 'vou')
          .where('subject_id', 'in', vouDocumentIds)
          .execute()
        await transaction
          .deleteFrom('approval_entries')
          .where('domain', '=', 'vou')
          .where('subject_id', 'in', vouDocumentIds)
          .execute()
        await transaction
          .deleteFrom('vou_documents')
          .where('id', 'in', vouDocumentIds)
          .execute()
      }
      const subjects = await transaction
        .selectFrom('dcl_subjects')
        .select('id')
        .where('created_by', '=', createdByUserId)
        .execute()
      const bobSubjects = await transaction
        .selectFrom('bob_subjects')
        .select('id')
        .where('created_by', '=', createdByUserId)
        .execute()
      const subjectIds = [...subjects, ...bobSubjects].map(
        (subject) => subject.id,
      )
      if (subjectIds.length === 0) return
      await transaction
        .deleteFrom('archive_idempotency')
        .where('subject_id', 'in', subjectIds)
        .execute()
      await transaction
        .deleteFrom('approval_events')
        .where('subject_id', 'in', subjectIds)
        .execute()
      await transaction
        .deleteFrom('approval_entries')
        .where('subject_id', 'in', subjectIds)
        .execute()
      await transaction
        .deleteFrom('dcl_subjects')
        .where('id', 'in', subjectIds)
        .execute()
      await transaction
        .deleteFrom('bob_subjects')
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
