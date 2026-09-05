import { createHash, randomBytes } from 'node:crypto'

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import type { DB } from '../db/generated.ts'
import { AppServiceError, hashPassword, type Principal } from './session.ts'

const systemUserId = '01JAPPSYST3MACTR0000000000'
const superadminCode = 'superadmin'
type Status = 'ENABLED' | 'DISABLED'
type AnyDb = Kysely<DB>
type MenuItemType = 'GROUP' | 'ROUTE'
type RoleRow = {
  id: string
  code: string
  name: string
  description: string | null
  status: string
  created_at: Date
  updated_at: Date
  revision: string | number | bigint
}
type ParameterRow = {
  parameter_key: string
  name: string
  description: string | null
  value_type: string
  configured_value: string
  default_value: string
  editable: boolean
  constraints: unknown
  revision: string | number | bigint
}

interface MenuRoute {
  routeKey: string
  routePath: string
  permissionCode: string
  displayName: string
  group: string
  order: number
}

interface MenuItemView {
  id: string
  parentId: string | null
  type: MenuItemType
  level: number
  order: number
  displayName: string
  icon: string | null
  enabled: boolean
  routeKey: string | null
  routePath: string | null
  permissionCode: string | null
}

export interface PageInput {
  page: number
  pageSize: number
  filters?: Record<string, string | undefined>
  sort?: Array<{ field: string; order: 'asc' | 'desc' }>
}

export interface ManagementServiceOptions {
  passwordMinLength: number
}

/**
 * APP administration's target-side domain boundary. Route handlers authenticate
 * a request first, then call these methods with that current principal. Every
 * mutating method still rechecks the exact path and actor facts in its own
 * transaction: a session permission snapshot is never an authorization grant.
 */
export class ManagementService {
  private readonly db: AnyDb
  private readonly passwordMinLength: number

  constructor(db: Kysely<DB>, options: ManagementServiceOptions) {
    this.db = db
    this.passwordMinLength = options.passwordMinLength
  }

