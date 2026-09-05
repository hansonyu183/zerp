const defaultHttpAddress = '0.0.0.0:8080'

export type TargetDatabaseScope = 'isolated' | 'production'

export interface TargetConfig {
  databaseUrl: URL
  databaseScope: TargetDatabaseScope
  httpAddress: string
  corsAllowedOrigins: string[]
  bodyLimitBytes: number
  sessionCookieName: string
  sessionCookieSecure: boolean
  sessionCookieSameSite: 'lax' | 'strict' | 'none'
  sessionIdleTimeoutMs: number
  sessionAbsoluteTimeoutMs: number
  passwordMinLength: number
  shutdownTimeoutMs: number
  attachmentStorageRoot: string
}

type Environment = Record<string, string | undefined>

function splitOrigins(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
}

function boolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value.trim() === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function durationMilliseconds(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === '') return fallback
  if (!/^\d+(ms|s|m|h)$/.test(value))
    throw new Error(`${name} must be a positive duration`)
  const unit = value.match(/[a-z]+$/)?.[0]
  const number = Number.parseInt(value, 10)
  if (number <= 0) throw new Error(`${name} must be a positive duration`)
  const multiplier =
    unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : 3_600_000
  return number * multiplier
}

export function targetDatabaseScope(
  value: string | undefined,
): TargetDatabaseScope {
  const scope = (value ?? 'isolated').toLowerCase()
  if (scope === 'isolated' || scope === 'production') return scope
  throw new Error('TARGET_DATABASE_SCOPE must be isolated or production')
}

export function assertTargetDatabaseBoundary(
  databaseUrl: string,
  scopeValue: string | undefined,
): TargetDatabaseScope {
  const scope = targetDatabaseScope(scopeValue)
  const databaseName = new URL(databaseUrl).pathname.slice(1)
  if (scope === 'isolated' && !databaseName.endsWith('_test')) {
    throw new Error(
      'isolated target runtime requires a disposable DATABASE_URL whose database name ends in _test',
    )
  }
  return scope
}

export function loadConfig(
  environment: Environment = process.env,
): TargetConfig {
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const databaseUrl = new URL(environment.DATABASE_URL)
  const scope = assertTargetDatabaseBoundary(
    databaseUrl.toString(),
    environment.TARGET_DATABASE_SCOPE,
  )

  const sessionCookieSameSite = (
    environment.APP_SESSION_COOKIE_SAME_SITE ?? 'lax'
  ).toLowerCase()
  if (!['lax', 'strict', 'none'].includes(sessionCookieSameSite)) {
    throw new Error('APP_SESSION_COOKIE_SAME_SITE must be lax, strict, or none')
  }
  const sessionCookieSecure = boolean(
    environment.APP_SESSION_COOKIE_SECURE,
    false,
    'APP_SESSION_COOKIE_SECURE',
  )
  if (sessionCookieSameSite === 'none' && !sessionCookieSecure) {
    throw new Error(
      'APP_SESSION_COOKIE_SECURE must be true when APP_SESSION_COOKIE_SAME_SITE is none',
    )
  }

  const bodyLimitBytes = Number.parseInt(
    environment.HTTP_BODY_LIMIT_BYTES ?? '1048576',
    10,
  )
  if (!Number.isSafeInteger(bodyLimitBytes) || bodyLimitBytes <= 0) {
    throw new Error('HTTP_BODY_LIMIT_BYTES must be a positive integer')
  }
  const passwordMinLength = Number.parseInt(
    environment.APP_PASSWORD_MIN_LENGTH ?? '12',
    10,
  )
  if (!Number.isSafeInteger(passwordMinLength) || passwordMinLength <= 0) {
    throw new Error('APP_PASSWORD_MIN_LENGTH must be a positive integer')
  }

  return {
    databaseUrl,
    databaseScope: scope,
    httpAddress: environment.HTTP_ADDRESS ?? defaultHttpAddress,
    corsAllowedOrigins: splitOrigins(environment.CORS_ALLOWED_ORIGINS),
    bodyLimitBytes,
    sessionCookieName:
      environment.APP_SESSION_COOKIE_NAME ?? 'zerp_target_session',
    sessionCookieSecure,
    sessionCookieSameSite:
      sessionCookieSameSite as TargetConfig['sessionCookieSameSite'],
    sessionIdleTimeoutMs: durationMilliseconds(
      environment.APP_SESSION_IDLE_TIMEOUT,
      1_800_000,
      'APP_SESSION_IDLE_TIMEOUT',
    ),
    sessionAbsoluteTimeoutMs: durationMilliseconds(
      environment.APP_SESSION_ABSOLUTE_TIMEOUT,
      43_200_000,
      'APP_SESSION_ABSOLUTE_TIMEOUT',
    ),
    passwordMinLength,
    shutdownTimeoutMs: durationMilliseconds(
      environment.SHUTDOWN_TIMEOUT,
      10_000,
      'SHUTDOWN_TIMEOUT',
    ),
    attachmentStorageRoot:
      environment.ATTACHMENT_STORAGE_ROOT ?? '/var/lib/zerp/attachments',
  }
}
