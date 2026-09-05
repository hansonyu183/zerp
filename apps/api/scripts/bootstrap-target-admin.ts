import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { hashPassword } from '../src/app/session.ts'
import { createDatabase } from '../src/db/database.ts'
import { readTargetPermissionCatalog } from './target-artifacts.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function username(value: string): string {
  const normalized = value.trim().toLowerCase()
  if ([...normalized].length < 3 || [...normalized].length > 64)
    throw new Error('APP_BOOTSTRAP_USERNAME must contain 3 to 64 characters')
  return normalized
}

function displayName(value: string): string {
  const normalized = value.trim()
  if ([...normalized].length < 1 || [...normalized].length > 128)
    throw new Error(
      'APP_BOOTSTRAP_DISPLAY_NAME must contain 1 to 128 characters',
    )
  return normalized
}

function password(value: string): string {
  const configuredMinimum = Number.parseInt(
    process.env.APP_PASSWORD_MIN_LENGTH ?? '12',
    10,
  )
  if (!Number.isSafeInteger(configuredMinimum) || configuredMinimum <= 0)
    throw new Error('APP_PASSWORD_MIN_LENGTH must be a positive integer')
  if (
    [...value].length < configuredMinimum ||
    [...value].length > 256 ||
    !/[a-z]/.test(value) ||
    !/[A-Z]/.test(value) ||
    !/[0-9]/.test(value) ||
    !/[^A-Za-z0-9]/.test(value)
  )
    throw new Error(
      'APP_BOOTSTRAP_PASSWORD does not meet the APP password policy',
    )
  return value
}

async function main(): Promise<void> {
  const database = createDatabase(required('DATABASE_URL'))
  const bootstrapUsername = username(required('APP_BOOTSTRAP_USERNAME'))
  try {
    await new TargetBootstrapService(database).bootstrapInitialAdministrator(
      await readTargetPermissionCatalog(),
      {
        username: bootstrapUsername,
        displayName: displayName(required('APP_BOOTSTRAP_DISPLAY_NAME')),
        passwordHash: await hashPassword(
          password(required('APP_BOOTSTRAP_PASSWORD')),
        ),
      },
    )
    process.stdout.write(
      `initial target administrator created: ${bootstrapUsername}\n`,
    )
  } finally {
    await database.destroy()
  }
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`target administrator bootstrap failed: ${message}\n`)
  process.exitCode = 1
}
