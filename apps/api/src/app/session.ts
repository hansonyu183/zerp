import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { argon2idAsync } from '@noble/hashes/argon2.js'
import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import type { DB } from '../db/generated.ts'

export interface TargetSessionConfig {
  sessionIdleTimeoutMs: number
  sessionAbsoluteTimeoutMs: number
  passwordMinLength: number
  signinLockThreshold?: number
  signinLockDurationMs?: number
}

export type AppErrorKey =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'conflict'
  | 'not_found'
  | 'internal_error'
  | 'invalid_credentials'
  | 'account_disabled'
  | 'account_locked'
  | 'invalid_current_password'
  | 'user_changed'
  | 'role_changed'
  | 'role_name_exists'

export class AppServiceError extends Error {
  readonly errorKey: AppErrorKey

  constructor(errorKey: AppErrorKey, message: string = errorKey) {
    super(message)
    this.name = 'AppServiceError'
    this.errorKey = errorKey
  }
}

export class SessionError extends AppServiceError {
  declare readonly errorKey: 'unauthenticated' | 'forbidden'

  constructor(errorKey: 'unauthenticated' | 'forbidden') {
    super(errorKey)
    this.name = 'SessionError'
  }
}

export interface Principal {
  sessionId: string
  user: {
    id: string
    username: string
    displayName: string
    avatarUrl: string | null
  }
  csrfToken: string
  permissions: string[]
  passwordChangeRequired: boolean
  passwordMinLength: number
  absoluteExpiresAt: Date
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function csrfFor(token: string): string {
  return createHash('sha256')
    .update(`zerp-session-csrf:${token}`)
    .digest('base64url')
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function parsePassword(encoded: string) {
  const match = encoded.match(
    /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/,
  )
  if (!match) return null
  return {
    m: Number.parseInt(match[1] ?? '', 10),
    t: Number.parseInt(match[2] ?? '', 10),
    p: Number.parseInt(match[3] ?? '', 10),
    salt: Buffer.from(match[4] ?? '', 'base64url'),
    expected: Buffer.from(match[5] ?? '', 'base64url'),
  }
}

export async function verifyPassword(
  encoded: string,
  password: string,
): Promise<boolean> {
  const parsed = parsePassword(encoded)
  if (!parsed || parsed.m > 1_048_576 || parsed.t > 20 || parsed.p > 32)
    return false
  const actual = Buffer.from(
    await argon2idAsync(password, parsed.salt, {
      m: parsed.m,
      t: parsed.t,
      p: parsed.p,
      dkLen: parsed.expected.length,
    }),
  )
  return (
    actual.length === parsed.expected.length &&
    timingSafeEqual(actual, parsed.expected)
  )
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const encoded = Buffer.from(
    await argon2idAsync(password, salt, {
      m: 64 * 1024,
      t: 3,
      p: 2,
      dkLen: 32,
    }),
  ).toString('base64url')
  return `$argon2id$v=19$m=65536,t=3,p=2$${salt.toString('base64url')}$${encoded}`
}

function requirePassword(password: string, minimum: number) {
  if (
    [...password].length < minimum ||
    [...password].length > 256 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  )
    throw new AppServiceError('validation_failed', 'invalid password')
}

function normalizedProfile(input: {
  displayName: string
  avatarUrl?: string | null
}) {
  const displayName = input.displayName.trim()
  if ([...displayName].length < 1 || [...displayName].length > 128)
    throw new AppServiceError('validation_failed', 'invalid display name')
  const avatar = input.avatarUrl?.trim()
  if (!avatar) return { displayName, avatarUrl: null }
  if ([...avatar].length > 500)
    throw new AppServiceError('validation_failed', 'invalid avatar URL')
  let parsed: URL
  try {
    parsed = new URL(avatar)
  } catch {
    throw new AppServiceError('validation_failed', 'invalid avatar URL')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  )
    throw new AppServiceError('validation_failed', 'invalid avatar URL')
  return { displayName, avatarUrl: avatar }
}

export class SessionService {
  private readonly db: Kysely<DB>
  private readonly config: TargetSessionConfig

  constructor(db: Kysely<DB>, config: TargetSessionConfig) {
    this.db = db
    this.config = config
  }

  async signin(
    username: string,
    password: string,
  ): Promise<{ principal: Principal; token: string }> {
    const user = await this.db
      .selectFrom('app_users as u')
      .leftJoin('app_user_profiles as p', 'p.user_id', 'u.id')
      .select([
        'u.id',
        'u.username',
        'u.display_name',
        'u.password_hash',
        'u.status',
        'u.failed_signin_count',
        'u.locked_until',
        'u.password_change_required',
        'p.avatar_url',
      ])
      .where(sql`lower(u.username)`, '=', username.trim().toLowerCase())
      .executeTakeFirst()
    // Always perform an Argon2 calculation for an unknown username. The encoded
    // value is deliberately a valid fixed-cost hash, not a fast failure path.
    const dummyHash =
      '$argon2id$v=19$m=65536,t=3,p=2$MDEyMzQ1Njc4OWFiY2RlZg$Ct8UwrqzIvVSxY7FyBuOSRUQOp7sy1ORQOse7m2izYQ'
    const passwordOK = await verifyPassword(
      user?.password_hash ?? dummyHash,
      password,
    )
    const now = new Date()
    if (!user)
      throw new AppServiceError('invalid_credentials', '用户名或密码错误。')
    if (user.status !== 'ENABLED')
      throw new AppServiceError(
        'account_disabled',
        '账号已停用，请联系管理员。',
      )
    if (user.locked_until && user.locked_until > now)
      throw new AppServiceError(
        'account_locked',
        '账号已临时锁定，请稍后重试。',
      )
    if (!passwordOK) {
      const threshold = this.config.signinLockThreshold ?? 5
      const duration = this.config.signinLockDurationMs ?? 15 * 60 * 1000
      const failed = user.failed_signin_count + 1
      const lockedUntil =
        failed >= threshold ? new Date(now.getTime() + duration) : null
      await this.db
        .updateTable('app_users')
        .set({
          failed_signin_count: failed,
          locked_until: lockedUntil,
          updated_at: now,
        })
        .where('id', '=', user.id)
        .execute()
      if (lockedUntil)
        throw new AppServiceError(
          'account_locked',
          '账号已临时锁定，请稍后重试。',
        )
      throw new AppServiceError('invalid_credentials', '用户名或密码错误。')
    }
    if (user.failed_signin_count !== 0 || user.locked_until)
      await this.db
        .updateTable('app_users')
        .set({ failed_signin_count: 0, locked_until: null, updated_at: now })
        .where('id', '=', user.id)
        .execute()

    const token = randomToken()
    const csrfToken = csrfFor(token)
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.sessionAbsoluteTimeoutMs,
    )
    const idleExpiresAt = new Date(
      now.getTime() + this.config.sessionIdleTimeoutMs,
    )
    const sessionId = ulid()
    await this.db
      .insertInto('app_sessions')
      .values({
        id: sessionId,
        user_id: user.id,
        token_hash: hash(token),
        csrf_token_hash: hash(csrfToken),
        last_seen_at: now,
        idle_expires_at: idleExpiresAt,
        absolute_expires_at: absoluteExpiresAt,
      })
      .execute()
    const permissions = await this.permissions(user.id)
    return {
      token,
      principal: {
        sessionId,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
        },
        csrfToken,
        permissions,
        passwordChangeRequired: user.password_change_required,
        passwordMinLength: this.config.passwordMinLength,
        absoluteExpiresAt,
      },
    }
  }

