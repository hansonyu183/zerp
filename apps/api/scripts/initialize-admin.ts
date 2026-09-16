import { readFile } from 'node:fs/promises'

import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { createDatabase } from '../src/db/database.ts'
import { assertTargetDatabaseBoundary } from '../src/platform/config.ts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function credential(name: string): Promise<string> {
  const raw = await readFile(required(name), 'utf8')
  const value = raw.endsWith('\r\n')
    ? raw.slice(0, -2)
    : raw.endsWith('\n')
      ? raw.slice(0, -1)
      : raw
  if (!value || /[\r\n]/.test(value))
    throw new Error(`${name} must contain exactly one non-empty line`)
  return value
}

async function main(): Promise<void> {
  const databaseUrl = required('TARGET_DATABASE_URL')
  assertTargetDatabaseBoundary(databaseUrl, required('TARGET_DATABASE_SCOPE'))
  const users = await Promise.all(
    [1, 2].map(async (index) => ({
      username: required(`APP_ADMIN_${index}_USERNAME`),
      displayName: required(`APP_ADMIN_${index}_DISPLAY_NAME`),
      password: await credential(`APP_ADMIN_${index}_PASSWORD_FILE`),
    })),
  )
  const passwordMinLength = Number(process.env.APP_PASSWORD_MIN_LENGTH ?? '12')
  if (!Number.isSafeInteger(passwordMinLength) || passwordMinLength <= 0)
    throw new Error('APP_PASSWORD_MIN_LENGTH must be a positive integer')
  const database = createDatabase(databaseUrl)
  try {
    const result = await new TargetBootstrapService(
      database,
    ).initializeAdministrators(users, passwordMinLength)
    process.stdout.write(`formal administrator ${result}\n`)
  } finally {
    await database.destroy()
  }
}

try {
  await main()
} catch {
  // Driver and filesystem errors can contain connection details or secret paths.
  process.stderr.write(
    'formal administrator initialization failed; verify identity baseline, catalog and credential configuration\n',
  )
  process.exitCode = 1
}
