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
      'online-test password does not meet the APP password policy',
    )
  return value
}

async function main(): Promise<void> {
  const databaseUrl = required('TARGET_DATABASE_URL')
  assertTargetDatabaseBoundary(databaseUrl, required('TARGET_DATABASE_SCOPE'))
  const [testAdminPassword, testerPassword] = await Promise.all([
    credential('APP_TEST_ADMIN_PASSWORD_FILE'),
    credential('APP_TESTER_PASSWORD_FILE'),
  ])
  const database = createDatabase(databaseUrl)
  try {
    const report = await new TargetBootstrapService(
      database,
    ).seedOnlineTestUsers([
      {
        username: 'test-admin',
        displayName: '测试管理员',
        password: password(testAdminPassword),
      },
      {
        username: 'tester',
        displayName: '测试用户',
        password: password(testerPassword),
      },
    ])
    process.stdout.write(
      `online-test users reconciled: test-admin, tester; created=${report.createdUsers}; updated=${report.updatedUsers}\n`,
    )
  } finally {
    await database.destroy()
  }
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`online-test user seed failed: ${message}\n`)
  process.exitCode = 1
}