  async authenticate(
    token: string | undefined,
    csrfToken: string | undefined,
    requiresCsrf: boolean,
    path?: string,
  ): Promise<Principal> {
    if (!token) throw new SessionError('unauthenticated')
    const row = await this.db
      .selectFrom('app_sessions as s')
      .innerJoin('app_users as u', 'u.id', 's.user_id')
      .leftJoin('app_user_profiles as p', 'p.user_id', 'u.id')
      .select([
        's.id as session_id',
        's.csrf_token_hash',
        's.idle_expires_at',
        's.absolute_expires_at',
        's.revoked_at',
        'u.id as user_id',
        'u.username',
        'u.display_name',
        'u.status',
        'u.password_change_required',
        'p.avatar_url',
      ])
      .where('s.token_hash', '=', hash(token))
      .executeTakeFirst()
    if (
      !row ||
      row.revoked_at ||
      row.status !== 'ENABLED' ||
      row.idle_expires_at <= new Date() ||
      row.absolute_expires_at <= new Date()
    )
      throw new SessionError('unauthenticated')
    const csrf = csrfFor(token)
    if (
      requiresCsrf &&
      (!csrfToken || !timingSafeEqual(hash(csrfToken), row.csrf_token_hash))
    )
      throw new SessionError('forbidden')
    if (
      row.password_change_required &&
      path &&
      ![
        '/app/user/session',
        '/app/user/signout',
        '/app/user/change-password',
      ].includes(path)
    )
      throw new SessionError('forbidden')
    const nextIdle = new Date(
      Math.min(
        Date.now() + this.config.sessionIdleTimeoutMs,
        row.absolute_expires_at.getTime(),
      ),
    )
    await this.db
      .updateTable('app_sessions')
      .set({ last_seen_at: new Date(), idle_expires_at: nextIdle })
      .where('id', '=', row.session_id)
      .execute()
    return {
      sessionId: row.session_id,
      user: {
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
      },
      csrfToken: csrf,
      permissions: await this.permissions(row.user_id),
      passwordChangeRequired: row.password_change_required,
      passwordMinLength: this.config.passwordMinLength,
      absoluteExpiresAt: row.absolute_expires_at,
    }
  }

