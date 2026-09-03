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
const userId = `T${suffix}`.toUpperCase().padEnd(26, '0')
const roleId = `R${suffix}`.toUpperCase().padEnd(26, '0')
const username = `target-${suffix}`
const password = randomBytes(24).toString('base64url')
const salt = randomBytes(16)
const hash = Buffer.from(
  await argon2idAsync(password, salt, { m: 64 * 1024, t: 3, p: 2, dkLen: 32 }),
).toString('base64url')
const passwordHash = `$argon2id$v=19$m=65536,t=3,p=2$${salt.toString('base64url')}$${hash}`
const database = createDatabase(databaseUrl)
const bootstrap = new TargetBootstrapService(database)
const principal = { userId, roleId, username, passwordHash }

try {
  await bootstrap.createE2EPrincipal(principal)

  const result = spawnSync('pnpm', ['--dir', 'frontend', 'test:target'], {
    cwd: resolve(import.meta.dirname, '../../..'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TARGET_E2E_USERNAME: username,
      TARGET_E2E_PASSWORD: password,
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  await bootstrap.deleteE2EPrincipal(principal)
  await database.destroy()
}
