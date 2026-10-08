import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { ulid } from 'ulid'
import { createDatabase } from '../src/db/database.ts'
import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { hashPassword } from '../src/app/session.ts'
import { seedStockFixture } from '../tests/fixtures/vou-stock.ts'
import { browserTopology } from './browser-topology.ts'

const { databaseUrl, apiOrigin, webOrigin } = browserTopology()
const db = createDatabase(databaseUrl)
try {
  // Prior registration belongs before opening approval. The general entry
  // fixture has already approved its opening and correctly freezes this seam.
  const fixture = await seedStockFixture(
    db,
    '2026-09',
    { quantity: '60', amount: '120.00' },
    false,
  )
  const password = randomBytes(24).toString('base64url')
  const creator = {
    userId: ulid(),
    roleId: ulid(),
    username: `prior-entry-${ulid()}`,
    passwordHash: await hashPassword(password),
  }
  await new TargetBootstrapService(db).createE2EPrincipal(creator, false, [
    '/vou/purchase-inbound/query',
    '/vou/purchase-inbound/get',
    '/vou/purchase-inbound/submit-new',
    '/bob/product/get',
  ])
  const archives = await db
    .selectFrom('bob_archive_objects')
    .select(['id', 'code'])
    .where('id', 'in', [fixture.rawId, fixture.supplierId])
    .execute()
  const codes = new Map(archives.map((row) => [row.id, row.code]))
  const warehouse = await db
    .selectFrom('aux_objects')
    .select('code')
    .where('id', '=', fixture.salePayload.warehouse.objectId)
    .executeTakeFirstOrThrow()
  const child = spawn(
    'pnpm',
    [
      '--filter',
      '@zerp/frontend',
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.target.config.ts',
      'vou-entry.spec.ts',
      '--grep',
      'independent prior receipt',
      ...process.argv.slice(2),
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        TARGET_WEB_BASE_URL: webOrigin,
        TARGET_API_BASE_URL: apiOrigin,
        TARGET_E2E_USERNAME: creator.username,
        TARGET_E2E_PASSWORD: password,
        TARGET_E2E_REVIEWER_USERNAME: fixture.reviewer.username,
        TARGET_E2E_REVIEWER_PASSWORD: fixture.reviewer.password,
        TARGET_E2E_CREATE_ONLY_USERNAME: fixture.noQuery.username,
        TARGET_E2E_CREATE_ONLY_PASSWORD: fixture.noQuery.password,
        TARGET_E2E_VOU_ENTRY_JSON: JSON.stringify({
          supplier: codes.get(fixture.supplierId),
          product: codes.get(fixture.rawId),
          warehouse: warehouse.code,
        }),
      },
    },
  )
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve)
    child.once('error', reject)
  })
  if (code !== 0) throw new Error('prior purchase browser checks failed')
} finally {
  await db.destroy()
}
