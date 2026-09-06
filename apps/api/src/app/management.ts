import { randomBytes } from 'node:crypto'

import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import type { DB } from '../db/generated.ts'
import { AppServiceError, hashPassword, type Principal } from './session.ts'
import { userPinyin } from './user-pinyin.ts'

const systemUserId = '01JAPPSYST3MACTR0000000000'
const superadminCode = 'superadmin'
type Status = 'ENABLED' | 'DISABLED'
type UserAction = 'VIEW' | 'EDIT' | 'ENABLE' | 'DISABLE'
type AnyDb = Kysely<DB>
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

export interface PageInput {
  page: number
  pageSize: number
  filters?: Record<string, string | undefined>
  sort?: Array<{ field: string; order: 'asc' | 'desc' }>
}

export interface UserQueryInput {
  keyword: string
  page: number
  pageSize: 20
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

  async queryUsers(input: UserQueryInput, principal: Principal) {
    this.require(principal, '/app/user/query')
    const page = this.page(input, 20)
    const keyword = this.search(input.keyword)
    const pattern = `%${keyword
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_')}%`
    const matches = keyword
      ? sql<boolean>`(
          username ILIKE ${pattern} ESCAPE ${'\\'}
          OR py ILIKE ${pattern} ESCAPE ${'\\'}
          OR display_name ILIKE ${pattern} ESCAPE ${'\\'}
        )`
      : sql<boolean>`true`
    const [rows, count] = await Promise.all([
      this.db
        .selectFrom('app_users')
        .select(['id', 'username', 'display_name', 'py', 'status', 'revision'])
        .where(matches)
        .orderBy('username', 'asc')
        .orderBy('id', 'asc')
        .offset((page.page - 1) * page.pageSize)
        .limit(page.pageSize)
        .execute(),
      this.db
        .selectFrom('app_users')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where(matches)
        .executeTakeFirstOrThrow(),
    ])
    const items = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        code: row.username,
        py: row.py,
        name: row.display_name,
        enabled: row.status === 'ENABLED',
        revision: String(row.revision),
        availableActions: await this.userAvailableActions(row, principal),
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
      code: string
      name: string
      password: string
      roleIds: string[]
    },
    principal: Principal,
    requestId: string,
  ) {
    this.require(principal, '/app/user/create')
    this.require(principal, '/app/role/query')
    const username = this.username(input.code)
    const displayName = this.displayName(input.name)
    this.password(input.password)
    const roleIds = this.ids(input.roleIds, 'role')
    const id = ulid()
    return this.db.transaction().execute(async (tx) => {
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
          py: userPinyin(displayName),
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
      return this.userDetail(id, principal, tx)
    })
  }

  async saveUser(
    input: {
      id: string
      name: string
      roleIds: string[]
      revision: string
    },
    principal: Principal,
    requestId: string,
  ) {
    this.id(input.id)
    const displayName = this.displayName(input.name)
    const roleIds = this.ids(input.roleIds, 'role')
    const revision = this.revision(input.revision)
    return this.db.transaction().execute(async (tx) => {
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
      this.require(principal, '/app/user/save')
      if (self) {
        const existing = await this.roleIds(tx, target.id)
        if (!same(existing, roleIds))
          throw new AppServiceError('forbidden', 'cannot change own roles')
        await this.assertEnabledRoles(tx, roleIds)
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
          py: userPinyin(displayName),
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
      return this.userDetail(target.id, principal, tx)
    })
  }

  async setUserStatus(
    input: { id: string; revision: string },
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
    return this.db.transaction().execute(async (tx) => {
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
      if (target.status === status)
        throw new AppServiceError('conflict', 'user status is unchanged')
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
      return this.userDetail(target.id, principal, tx)
    })
  }

  async resetUserPassword(
    input: { id: string; revision: string },
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

  private require(principal: Principal, path: string) {
    if (!principal.apiPaths.includes(path))
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
  private search(value: string) {
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
        target.every((path) => principal.apiPaths.includes(path)))
    )
  }
  private async userAvailableActions(
    user: { id: string; status: string },
    principal: Principal,
    tx: AnyDb = this.db,
  ): Promise<UserAction[]> {
    const manageable = await this.userManageable(user.id, principal, tx)
    return [
      principal.apiPaths.includes('/app/user/get') && 'VIEW',
      manageable && principal.apiPaths.includes('/app/user/save') && 'EDIT',
      manageable &&
        user.id !== principal.user.id &&
        user.status === 'DISABLED' &&
        principal.apiPaths.includes('/app/user/enable') &&
        'ENABLE',
      manageable &&
        user.id !== principal.user.id &&
        user.status === 'ENABLED' &&
        principal.apiPaths.includes('/app/user/disable') &&
        'DISABLE',
    ].filter((action): action is UserAction => Boolean(action))
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
          principal.apiPaths.includes(permission.path),
        ))
    )
  }
  private async roleAssignable(
    role: Pick<RoleRow, 'id' | 'code' | 'status'>,
    principal: Principal,
    tx: AnyDb,
  ) {
    if (role.status !== 'ENABLED' || role.code === 'system') return false
    const actorSuperadmin = await this.isSuperadmin(tx, principal.user.id)
    if (role.code === superadminCode) return actorSuperadmin
    if (actorSuperadmin) return true
    const permissions = await this.rolePermissions(tx, role.id)
    return permissions.every((permission) =>
      principal.apiPaths.includes(permission.path),
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
          roles.map((role) => this.roleAssignable(role, principal, tx)),
        )
      ).every(Boolean)
    )
      throw new AppServiceError(
        'forbidden',
        'one or more roles cannot be assigned',
      )
  }
  private async assertEnabledRoles(tx: AnyDb, roleIds: string[]) {
    const roles = await tx
      .selectFrom('app_roles')
      .select(['id', 'status'])
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
        (permission) => !principal.apiPaths.includes(permission.path),
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
    if (!principal.apiPaths.every((path) => current.includes(path)))
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
  private async userDetail(
    id: string,
    principal: Principal,
    tx: AnyDb = this.db,
  ) {
    const user = await tx
      .selectFrom('app_users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    if (!user) throw new AppServiceError('not_found', 'user not found')
    const roles = await tx
      .selectFrom('app_user_roles as ur')
      .innerJoin('app_roles as r', 'r.id', 'ur.role_id')
      .select(['r.id', 'r.code', 'r.name', 'r.status'])
      .where('ur.user_id', '=', id)
      .orderBy('r.code', 'asc')
      .execute()
    const manageable = await this.userManageable(id, principal, tx)
    return {
      id: user.id,
      code: user.username,
      py: user.py,
      name: user.display_name,
      enabled: user.status === 'ENABLED',
      revision: String(user.revision),
      availableActions: await this.userAvailableActions(user, principal, tx),
      manageable,
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
          assignable: await this.roleAssignable(role, principal, tx),
        })),
      ),
      roleAssignmentEditable:
        manageable &&
        id !== principal.user.id &&
        principal.apiPaths.includes('/app/user/save') &&
        principal.apiPaths.includes('/app/role/query'),
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
      assignable: await this.roleAssignable(role, principal, this.db),
      availableActions: [
        principal.apiPaths.includes('/app/role/get') && 'VIEW',
        manageable && principal.apiPaths.includes('/app/role/save') && 'EDIT',
        manageable &&
          role.status === 'DISABLED' &&
          principal.apiPaths.includes('/app/role/enable') &&
          'ENABLE',
        manageable &&
          role.status === 'ENABLED' &&
          principal.apiPaths.includes('/app/role/disable') &&
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
}

function same(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
