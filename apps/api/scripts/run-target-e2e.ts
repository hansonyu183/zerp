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
const fixtureId = (prefix: string, index: number) =>
  `${prefix}${index}${suffix}`.toUpperCase().padEnd(26, '0').slice(0, 26)
const fixtureCode = (prefix: string) =>
  `${prefix}-${suffix.slice(0, 8)}`.toUpperCase()
const auxCode = (prefix: string) =>
  `${prefix}-${(Number.parseInt(suffix.slice(0, 8), 16) % 10_000)
    .toString()
    .padStart(4, '0')}`
const archiveFacts = {
  createdBy: submitter.userId,
  auxObjects: [
    {
      id: fixtureId('X', 1),
      entity: 'dictionary-item' as const,
      code: auxCode('DIT'),
      data: { name: '目标厢式货车' },
    },
    {
      id: fixtureId('X', 2),
      entity: 'product-type' as const,
      code: auxCode('PTY'),
      data: { name: '目标产成品', behaviorProfile: 'STANDARD_FINISHED' },
    },
    {
      id: fixtureId('X', 3),
      entity: 'product-category' as const,
      code: auxCode('PCT'),
      data: { name: '目标商品分类' },
    },
    {
      id: fixtureId('X', 4),
      entity: 'measurement-unit' as const,
      code: auxCode('UNT'),
      data: { name: '目标件', quantityScale: 0 },
    },
    {
      id: fixtureId('X', 5),
      entity: 'employee-category' as const,
      code: auxCode('EMC'),
      data: { name: '目标正式员工' },
    },
    {
      id: fixtureId('X', 6),
      entity: 'department' as const,
      code: auxCode('DEP'),
      data: { name: '目标业务部' },
    },
    {
      id: fixtureId('X', 7),
      entity: 'position' as const,
      code: auxCode('POS'),
      data: { name: '目标业务员' },
    },
  ],
  accounting: {
    book: {
      id: fixtureId('B', 1),
      code: fixtureCode('BOOK'),
      name: '目标账簿',
    },
    vouEntity: {
      id: fixtureId('V', 1),
      code: fixtureCode('SALE'),
      name: '目标销售凭证',
      fieldCatalog: {
        headerFields: ['status'],
        lineFields: ['amount', 'currency'],
      },
    },
    subjects: [
      {
        id: fixtureId('C', 1),
        code: fixtureCode('1001'),
        name: '目标库存商品',
        leaf: true,
        requiredDimensions: [],
      },
      {
        id: fixtureId('C', 2),
        code: fixtureCode('6001'),
        name: '目标主营业务收入',
        leaf: true,
        requiredDimensions: [],
      },
    ],
  },
}

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
  await bootstrap.createE2EArchiveFacts(archiveFacts)

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
      TARGET_E2E_AUX_FACTS_JSON: JSON.stringify(archiveFacts.auxObjects),
      TARGET_E2E_ACC_FACTS_JSON: JSON.stringify(archiveFacts.accounting),
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  await bootstrap.deleteE2EWarehouseFixtures(submitter.userId)
  await bootstrap.deleteE2EArchiveFacts(archiveFacts)
  await bootstrap.deleteE2EManagerReference(managerEmployeeId)
  await bootstrap.deleteE2EPrincipal(reviewer)
  await bootstrap.deleteE2EPrincipal(submitter)
  await database.destroy()
}
