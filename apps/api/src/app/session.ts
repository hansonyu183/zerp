import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { argon2idAsync } from '@noble/hashes/argon2.js'
import type { Kysely, SelectQueryBuilder } from 'kysely'
import { sql } from 'kysely'
import { ulid } from 'ulid'

import type { DB } from '../db/generated.ts'

export interface TargetSessionConfig {
  sessionIdleTimeoutMs: number
  sessionAbsoluteTimeoutMs: number
  passwordMinLength: number
}

export class SessionError extends Error {
  readonly errorKey: 'unauthenticated' | 'forbidden'

  constructor(errorKey: 'unauthenticated' | 'forbidden') {
    super(errorKey)
    this.name = 'SessionError'
    this.errorKey = errorKey
  }
}

export interface UserQuery {
  page: number
  pageSize: 20
  filters?: { search?: string; status?: 'ENABLED' | 'DISABLED' }
  sort: [{ field: 'username'; order: 'asc' }]
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

function applyUserFilters<Output>(
  query: SelectQueryBuilder<DB, 'app_users', Output>,
  filters: UserQuery['filters'],
): SelectQueryBuilder<DB, 'app_users', Output> {
  let filtered = query
  if (filters?.search) {
    const search = `%${filters.search}%`
    filtered = filtered.where((builder) =>
      builder.or([
        builder('username', 'ilike', search),
        builder('display_name', 'ilike', search),
      ]),
    )
  }
  if (filters?.status) filtered = filtered.where('status', '=', filters.status)
  return filtered
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

async function verifyPassword(
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
        'u.password_change_required',
        'p.avatar_url',
      ])
      .where(sql`lower(u.username)`, '=', username.trim().toLowerCase())
      .executeTakeFirst()
    if (
      !user ||
      user.status !== 'ENABLED' ||
      !(await verifyPassword(user.password_hash, password))
    )
      throw new SessionError('unauthenticated')

    const token = randomToken()
    const csrfToken = csrfFor(token)
    const now = new Date()
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

  async queryUsers(input: UserQuery) {
    const { page, pageSize, filters } = input
    const itemsQuery = applyUserFilters(
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
        ]),
      filters,
    )
    const countQuery = applyUserFilters(
      this.db
        .selectFrom('app_users')
        .select((builder) => builder.fn.countAll<string>().as('count')),
      filters,
    )
    const [items, total] = await Promise.all([
      itemsQuery
        .orderBy('username', 'asc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
      countQuery.executeTakeFirstOrThrow(),
    ])
    return {
      items: items.map((item) => ({
        id: item.id,
        username: item.username,
        displayName: item.display_name,
        status: item.status as 'ENABLED' | 'DISABLED',
        system: item.id === '01JAPPSYST3MACTR0000000000',
        createdAt: item.created_at.toISOString(),
        updatedAt: item.updated_at.toISOString(),
        revision: String(item.revision),
        manageable: item.id !== '01JAPPSYST3MACTR0000000000',
      })),
      total: Number(total.count),
      page,
      pageSize,
    }
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