  async signout(principal: Principal, requestId: string): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('app_sessions')
        .set({ revoked_at: new Date(), revoked_reason: 'signout' })
        .where('id', '=', principal.sessionId)
        .where('revoked_at', 'is', null)
        .execute()
      await this.audit(
        tx,
        'USER_SIGNOUT',
        principal.user.id,
        'session',
        principal.sessionId,
        requestId,
      )
    })
  }

  async getProfile(principal: Principal) {
    const row = await this.db
      .selectFrom('app_users as u')
      .leftJoin('app_user_profiles as p', 'p.user_id', 'u.id')
      .select([
        'u.id',
        'u.username',
        'u.display_name',
        'u.password_changed_at',
        'u.revision',
        'p.avatar_url',
      ])
      .where('u.id', '=', principal.user.id)
      .where('u.status', '=', 'ENABLED')
      .executeTakeFirst()
    if (!row) throw new SessionError('unauthenticated')
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      passwordChangedAt: row.password_changed_at.toISOString(),
      revision: String(row.revision),
    }
  }

  async saveProfile(
    principal: Principal,
    input: { displayName: string; avatarUrl?: string | null },
    requestId: string,
  ) {
    const profile = normalizedProfile(input)
    return this.db.transaction().execute(async (tx) => {
      const current = await tx
        .selectFrom('app_users')
        .select([
          'id',
          'username',
          'display_name',
          'password_changed_at',
          'revision',
        ])
        .where('id', '=', principal.user.id)
        .where('status', '=', 'ENABLED')
        .forUpdate()
        .executeTakeFirst()
      if (!current) throw new SessionError('unauthenticated')
      const stored = await tx
        .selectFrom('app_user_profiles')
        .select('avatar_url')
        .where('user_id', '=', current.id)
        .executeTakeFirst()
      if (current.display_name !== profile.displayName)
        await tx
          .updateTable('app_users')
          .set({
            display_name: profile.displayName,
            updated_at: new Date(),
            updated_by: current.id,
            revision: sql`revision + 1`,
          })
          .where('id', '=', current.id)
          .execute()
      if (profile.avatarUrl === null && stored)
        await tx
          .deleteFrom('app_user_profiles')
          .where('user_id', '=', current.id)
          .execute()
      if (
        profile.avatarUrl !== null &&
        stored?.avatar_url !== profile.avatarUrl
      )
        await tx
          .insertInto('app_user_profiles')
          .values({
            user_id: current.id,
            avatar_url: profile.avatarUrl,
            updated_by: current.id,
          })
          .onConflict((oc) =>
            oc.column('user_id').doUpdateSet({
              avatar_url: profile.avatarUrl,
              updated_at: new Date(),
              updated_by: current.id,
            }),
          )
          .execute()
      if (
        current.display_name !== profile.displayName ||
        stored?.avatar_url !== profile.avatarUrl
      )
        await this.audit(
          tx,
          'USER_PROFILE_SAVE',
          current.id,
          'user',
          current.id,
          requestId,
          {
            displayNameChanged: current.display_name !== profile.displayName,
            avatarChanged: stored?.avatar_url !== profile.avatarUrl,
          },
        )
      const changed =
        current.display_name === profile.displayName
          ? current.revision
          : BigInt(current.revision) + 1n
      return {
        id: current.id,
        username: current.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        passwordChangedAt: current.password_changed_at.toISOString(),
        revision: String(changed),
      }
    })
  }

  async changePassword(
    principal: Principal,
    input: { currentPassword: string; newPassword: string },
    requestId: string,
  ): Promise<void> {
    if (!input.currentPassword || input.currentPassword.length > 1024)
      throw new AppServiceError(
        'invalid_current_password',
        'current password is incorrect',
      )
    requirePassword(input.newPassword, this.config.passwordMinLength)
    await this.db.transaction().execute(async (tx) => {
      const user = await tx
        .selectFrom('app_users')
        .select(['id', 'password_hash'])
        .where('id', '=', principal.user.id)
        .where('status', '=', 'ENABLED')
        .forUpdate()
        .executeTakeFirst()
      if (!user) throw new SessionError('unauthenticated')
      if (!(await verifyPassword(user.password_hash, input.currentPassword)))
        throw new AppServiceError(
          'invalid_current_password',
          'current password is incorrect',
        )
      if (await verifyPassword(user.password_hash, input.newPassword))
        throw new AppServiceError(
          'validation_failed',
          'new password must differ from current password',
        )
      await tx
        .updateTable('app_users')
        .set({
          password_hash: await hashPassword(input.newPassword),
          password_change_required: false,
          password_changed_at: new Date(),
          updated_at: new Date(),
          updated_by: user.id,
          revision: sql`revision + 1`,
        })
        .where('id', '=', user.id)
        .execute()
      await tx
        .updateTable('app_sessions')
        .set({ revoked_at: new Date(), revoked_reason: 'password_changed' })
        .where('user_id', '=', user.id)
        .where('revoked_at', 'is', null)
        .execute()
      await this.audit(
        tx,
        'USER_CHANGE_PASSWORD',
        user.id,
        'user',
        user.id,
        requestId,
      )
    })
  }

  private async audit(
    db: Kysely<DB> | Transaction<DB>,
    eventType: string,
    actorUserId: string | null,
    targetType: string,
    targetId: string | null,
    requestId: string,
    summary: Record<string, unknown> = {},
  ) {
    await db
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

  private async permissions(userId: string): Promise<string[]> {
    const result = await sql<{ path: string }>`
      SELECT p.path FROM app_permissions p WHERE p.status='ENABLED' AND (
        EXISTS (SELECT 1 FROM app_user_roles ur JOIN app_roles r ON r.id=ur.role_id AND r.status='ENABLED' WHERE ur.user_id=${userId} AND r.code='superadmin')
        OR EXISTS (SELECT 1 FROM app_user_roles ur JOIN app_roles r ON r.id=ur.role_id AND r.status='ENABLED' JOIN app_role_permissions rp ON rp.role_id=r.id WHERE ur.user_id=${userId} AND rp.permission_id=p.id)
      ) ORDER BY p.path`.execute(this.db)
    return result.rows.map((row) => row.path)
  }
}