  async queryUsers(input: PageInput, principal: Principal) {
    this.require(principal, '/app/user/query')
    const page = this.page(input, 20)
    const filters = input.filters ?? {}
    const search = this.optionalSearch(filters.search)
    const status = this.optionalStatus(filters.status)
    const [rows, count] = await Promise.all([
      this.db
        .selectFrom('app_users')
        .select([
          'id',
          'username',
          'display_name',
          'status',
          'created_at',
          'updated_at',
          'revision',
        ])
        .where((eb) =>
          search
            ? eb.or([
                eb('username', 'ilike', `%${search}%`),
                eb('display_name', 'ilike', `%${search}%`),
              ])
            : eb.val(true),
        )
        .$if(Boolean(status), (qb) => qb.where('status', '=', status!))
        .orderBy('username', 'asc')
        .offset((page.page - 1) * page.pageSize)
        .limit(page.pageSize)
        .execute(),
      this.db
        .selectFrom('app_users')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where((eb) =>
          search
            ? eb.or([
                eb('username', 'ilike', `%${search}%`),
                eb('display_name', 'ilike', `%${search}%`),
              ])
            : eb.val(true),
        )
        .$if(Boolean(status), (qb) => qb.where('status', '=', status!))
        .executeTakeFirstOrThrow(),
    ])
    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        status: row.status as Status,
        system: row.id === systemUserId,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        revision: String(row.revision),
        manageable: await this.userManageable(row.id, principal),
      })),
    )
    return {
      items,
      total: Number(count.count),
      page: page.page,
      pageSize: 20 as const,
    }
  }

  async getUser(id: string, principal: Principal) {
    this.require(principal, '/app/user/get')
    return this.userDetail(id, principal)
  }

  async createUser(
    input: {
      username: string
      displayName: string
      password: string
      roleIds: string[]
    },
    principal: Principal,
    requestId: string,
  ) {
    this.require(principal, '/app/user/create')
    this.require(principal, '/app/role/query')
    const username = this.username(input.username)
    const displayName = this.displayName(input.displayName)
    this.password(input.password)
    const roleIds = this.ids(input.roleIds, 'role')
    const id = ulid()
    await this.db.transaction().execute(async (tx) => {
      await this.lock(tx)
      await this.assertCurrentActor(tx, principal)
      await this.assertAssignableRoles(tx, roleIds, principal)
      const duplicate = await tx
        .selectFrom('app_users')
        .select('id')
        .where(sql`lower(username)`, '=', username)
        .executeTakeFirst()
      if (duplicate)
        throw new AppServiceError('conflict', 'username already exists')
      await tx
        .insertInto('app_users')
        .values({
          id,
          username,
          display_name: displayName,
          password_hash: await hashPassword(input.password),
          status: 'ENABLED',
          password_change_required: true,
          password_changed_at: new Date(),
          created_by: principal.user.id,
          updated_by: principal.user.id,
        })
        .execute()
      await this.replaceUserRoles(tx, id, roleIds, principal.user.id)
      await this.audit(
        tx,
        'USER_CREATE',
        principal.user.id,
        'user',
        id,
        requestId,
        { roleCount: roleIds.length },
      )
    })
    return this.userDetail(id, principal)
  }

  async saveUser(
    input: {
      id: string
      displayName: string
      roleIds: string[]
      revision: string | number
    },
    principal: Principal,
    requestId: string,
  ) {
    this.id(input.id)
    const displayName = this.displayName(input.displayName)
    const roleIds = this.ids(input.roleIds, 'role')
    const revision = this.revision(input.revision)
    await this.db.transaction().execute(async (tx) => {
      await this.lock(tx)
      await this.assertCurrentActor(tx, principal)
      const target = await tx
        .selectFrom('app_users')
        .selectAll()
        .where('id', '=', input.id)
        .forUpdate()
        .executeTakeFirst()
      if (!target) throw new AppServiceError('not_found', 'user not found')
      if (target.id === systemUserId)
        throw new AppServiceError(
          'conflict',
          'system identity is managed internally',
        )
      const self = target.id === principal.user.id
      if (!self) this.require(principal, '/app/user/save')
      if (self) {
        const existing = await this.roleIds(tx, target.id)
        if (!same(existing, roleIds))
          throw new AppServiceError('forbidden', 'cannot change own roles')
      } else {
        if (!(await this.userManageable(target.id, principal, tx)))
          throw new AppServiceError('forbidden', 'user cannot be maintained')
        this.require(principal, '/app/role/query')
        await this.assertAssignableRoles(tx, roleIds, principal)
      }
      const updated = await tx
        .updateTable('app_users')
        .set({
          display_name: displayName,
          updated_at: new Date(),
          updated_by: principal.user.id,
          revision: sql`revision + 1`,
        })
        .where('id', '=', target.id)
        .where('revision', '=', String(revision))
        .executeTakeFirst()
      if (Number(updated.numUpdatedRows) !== 1)
        throw new AppServiceError('user_changed', 'user revision conflict')
      await this.replaceUserRoles(tx, target.id, roleIds, principal.user.id)
      await this.ensureAuthorizationSafety(tx)
      await this.audit(
        tx,
        'USER_SAVE',
        principal.user.id,
        'user',
        target.id,
        requestId,
        { roleCount: roleIds.length },
      )
    })
    return this.userDetail(input.id, principal)
  }

  async setUserStatus(
    input: { id: string; revision: string | number },
    status: Status,
    principal: Principal,
    requestId: string,
  ) {
    this.id(input.id)
    const revision = this.revision(input.revision)
    this.require(
      principal,
      status === 'ENABLED' ? '/app/user/enable' : '/app/user/disable',
    )
    await this.db.transaction().execute(async (tx) => {
      await this.lock(tx)
      await this.assertCurrentActor(tx, principal)
      const target = await tx
        .selectFrom('app_users')
        .selectAll()
        .where('id', '=', input.id)
        .forUpdate()
        .executeTakeFirst()
      if (!target) throw new AppServiceError('not_found', 'user not found')
      if (target.id === systemUserId || target.id === principal.user.id)
        throw new AppServiceError('conflict', 'cannot change this user status')
      if (!(await this.userManageable(target.id, principal, tx)))
        throw new AppServiceError('forbidden', 'user cannot be maintained')
      const updated = await tx
        .updateTable('app_users')
        .set({
          status,
          updated_at: new Date(),
          updated_by: principal.user.id,
          revision: sql`revision + 1`,
        })
        .where('id', '=', target.id)
        .where('revision', '=', String(revision))
        .executeTakeFirst()
      if (Number(updated.numUpdatedRows) !== 1)
        throw new AppServiceError('user_changed', 'user revision conflict')
      if (status === 'DISABLED')
        await this.revokeUserSessions(tx, target.id, 'user_disabled')
      await this.ensureAuthorizationSafety(tx)
      await this.audit(
        tx,
        `USER_${status}`,
        principal.user.id,
        'user',
        target.id,
        requestId,
      )
    })
    return this.userDetail(input.id, principal)
  }

  async resetUserPassword(
    input: { id: string; revision: string | number },
    principal: Principal,
    requestId: string,
  ) {
    this.id(input.id)
    const revision = this.revision(input.revision)
    this.require(principal, '/app/user/reset-password')
    const temporaryPassword = this.temporaryPassword()
    await this.db.transaction().execute(async (tx) => {
      await this.lock(tx)
      await this.assertCurrentActor(tx, principal)
      const target = await tx
        .selectFrom('app_users')
        .selectAll()
        .where('id', '=', input.id)
        .forUpdate()
        .executeTakeFirst()
      if (!target) throw new AppServiceError('not_found', 'user not found')
      if (
        target.id === systemUserId ||
        target.id === principal.user.id ||
        target.status !== 'ENABLED'
      )
        throw new AppServiceError(
          'forbidden',
          'cannot reset this user password',
        )
      if (!(await this.userManageable(target.id, principal, tx)))
        throw new AppServiceError('forbidden', 'user cannot be maintained')
      const updated = await tx
        .updateTable('app_users')
        .set({
          password_hash: await hashPassword(temporaryPassword),
          password_change_required: true,
          password_changed_at: new Date(),
          updated_at: new Date(),
          updated_by: principal.user.id,
          revision: sql`revision + 1`,
        })
        .where('id', '=', target.id)
        .where('revision', '=', String(revision))
        .executeTakeFirst()
      if (Number(updated.numUpdatedRows) !== 1)
        throw new AppServiceError('user_changed', 'user revision conflict')
      await this.revokeUserSessions(tx, target.id, 'password_reset')
      await this.audit(
        tx,
        'USER_RESET_PASSWORD',
        principal.user.id,
        'user',
        target.id,
        requestId,
      )
    })
    return { temporaryPassword }
  }

  async queryRoles(input: PageInput, principal: Principal) {
    this.require(principal, '/app/role/query')
    const page = this.page(input, 20)
    const status = this.optionalStatus(input.filters?.status)
    const search = this.optionalSearch(input.filters?.search)
    const rows = await this.db
      .selectFrom('app_roles')
      .selectAll()
      .$if(Boolean(status), (qb) => qb.where('status', '=', status!))
      .$if(Boolean(search), (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('code', 'ilike', `%${search}%`),
            eb('name', 'ilike', `%${search}%`),
          ]),
        ),
      )
      .orderBy('code', 'asc')
      .orderBy('id', 'asc')
      .offset((page.page - 1) * 20)
      .limit(20)
      .execute()
    const count = await this.db
      .selectFrom('app_roles')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .$if(Boolean(status), (qb) => qb.where('status', '=', status!))
      .$if(Boolean(search), (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('code', 'ilike', `%${search}%`),
            eb('name', 'ilike', `%${search}%`),
          ]),
        ),
      )
      .executeTakeFirstOrThrow()
    return {
      items: await Promise.all(
        rows.map((row) => this.roleListItem(row, principal)),
      ),
      total: Number(count.count),
      page: page.page,
      pageSize: 20,
    }
  }

  async getRole(id: string, principal: Principal) {
    this.require(principal, '/app/role/get')
    this.id(id)
    const role = await this.db
      .selectFrom('app_roles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    if (!role) throw new AppServiceError('not_found', 'role not found')
    return this.roleDetail(role, principal)
  }

  async createRole(
    input: {
      name: string
      description?: string | null
      permissionIds: string[]
    },
    principal: Principal,
    requestId: string,
  ) {
    this.require(principal, '/app/role/create')
    this.require(principal, '/app/permission/query')
    const name = this.displayName(input.name)
    const permissionIds = this.ids(input.permissionIds, 'permission')
    const id = ulid()
    await this.db.transaction().execute(async (tx) => {
      await this.lock(tx)
      await this.assertCurrentActor(tx, principal)
      await this.assertPermissionSet(tx, permissionIds, principal)
      const existing = await tx
        .selectFrom('app_roles')
        .select('id')
        .where(sql`lower(name)`, '=', name.toLowerCase())
        .executeTakeFirst()
      if (existing)
        throw new AppServiceError(
          'role_name_exists',
          'role name already exists',
        )
      await tx
        .insertInto('app_roles')
        .values({
          id,
          code: await this.nextRoleCode(tx),
          name,
          description: this.optionalText(input.description),
          status: 'ENABLED',
          created_by: principal.user.id,
          updated_by: principal.user.id,
        })
        .execute()
      await this.replaceRolePermissions(
        tx,
        id,
        permissionIds,
        principal.user.id,
      )
      await this.audit(
        tx,
        'ROLE_CREATE',
        principal.user.id,
        'role',
        id,
        requestId,
        { permissionCount: permissionIds.length },
      )
    })
    return this.getRole(id, principal)
  }

  async saveRole(
    input: {
      id: string
      name: string
      description?: string | null
      permissionIds: string[]
      revision: string | number
    },
    principal: Principal,
    requestId: string,
  ) {
    this.require(principal, '/app/role/save')
    this.require(principal, '/app/permission/query')
    this.id(input.id)
    const name = this.displayName(input.name)
    const revision = this.revision(input.revision)
    const permissionIds = this.ids(input.permissionIds, 'permission')
    await this.db.transaction().execute(async (tx) => {
      await this.lock(tx)
      await this.assertCurrentActor(tx, principal)
      const role = await tx
        .selectFrom('app_roles')
        .selectAll()
        .where('id', '=', input.id)
        .forUpdate()
        .executeTakeFirst()
      if (!role) throw new AppServiceError('not_found', 'role not found')
      if (!(await this.roleManageable(role, principal, tx)))
        throw new AppServiceError('forbidden', 'role cannot be maintained')
      await this.assertPermissionSet(tx, permissionIds, principal)
      const duplicate = await tx
        .selectFrom('app_roles')
        .select('id')
        .where(sql`lower(name)`, '=', name.toLowerCase())
        .where('id', '!=', role.id)
        .executeTakeFirst()
      if (duplicate)
        throw new AppServiceError(
          'role_name_exists',
          'role name already exists',
        )
      const updated = await tx
        .updateTable('app_roles')
        .set({
          name,
          description: this.optionalText(input.description),
          updated_at: new Date(),
          updated_by: principal.user.id,
          revision: sql`revision + 1`,
        })
        .where('id', '=', role.id)
        .where('revision', '=', String(revision))
        .executeTakeFirst()
      if (Number(updated.numUpdatedRows) !== 1)
        throw new AppServiceError('role_changed', 'role revision conflict')
      await this.replaceRolePermissions(
        tx,
        role.id,
        permissionIds,
        principal.user.id,
      )
      await this.ensureAuthorizationSafety(tx)
      await this.audit(
        tx,
        'ROLE_SAVE',
        principal.user.id,
        'role',
        role.id,
        requestId,
        { permissionCount: permissionIds.length },
      )
    })
    return this.getRole(input.id, principal)
  }

  async setRoleStatus(
    input: { id: string; revision: string | number },
    status: Status,
    principal: Principal,
    requestId: string,
  ) {
    this.id(input.id)
    const revision = this.revision(input.revision)
    this.require(
      principal,
      status === 'ENABLED' ? '/app/role/enable' : '/app/role/disable',
    )
    await this.db.transaction().execute(async (tx) => {
      await this.lock(tx)
      await this.assertCurrentActor(tx, principal)
      const role = await tx
        .selectFrom('app_roles')
        .selectAll()
        .where('id', '=', input.id)
        .forUpdate()
        .executeTakeFirst()
      if (!role) throw new AppServiceError('not_found', 'role not found')
      if (!(await this.roleManageable(role, principal, tx)))
        throw new AppServiceError('forbidden', 'role cannot be maintained')
      const updated = await tx
        .updateTable('app_roles')
        .set({
          status,
          updated_at: new Date(),
          updated_by: principal.user.id,
          revision: sql`revision + 1`,
        })
        .where('id', '=', role.id)
        .where('revision', '=', String(revision))
        .executeTakeFirst()
      if (Number(updated.numUpdatedRows) !== 1)
        throw new AppServiceError('role_changed', 'role revision conflict')
      await this.ensureAuthorizationSafety(tx)
      await this.audit(
        tx,
        `ROLE_${status}`,
        principal.user.id,
        'role',
        role.id,
        requestId,
      )
    })
    return this.getRole(input.id, principal)
  }

  async queryPermissions(input: PageInput, principal: Principal) {
    this.require(principal, '/app/permission/query')
    const page = this.page(input, 20)
    const filters = input.filters ?? {}
    const status = this.optionalStatus(filters.status)
    const filtered = () =>
      this.db
        .selectFrom('app_permissions')
        .$if(Boolean(filters.domain), (qb) =>
          qb.where('domain', '=', filters.domain!),
        )
        .$if(Boolean(filters.entity), (qb) =>
          qb.where('entity', '=', filters.entity!),
        )
        .$if(Boolean(filters.action), (qb) =>
          qb.where('action', '=', filters.action!),
        )
        .$if(Boolean(status), (qb) => qb.where('status', '=', status!))
    const [rows, count] = await Promise.all([
      filtered()
        .selectAll()
        .orderBy('path', 'asc')
        .offset((page.page - 1) * page.pageSize)
        .limit(page.pageSize)
        .execute(),
      filtered()
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
    ])
    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        path: row.path,
        domain: row.domain,
        entity: row.entity,
        action: row.action,
        description: row.description,
        status: row.status,
        revision: String(row.revision),
        directRoleCount: await this.directRoleCount(row.id),
      })),
    )
    return {
      items,
      page: page.page,
      pageSize: page.pageSize,
      total: Number(count.count),
    }
  }

  async getPermission(id: string, principal: Principal) {
    this.require(principal, '/app/permission/get')
    this.id(id)
    const permission = await this.db
      .selectFrom('app_permissions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    if (!permission)
      throw new AppServiceError('not_found', 'permission not found')
    return {
      id: permission.id,
      path: permission.path,
      domain: permission.domain,
      entity: permission.entity,
      action: permission.action,
      description: permission.description,
      status: permission.status,
      revision: String(permission.revision),
      directRoleCount: await this.directRoleCount(id),
    }
  }

  async getBranding() {
    const parameter = await this.db
      .selectFrom('app_system_parameters')
      .select('configured_value')
      .where('parameter_key', '=', 'app.enterprise-name')
      .executeTakeFirst()
    if (!parameter)
      throw new AppServiceError(
        'not_found',
        'enterprise branding is unavailable',
      )
    return { enterpriseName: parameter.configured_value }
  }

  async querySystemParameters(input: PageInput, principal: Principal) {
    this.require(principal, '/app/system-parameter/query')
    const page = this.page(input, 20)
    const search = this.optionalSearch(input.filters?.search)
    const filtered = () =>
      this.db
        .selectFrom('app_system_parameters')
        .$if(Boolean(search), (qb) =>
          qb.where((eb) =>
            eb.or([
              eb('parameter_key', 'ilike', `%${search}%`),
              eb('name', 'ilike', `%${search}%`),
            ]),
          ),
        )
    const [rows, count] = await Promise.all([
      filtered()
        .selectAll()
        .orderBy('parameter_key', 'asc')
        .offset((page.page - 1) * page.pageSize)
        .limit(page.pageSize)
        .execute(),
      filtered()
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
    ])
    return {
      items: rows.map((row) => this.parameterView(row)),
      page: page.page,
      pageSize: page.pageSize,
      total: Number(count.count),
    }
  }

  async getSystemParameter(key: string, principal: Principal) {
    this.require(principal, '/app/system-parameter/get')
    const row = await this.db
      .selectFrom('app_system_parameters')
      .selectAll()
      .where('parameter_key', '=', key)
      .executeTakeFirst()
    if (!row)
      throw new AppServiceError('not_found', 'system parameter not found')
    return this.parameterView(row)
  }

  async saveSystemParameter(
    input: {
      parameterKey: string
      configuredValue: string
      revision: string | number
    },
    principal: Principal,
    requestId: string,
  ) {
    this.require(principal, '/app/system-parameter/save')
    const revision = this.revision(input.revision)
    return this.db.transaction().execute(async (tx) => {
      await this.assertCurrentActor(tx, principal)
      const current = await tx
        .selectFrom('app_system_parameters')
        .selectAll()
        .where('parameter_key', '=', input.parameterKey)
        .forUpdate()
        .executeTakeFirst()
      if (!current)
        throw new AppServiceError('not_found', 'system parameter not found')
      if (!current.editable)
        throw new AppServiceError('forbidden', 'system parameter is read-only')
      this.validateParameter(current, input.configuredValue)
      const result = await tx
        .updateTable('app_system_parameters')
        .set({
          configured_value: input.configuredValue,
          revision: sql`revision + 1`,
        })
        .where('parameter_key', '=', current.parameter_key)
        .where('revision', '=', String(revision))
        .executeTakeFirst()
      if (Number(result.numUpdatedRows) !== 1)
        throw new AppServiceError(
          'conflict',
          'system parameter revision conflict',
        )
      await this.audit(
        tx,
        'SYSTEM_PARAMETER_SAVE',
        principal.user.id,
        'system-parameter',
        current.parameter_key,
        requestId,
      )
      return this.parameterView({
        ...current,
        configured_value: input.configuredValue,
        revision: BigInt(current.revision) + 1n,
      })
    })
  }

  async resetSystemParameter(
    input: { parameterKey: string; revision: string | number },
    principal: Principal,
    requestId: string,
  ) {
    this.require(principal, '/app/system-parameter/reset')
    const revision = this.revision(input.revision)
    return this.db.transaction().execute(async (tx) => {
      await this.assertCurrentActor(tx, principal)
      const current = await tx
        .selectFrom('app_system_parameters')
        .selectAll()
        .where('parameter_key', '=', input.parameterKey)
        .forUpdate()
        .executeTakeFirst()
      if (!current)
        throw new AppServiceError('not_found', 'system parameter not found')
      if (!current.editable)
        throw new AppServiceError('forbidden', 'system parameter is read-only')
      const result = await tx
        .updateTable('app_system_parameters')
        .set({
          configured_value: current.default_value,
          revision: sql`revision + 1`,
        })
        .where('parameter_key', '=', current.parameter_key)
        .where('revision', '=', String(revision))
        .executeTakeFirst()
      if (Number(result.numUpdatedRows) !== 1)
        throw new AppServiceError(
          'conflict',
          'system parameter revision conflict',
        )
      await this.audit(
        tx,
        'SYSTEM_PARAMETER_RESET',
        principal.user.id,
        'system-parameter',
        current.parameter_key,
        requestId,
      )
      return this.parameterView({
        ...current,
        configured_value: current.default_value,
        revision: BigInt(current.revision) + 1n,
      })
    })
  }

  async getMenu(principal: Principal) {
    const [settings, items] = await Promise.all([
      this.db
        .selectFrom('app_menu_settings')
        .selectAll()
        .where('id', '=', 1)
        .executeTakeFirst(),
      this.db
        .selectFrom('app_business_menu_items')
        .selectAll()
        .orderBy('parent_id', 'asc')
        .orderBy('sort_order', 'asc')
        .orderBy('id', 'asc')
        .execute(),
    ])
    if (!settings)
      throw new AppServiceError(
        'internal_error',
        'menu settings are unavailable',
      )
    const catalog = await this.routeCatalog()
    const defaultMenu = { items: this.defaultMenu(catalog) }
    const businessMenu = { items: this.menuTree(items, catalog) }
    const selected =
      settings.menu_mode === 'BUSINESS' ? businessMenu : defaultMenu
    return {
      mode: settings.menu_mode,
      revision: String(settings.revision),
      defaultMenu,
      businessMenu,
      navigation: {
        items: [
          this.workbenchMenuItem(),
          ...this.filterMenu(selected.items, principal.permissions).filter(
            (item) => item.routePath !== '/home/dashboard',
          ),
        ],
      },
      availableRoutes: [...catalog.values()].map((route) => ({
        routeKey: route.routeKey,
        routePath: route.routePath,
        displayName: route.displayName,
        permissionCode: route.permissionCode,
      })),
    }
  }

  async saveBusinessMenu(
    input: { items: Array<Record<string, unknown>>; revision: string | number },
    principal: Principal,
    requestId: string,
  ) {
    this.require(principal, '/app/menu/save-business')
    return this.writeMenu(
      'MENU_SAVE_BUSINESS',
      input.revision,
      principal,
      requestId,
      async (tx, catalog) => {
        const items = this.businessMenuItems(
          input.items,
          catalog,
          principal.user.id,
        )
        await tx.deleteFrom('app_business_menu_items').execute()
        if (items.length)
          await tx.insertInto('app_business_menu_items').values(items).execute()
      },
    )
  }

  async activateMenu(
    input: { mode: 'DEFAULT' | 'BUSINESS'; revision: string | number },
    principal: Principal,
    requestId: string,
  ) {
    this.require(principal, '/app/menu/activate')
    if (input.mode !== 'DEFAULT' && input.mode !== 'BUSINESS')
      throw new AppServiceError('validation_failed', 'invalid menu mode')
    return this.writeMenu(
      'MENU_ACTIVATE',
      input.revision,
      principal,
      requestId,
      async (tx) => {
        await tx
          .updateTable('app_menu_settings')
          .set({
            menu_mode: input.mode,
            updated_at: new Date(),
            updated_by: principal.user.id,
          })
          .where('id', '=', 1)
          .execute()
      },
    )
  }

  async resetBusinessMenu(
    input: { revision: string | number },
    principal: Principal,
    requestId: string,
  ) {
    this.require(principal, '/app/menu/reset-business')
    return this.writeMenu(
      'MENU_RESET_BUSINESS',
      input.revision,
      principal,
      requestId,
      async (tx, catalog) => {
        await tx.deleteFrom('app_business_menu_items').execute()
        const items = this.defaultBusinessMenu(catalog, principal.user.id)
        if (items.length)
          await tx.insertInto('app_business_menu_items').values(items).execute()
      },
    )
  }

  private require(principal: Principal, path: string) {
    if (!principal.permissions.includes(path))
      throw new AppServiceError('forbidden', 'permission denied')
  }

  private async lock(tx: AnyDb) {
    await sql`SELECT pg_advisory_xact_lock(74155001)`.execute(tx)
  }

  private page(input: PageInput, fixed?: number) {
    if (
      !Number.isInteger(input.page) ||
      input.page < 1 ||
      !Number.isInteger(input.pageSize) ||
      input.pageSize < 1 ||
      input.pageSize > 200 ||
      (fixed && input.pageSize !== fixed)
    )
      throw new AppServiceError('validation_failed', 'invalid pagination')
    return { page: input.page, pageSize: input.pageSize }
  }
  private optionalStatus(value?: string): Status | undefined {
    if (!value) return undefined
    if (value === 'ENABLED' || value === 'DISABLED') return value
    throw new AppServiceError('validation_failed', 'invalid status')
  }
  private optionalSearch(value?: string) {
    if (!value?.trim()) return undefined
    const result = value.trim()
    if ([...result].length > 128)
      throw new AppServiceError('validation_failed', 'invalid search')
    return result
  }
  private id(value: string) {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value))
      throw new AppServiceError('validation_failed', 'invalid id')
  }
  private ids(values: string[], label: string) {
    const unique = [...new Set(values.map((value) => value.trim()))].sort()
    if (!unique.length)
      throw new AppServiceError('validation_failed', `missing ${label} ids`)
    unique.forEach((value) => this.id(value))
    return unique
  }
  private revision(value: string | number) {
    const parsed = BigInt(value)
    if (parsed < 1n)
      throw new AppServiceError('validation_failed', 'invalid revision')
    return parsed
  }
  private username(value: string) {
    const result = value.trim().toLowerCase()
    if ([...result].length < 3 || [...result].length > 64)
      throw new AppServiceError('validation_failed', 'invalid username')
    return result
  }
  private displayName(value: string) {
    const result = value.trim()
    if ([...result].length < 1 || [...result].length > 128)
      throw new AppServiceError('validation_failed', 'invalid name')
    return result
  }
  private password(value: string) {
    if (
      [...value].length < this.passwordMinLength ||
      [...value].length > 256 ||
      !/[a-z]/.test(value) ||
      !/[A-Z]/.test(value) ||
      !/[0-9]/.test(value) ||
      !/[^A-Za-z0-9]/.test(value)
    )
      throw new AppServiceError('validation_failed', 'invalid password')
  }
  private optionalText(value?: string | null) {
    const result = value?.trim()
    return result || null
  }
  private temporaryPassword() {
    const value = `Aa1!${randomBytes(18).toString('base64url')}`
    this.password(value)
    return value
  }

  private async permissionsFor(tx: AnyDb, userId: string) {
    const rows = await sql<{
      path: string
    }>`SELECT DISTINCT p.path FROM app_permissions p WHERE p.status='ENABLED' AND (EXISTS (SELECT 1 FROM app_user_roles ur JOIN app_roles r ON r.id=ur.role_id AND r.status='ENABLED' WHERE ur.user_id=${userId} AND r.code=${superadminCode}) OR EXISTS (SELECT 1 FROM app_user_roles ur JOIN app_roles r ON r.id=ur.role_id AND r.status='ENABLED' JOIN app_role_permissions rp ON rp.role_id=r.id WHERE ur.user_id=${userId} AND rp.permission_id=p.id)) ORDER BY p.path`.execute(
      tx,
    )
    return rows.rows.map((row) => row.path)
  }
  private async isSuperadmin(tx: AnyDb, userId: string) {
    return Boolean(
      await tx
        .selectFrom('app_user_roles as ur')
        .innerJoin('app_roles as r', 'r.id', 'ur.role_id')
        .select('r.id')
        .where('ur.user_id', '=', userId)
        .where('r.code', '=', superadminCode)
        .where('r.status', '=', 'ENABLED')
        .executeTakeFirst(),
    )
  }
  private async roleIds(tx: AnyDb, userId: string) {
    return (
      await tx
        .selectFrom('app_user_roles')
        .select('role_id')
        .where('user_id', '=', userId)
        .orderBy('role_id')
        .execute()
    ).map((row) => row.role_id)
  }
  private async userManageable(
    id: string,
    principal: Principal,
    tx: AnyDb = this.db,
  ) {
    if (id === systemUserId) return false
    if (id === principal.user.id) return true
    const [target, targetSuperadmin, actorSuperadmin] = await Promise.all([
      this.permissionsFor(tx, id),
      this.isSuperadmin(tx, id),
      this.isSuperadmin(tx, principal.user.id),
    ])
    return (
      actorSuperadmin ||
      (!targetSuperadmin &&
        target.every((path) => principal.permissions.includes(path)))
    )
  }
  private async rolePermissions(
    tx: AnyDb,
    roleId: string,
    includeDisabled = false,
  ) {
    const rows = await tx
      .selectFrom('app_role_permissions as rp')
      .innerJoin('app_permissions as p', 'p.id', 'rp.permission_id')
      .select([
        'p.id',
        'p.path',
        'p.status',
        'p.domain',
        'p.entity',
        'p.action',
        'p.description',
      ])
      .where('rp.role_id', '=', roleId)
      .$if(!includeDisabled, (qb) => qb.where('p.status', '=', 'ENABLED'))
      .orderBy('p.path', 'asc')
      .execute()
    return rows
  }
  private async roleManageable(
    role: Pick<RoleRow, 'id' | 'code'>,
    principal: Principal,
    tx: AnyDb,
  ) {
    if (role.code === superadminCode || role.code === 'system') return false
    const [selfHeld, actorSuperadmin, permissions] = await Promise.all([
      tx
        .selectFrom('app_user_roles')
        .select('role_id')
        .where('user_id', '=', principal.user.id)
        .where('role_id', '=', role.id)
        .executeTakeFirst(),
      this.isSuperadmin(tx, principal.user.id),
      this.rolePermissions(tx, role.id),
    ])
    return (
      !selfHeld &&
      (actorSuperadmin ||
        permissions.every((permission) =>
          principal.permissions.includes(permission.path),
        ))
    )
  }
  private async assertAssignableRoles(
    tx: AnyDb,
    roleIds: string[],
    principal: Principal,
  ) {
    const roles = await tx
      .selectFrom('app_roles')
      .selectAll()
      .where('id', 'in', roleIds)
      .execute()
    if (
      roles.length !== roleIds.length ||
      roles.some((role) => role.status !== 'ENABLED')
    )
      throw new AppServiceError(
        'validation_failed',
        'one or more roles do not exist or are disabled',
      )
    if (
      !(
        await Promise.all(
          roles.map((role) => this.roleManageable(role, principal, tx)),
        )
      ).every(Boolean)
    )
      throw new AppServiceError(
        'forbidden',
        'one or more roles cannot be assigned',
      )
  }
  private async assertPermissionSet(
    tx: AnyDb,
    ids: string[],
    principal: Principal,
  ) {
    const permissions = await tx
      .selectFrom('app_permissions')
      .select(['id', 'path', 'status'])
      .where('id', 'in', ids)
      .execute()
    if (
      permissions.length !== ids.length ||
      permissions.some((permission) => permission.status !== 'ENABLED')
    )
      throw new AppServiceError(
        'validation_failed',
        'one or more permissions do not exist or are disabled',
      )
    const actorSuperadmin = await this.isSuperadmin(tx, principal.user.id)
    if (
      !actorSuperadmin &&
      permissions.some(
        (permission) => !principal.permissions.includes(permission.path),
      )
    )
      throw new AppServiceError(
        'forbidden',
        'requested permissions exceed authorization ceiling',
      )
  }
  private async replaceUserRoles(
    tx: AnyDb,
    userId: string,
    roleIds: string[],
    actorId: string,
  ) {
    await tx
      .deleteFrom('app_user_roles')
      .where('user_id', '=', userId)
      .execute()
    await tx
      .insertInto('app_user_roles')
      .values(
        roleIds.map((roleId) => ({
          user_id: userId,
          role_id: roleId,
          created_by: actorId,
        })),
      )
      .execute()
  }
  private async replaceRolePermissions(
    tx: AnyDb,
    roleId: string,
    permissionIds: string[],
    actorId: string,
  ) {
    await tx
      .deleteFrom('app_role_permissions')
      .where('role_id', '=', roleId)
      .execute()
    await tx
      .insertInto('app_role_permissions')
      .values(
        permissionIds.map((permissionId) => ({
          role_id: roleId,
          permission_id: permissionId,
          created_by: actorId,
        })),
      )
      .execute()
  }
  private async revokeUserSessions(tx: AnyDb, userId: string, reason: string) {
    await tx
      .updateTable('app_sessions')
      .set({ revoked_at: new Date(), revoked_reason: reason })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute()
  }
  private async assertCurrentActor(tx: AnyDb, principal: Principal) {
    const user = await tx
      .selectFrom('app_users')
      .select('status')
      .where('id', '=', principal.user.id)
      .executeTakeFirst()
    if (!user || user.status !== 'ENABLED')
      throw new AppServiceError('unauthenticated', 'session expired')
    const current = await this.permissionsFor(tx, principal.user.id)
    if (!principal.permissions.every((path) => current.includes(path)))
      throw new AppServiceError(
        'forbidden',
        'permissions changed; refresh session',
      )
  }
  private async ensureAuthorizationSafety(tx: AnyDb) {
    const protectedPaths = [
      '/app/user/query',
      '/app/user/get',
      '/app/role/query',
      '/app/role/get',
    ]
    const enabled = await tx
      .selectFrom('app_users')
      .select('id')
      .where('status', '=', 'ENABLED')
      .execute()
    for (const user of enabled) {
      const paths = await this.permissionsFor(tx, user.id)
      if (protectedPaths.every((path) => paths.includes(path))) return
    }
    throw new AppServiceError(
      'conflict',
      'last authorization administrator cannot be removed',
    )
  }
  private async audit(
    tx: AnyDb,
    eventType: string,
    actorUserId: string | null,
    targetType: string,
    targetId: string | null,
    requestId: string,
    summary: Record<string, unknown> = {},
  ) {
    await tx
      .insertInto('app_audit_events')
      .values({
        id: ulid(),
        event_type: eventType,
        actor_user_id: actorUserId,
        target_type: targetType,
        target_id: targetId,
        result: 'SUCCESS',
        request_id: requestId,
        summary: JSON.stringify(summary),
        created_by: actorUserId,
      })
      .execute()
  }
  private async userDetail(id: string, principal: Principal) {
    const user = await this.db
      .selectFrom('app_users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    if (!user) throw new AppServiceError('not_found', 'user not found')
    const roles = await this.db
      .selectFrom('app_user_roles as ur')
      .innerJoin('app_roles as r', 'r.id', 'ur.role_id')
      .select(['r.id', 'r.code', 'r.name', 'r.status'])
      .where('ur.user_id', '=', id)
      .orderBy('r.code', 'asc')
      .execute()
    const manageable = await this.userManageable(id, principal)
    return {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      status: user.status,
      system: id === systemUserId,
      createdAt: user.created_at.toISOString(),
      updatedAt: user.updated_at.toISOString(),
      revision: String(user.revision),
      manageable,
      passwordChangedAt: user.password_changed_at.toISOString(),
      roles: await Promise.all(
        roles.map(async (role) => ({
          id: role.id,
          code: role.code,
          name: role.name,
          status: role.status,
          type:
            role.code === superadminCode
              ? 'SUPERADMIN'
              : role.code === 'system'
                ? 'SYSTEM'
                : 'NORMAL',
          assignable: await this.roleManageable(role, principal, this.db),
        })),
      ),
      roleAssignmentEditable:
        manageable &&
        id !== principal.user.id &&
        principal.permissions.includes('/app/user/save') &&
        principal.permissions.includes('/app/role/query'),
    }
  }
  private async roleListItem(role: RoleRow, principal: Principal) {
    const manageable = await this.roleManageable(role, principal, this.db)
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      status: role.status,
      type:
        role.code === superadminCode
          ? 'SUPERADMIN'
          : role.code === 'system'
            ? 'SYSTEM'
            : 'NORMAL',
      revision: String(role.revision),
      manageable,
      assignable: manageable,
      availableActions: [
        principal.permissions.includes('/app/role/get') && 'VIEW',
        manageable &&
          principal.permissions.includes('/app/role/save') &&
          'EDIT',
        manageable &&
          role.status === 'DISABLED' &&
          principal.permissions.includes('/app/role/enable') &&
          'ENABLE',
        manageable &&
          role.status === 'ENABLED' &&
          principal.permissions.includes('/app/role/disable') &&
          'DISABLE',
      ].filter(Boolean),
    }
  }
  private async roleDetail(role: RoleRow, principal: Principal) {
    return {
      ...(await this.roleListItem(role, principal)),
      createdAt: role.created_at.toISOString(),
      updatedAt: role.updated_at.toISOString(),
      permissions:
        role.code === superadminCode
          ? await this.db
              .selectFrom('app_permissions')
              .select([
                'id',
                'path',
                'domain',
                'entity',
                'action',
                'description',
                'status',
              ])
              .where('status', '=', 'ENABLED')
              .orderBy('path', 'asc')
              .execute()
          : await this.rolePermissions(this.db, role.id, true),
    }
  }
  private async directRoleCount(permissionId: string) {
    const row = await this.db
      .selectFrom('app_role_permissions')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('permission_id', '=', permissionId)
      .executeTakeFirstOrThrow()
    return Number(row.count)
  }
  private parameterView(row: ParameterRow) {
    return {
      parameterKey: row.parameter_key,
      name: row.name,
      description: row.description,
      valueType: row.value_type,
      configuredValue: row.configured_value,
      defaultValue: row.default_value,
      editable: row.editable,
      constraints: row.constraints,
      revision: String(row.revision),
    }
  }
  private validateParameter(row: ParameterRow, value: string) {
    if (typeof value !== 'string')
      throw new AppServiceError('validation_failed', 'invalid parameter value')
    const constraints =
      typeof row.constraints === 'string'
        ? JSON.parse(row.constraints)
        : (row.constraints ?? {})
    if (
      constraints.minLength !== undefined &&
      [...value].length < constraints.minLength
    )
      throw new AppServiceError(
        'validation_failed',
        'parameter value is too short',
      )
    if (
      constraints.maxLength !== undefined &&
      [...value].length > constraints.maxLength
    )
      throw new AppServiceError(
        'validation_failed',
        'parameter value is too long',
      )
    if (row.value_type === 'INTEGER' && !/^-?\d+$/.test(value))
      throw new AppServiceError(
        'validation_failed',
        'invalid integer parameter',
      )
    if (row.value_type === 'DECIMAL' && !/^-?\d+(\.\d+)?$/.test(value))
      throw new AppServiceError(
        'validation_failed',
        'invalid decimal parameter',
      )
    if (row.value_type === 'BOOLEAN' && value !== 'true' && value !== 'false')
      throw new AppServiceError(
        'validation_failed',
        'invalid boolean parameter',
      )
  }
  private async nextRoleCode(tx: AnyDb) {
    const counter = await tx
      .selectFrom('app_role_code_counters')
      .select('next_value')
      .where('counter_key', '=', 'role')
      .forUpdate()
      .executeTakeFirst()
    const next = counter?.next_value ?? 1
    if (next > 9999)
      throw new AppServiceError('conflict', 'role code capacity exhausted')
    if (counter)
      await tx
        .updateTable('app_role_code_counters')
        .set({ next_value: next + 1 })
        .where('counter_key', '=', 'role')
        .execute()
    else
      await tx
        .insertInto('app_role_code_counters')
        .values({ counter_key: 'role', next_value: next + 1 })
        .execute()
    return `ROL-${String(next).padStart(4, '0')}`
  }
  private async routeCatalog(db: AnyDb = this.db) {
    const rows = await db
      .selectFrom('app_permissions')
      .select(['path', 'menu_group', 'menu_order', 'description'])
      .where('status', '=', 'ENABLED')
      .where('menu_order', 'is not', null)
      .where('menu_group', 'is not', null)
      .orderBy('menu_order', 'asc')
      .execute()
    const catalog = new Map<string, MenuRoute>(
      rows.map(
        (row) =>
          [
            row.path.replace(/^\//, '').replace(/\/query$/, ''),
            {
              routeKey: row.path.replace(/^\//, '').replace(/\/query$/, ''),
              routePath: `/${row.path.replace(/^\//, '').replace(/\/query$/, '')}`,
              permissionCode: row.path,
              displayName: row.description ?? row.path,
              group: row.menu_group!,
              order: row.menu_order!,
            },
          ] as const,
      ),
    )
    catalog.set('app/menu', {
      routeKey: 'app/menu',
      routePath: '/app/menu',
      permissionCode: '/app/menu/save-business',
      displayName: '菜单管理',
      group: '系统管理',
      order: 50,
    })
    return catalog
  }
  private menuTree(
    items: Array<{
      id: string
      parent_id: string | null
      item_type: string
      item_level: number
      sort_order: number
      display_name: string
      icon: string | null
      enabled: boolean
      route_key: string | null
      permission_code: string | null
    }>,
    catalog: Map<string, MenuRoute>,
  ): MenuItemView[] {
    return items
      .filter(
        (item) =>
          item.item_type === 'GROUP' ||
          (item.route_key !== null && catalog.has(item.route_key)),
      )
      .map((item) => {
        const route = item.route_key ? catalog.get(item.route_key) : undefined
        return {
          id: item.id,
          parentId: item.parent_id,
          type: item.item_type as MenuItemType,
          level: item.item_level,
          order: item.sort_order,
          displayName: item.display_name,
          icon: item.icon,
          enabled: item.enabled,
          routeKey: item.route_key,
          routePath: route?.routePath ?? null,
          permissionCode: route?.permissionCode ?? null,
        }
      })
  }
  private defaultMenu(catalog: Map<string, MenuRoute>): MenuItemView[] {
    const groups = new Map<string, { id: string; order: number }>()
    for (const route of catalog.values()) {
      const current = groups.get(route.group)
      if (!current || route.order < current.order)
        groups.set(route.group, {
          id: this.stableMenuId('group', route.group),
          order: route.order,
        })
    }
    const result: MenuItemView[] = [...groups.entries()].map(
      ([displayName, group]) => ({
        id: group.id,
        parentId: null,
        type: 'GROUP',
        level: 1,
        order: group.order,
        displayName,
        icon: null,
        enabled: true,
        routeKey: null,
        routePath: null,
        permissionCode: null,
      }),
    )
    for (const route of catalog.values()) {
      result.push({
        id: this.stableMenuId('route', route.routeKey),
        parentId: groups.get(route.group)!.id,
        type: 'ROUTE',
        level: 2,
        order: route.order,
        displayName: route.displayName,
        icon: null,
        enabled: true,
        routeKey: route.routeKey,
        routePath: route.routePath,
        permissionCode: route.permissionCode,
      })
    }
    return result.sort((left, right) => left.order - right.order)
  }
  private workbenchMenuItem(): MenuItemView {
    return {
      id: this.stableMenuId('route', 'home/dashboard'),
      parentId: null,
      type: 'ROUTE',
      level: 1,
      order: 0,
      displayName: '工作台',
      icon: null,
      enabled: true,
      routeKey: 'home/dashboard',
      routePath: '/home/dashboard',
      permissionCode: null,
    }
  }
  private filterMenu(
    items: MenuItemView[],
    permissions: string[],
  ): MenuItemView[] {
    const allowedRoutes = new Set(
      items
        .filter(
          (item) =>
            item.type === 'ROUTE' &&
            item.enabled &&
            item.permissionCode !== null &&
            permissions.includes(item.permissionCode),
        )
        .map((item) => item.id),
    )
    const visibleParents = new Set(
      items
        .filter((item) => allowedRoutes.has(item.id) && item.parentId !== null)
        .map((item) => item.parentId!),
    )
    return items.filter(
      (item) =>
        (item.type === 'GROUP' &&
          item.enabled &&
          visibleParents.has(item.id)) ||
        (item.type === 'ROUTE' &&
          allowedRoutes.has(item.id) &&
          (item.parentId === null || visibleParents.has(item.parentId))),
    )
  }
  private businessMenuItems(
    source: Array<Record<string, unknown>>,
    catalog: Map<string, MenuRoute>,
    actorId: string,
  ) {
    const ids = new Set<string>()
    const routeKeys = new Set<string>()
    return source.map((raw, index) => {
      const id = typeof raw.id === 'string' && raw.id ? raw.id : ulid()
      if (ids.has(id))
        throw new AppServiceError('validation_failed', 'duplicate menu item')
      ids.add(id)
      const type = raw.type
      const parentId = typeof raw.parentId === 'string' ? raw.parentId : null
      const routeKey = typeof raw.routeKey === 'string' ? raw.routeKey : null
      const displayName =
        typeof raw.displayName === 'string'
          ? this.displayName(raw.displayName)
          : ''
      if (type === 'GROUP') {
        if (parentId || routeKey)
          throw new AppServiceError('validation_failed', 'invalid menu group')
        return {
          id,
          parent_id: null,
          item_type: 'GROUP',
          item_level: 1,
          sort_order: index,
          display_name: displayName,
          icon: typeof raw.icon === 'string' ? raw.icon : null,
          enabled: raw.enabled !== false,
          route_key: null,
          permission_code: null,
          created_by: actorId,
          updated_by: actorId,
        }
      }
      const route = routeKey ? catalog.get(routeKey) : undefined
      if (
        type !== 'ROUTE' ||
        !route ||
        (parentId && !ids.has(parentId)) ||
        routeKeys.has(routeKey!)
      )
        throw new AppServiceError('validation_failed', 'invalid menu route')
      routeKeys.add(routeKey!)
      return {
        id,
        parent_id: parentId,
        item_type: 'ROUTE',
        item_level: parentId ? 2 : 1,
        sort_order: index,
        display_name: displayName,
        icon: typeof raw.icon === 'string' ? raw.icon : null,
        enabled: raw.enabled !== false,
        route_key: routeKey,
        permission_code: route.permissionCode,
        created_by: actorId,
        updated_by: actorId,
      }
    })
  }
  private defaultBusinessMenu(
    catalog: Map<string, MenuRoute>,
    actorId: string,
  ) {
    return this.defaultMenu(catalog).map((item) => ({
      id: item.id,
      parent_id: item.parentId,
      item_type: item.type,
      item_level: item.level,
      sort_order: item.order,
      display_name: item.displayName,
      icon: item.icon,
      enabled: item.enabled,
      route_key: item.routeKey,
      permission_code: item.permissionCode,
      created_by: actorId,
      updated_by: actorId,
    }))
  }
  private stableMenuId(prefix: string, value: string) {
    return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`
  }
  private async writeMenu(
    event: string,
    revisionInput: string | number,
    principal: Principal,
    requestId: string,
    write: (tx: AnyDb, catalog: Map<string, MenuRoute>) => Promise<void>,
  ) {
    const revision = this.revision(revisionInput)
    await this.db.transaction().execute(async (tx) => {
      await this.assertCurrentActor(tx, principal)
      const settings = await tx
        .selectFrom('app_menu_settings')
        .selectAll()
        .where('id', '=', 1)
        .forUpdate()
        .executeTakeFirst()
      if (!settings)
        throw new AppServiceError(
          'internal_error',
          'menu settings are unavailable',
        )
      if (BigInt(settings.revision) !== revision)
        throw new AppServiceError('conflict', 'menu revision conflict')
      await write(tx, await this.routeCatalog(tx))
      const result = await tx
        .updateTable('app_menu_settings')
        .set({
          revision: sql`revision + 1`,
          updated_at: new Date(),
          updated_by: principal.user.id,
        })
        .where('id', '=', 1)
        .where('revision', '=', String(revision))
        .executeTakeFirst()
      if (Number(result.numUpdatedRows) !== 1)
        throw new AppServiceError('conflict', 'menu revision conflict')
      await this.audit(tx, event, principal.user.id, 'menu', '1', requestId)
    })
    return this.getMenu(principal)
  }
}

function same(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
