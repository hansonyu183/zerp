import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { argon2idAsync } from '@noble/hashes/argon2.js'

import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { createDatabase } from '../src/db/database.ts'

const databaseUrl = process.env.TARGET_DATABASE_URL
if (!databaseUrl)
  throw new Error('TARGET_DATABASE_URL is required for target E2E')
if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test'))
  throw new Error('target E2E only accepts a disposable *_test database')

const suffix = randomBytes(8).toString('hex')
async function principal(kind: 'submitter' | 'reviewer', index: number) {
  const password = randomBytes(24).toString('base64url')
  const salt = randomBytes(16)
  const hash = Buffer.from(
    await argon2idAsync(password, salt, {
      m: 64 * 1024,
      t: 3,
      p: 2,
      dkLen: 32,
    }),
  ).toString('base64url')
  return {
    userId: `T${index}${suffix}`.toUpperCase().padEnd(26, '0').slice(0, 26),
    roleId: `R${index}${suffix}`.toUpperCase().padEnd(26, '0').slice(0, 26),
    username: `target-${kind}-${suffix}`,
    password,
    passwordHash: `$argon2id$v=19$m=65536,t=3,p=2$${salt.toString('base64url')}$${hash}`,
  }
}
const database = createDatabase(databaseUrl)
const bootstrap = new TargetBootstrapService(database)
const submitter = await principal('submitter', 1)
const reviewer = await principal('reviewer', 2)
const managerEmployeeId = `M${suffix}`
  .toUpperCase()
  .padEnd(26, '0')
  .slice(0, 26)
const managerApprovalEntryId = `A${suffix}`
  .toUpperCase()
  .padEnd(26, '0')
  .slice(0, 26)
const staleManagerApprovalEntryId = `S${suffix}`
  .toUpperCase()
  .padEnd(26, '0')
  .slice(0, 26)

try {
  await bootstrap.createE2EPrincipal(submitter)
  await bootstrap.createE2EPrincipal(reviewer)
  await bootstrap.createE2EManagerReference({
    employeeId: managerEmployeeId,
    latestApprovedEntryId: managerApprovalEntryId,
    code: 'EMP-E2E',
    name: '目标负责人',
    enabled: true,
  })

  const result = spawnSync('pnpm', ['--dir', 'frontend', 'test:target'], {
    cwd: resolve(import.meta.dirname, '../../..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TARGET_E2E_USERNAME: submitter.username,
      TARGET_E2E_PASSWORD: submitter.password,
      TARGET_E2E_REVIEWER_USERNAME: reviewer.username,
      TARGET_E2E_REVIEWER_PASSWORD: reviewer.password,
      TARGET_E2E_MANAGER_EMPLOYEE_ID: managerEmployeeId,
      TARGET_E2E_MANAGER_APPROVAL_ENTRY_ID: managerApprovalEntryId,
      TARGET_E2E_STALE_MANAGER_APPROVAL_ENTRY_ID: staleManagerApprovalEntryId,
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  await bootstrap.deleteE2EWarehouseFixtures(submitter.userId)
  await bootstrap.deleteE2EManagerReference(managerEmployeeId)
  await bootstrap.deleteE2EPrincipal(reviewer)
  await bootstrap.deleteE2EPrincipal(submitter)
  await database.destroy()
}
