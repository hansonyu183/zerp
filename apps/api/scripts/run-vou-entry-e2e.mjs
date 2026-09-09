import { randomBytes } from 'node:crypto'
import { ulid } from 'ulid'
import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { hashPassword } from '../src/app/session.ts'
import { spawn } from 'node:child_process'
import { createDatabase } from '../src/db/database.ts'
import { seedVouCatalogFixture } from '../tests/fixtures/vou-catalog.ts'

if (
  process.env.TARGET_DATABASE_SCOPE !== 'isolated' ||
  !new URL(process.env.TARGET_TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error('browser E2E requires an isolated disposable *_test database')
const apiOrigin = process.env.TARGET_API_BASE_URL
const webOrigin = process.env.TARGET_WEB_BASE_URL
for (const origin of [apiOrigin, webOrigin]) {
  if (!origin || new URL(origin).hostname !== '127.0.0.1')
    throw new Error(
      'browser E2E requires explicit loopback Compose API/Web URLs',
    )
}
// Seed through domain services into the caller-owned disposable Compose database.
// The caller destroys the entire isolated Compose environment after verification.
const db = createDatabase(process.env.TARGET_TEST_DATABASE_URL)
try {
  const fixture = await seedVouCatalogFixture(db)
  for (const entity of ['sale-return', 'purchase-return']) {
    const row = fixture.documents[entity]
    await fixture.vou.delete(
      entity,
      {
        documentId: row.documentId,
        submissionId: row.submissionId,
        expectedRevision: row.revision,
      },
      fixture.actor,
      'entry-release-source',
    )
  }
  const purchaseId = ulid(),
    purchaseEntryId = ulid()
  const purchasePayload = structuredClone(fixture.purchase.payload)
  purchasePayload.productLines[0].enteredQuantity = '10'
  purchasePayload.productLines[0].baseQuantity = '10'
  const purchase = await fixture.vou.submit(
    'purchase-order',
    'submit-new',
    {
      documentId: purchaseId,
      submissionId: purchaseEntryId,
      idempotencyKey: purchaseEntryId,
      expectedRevision: null,
      payload: purchasePayload,
    },
    fixture.actor,
    'entry-purchase-source',
  )
  await fixture.vou.review(
    'purchase-order',
    'approve',
    {
      documentId: purchaseId,
      submissionId: purchaseEntryId,
      expectedRevision: purchase.revision,
    },
    fixture.reviewerActor,
    'entry-purchase-source',
  )
  const password = randomBytes(24).toString('base64url')
  const creator = {
    userId: ulid(),
    roleId: ulid(),
    username: `entry-${ulid()}`,
    password,
    passwordHash: await hashPassword(password),
  }
  await new TargetBootstrapService(db).createE2EPrincipal(creator, false)
  const productRows = await db
    .selectFrom('bob_subjects')
    .select(['id', 'code'])
    .where('id', 'in', [
      fixture.references.archiveSubjectIds[1],
      fixture.productId,
      fixture.supplierId,
    ])
    .execute()
  const codes = Object.fromEntries(productRows.map((row) => [row.id, row.code]))
  const entryFacts = {
    warehouse: fixture.references.warehouseCode,
    supplier: codes[fixture.supplierId],
    product: codes[fixture.references.archiveSubjectIds[1]],
    finished: codes[fixture.productId],
    sources: {
      'purchase-inbound': purchase.documentNo,
      'sale-return': fixture.documents['sale-signoff'].documentNo,
      'purchase-return': fixture.documents['purchase-inbound'].documentNo,
      'order-production': fixture.productionOrder.documentNo,
    },
  }
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
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        TARGET_WEB_BASE_URL: webOrigin,
        TARGET_API_BASE_URL: apiOrigin,
        TARGET_E2E_USERNAME: creator.username,
        TARGET_E2E_PASSWORD: creator.password,
        TARGET_E2E_REVIEWER_USERNAME: fixture.reviewer.username,
        TARGET_E2E_REVIEWER_PASSWORD: fixture.reviewer.password,
        TARGET_E2E_CREATE_ONLY_USERNAME: fixture.noQuery.username,
        TARGET_E2E_CREATE_ONLY_PASSWORD: fixture.noQuery.password,
        TARGET_E2E_VOU_ENTRY_JSON: JSON.stringify(entryFacts),
      },
    },
  )
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve)
    child.once('error', reject)
  })
  if (code !== 0) throw new Error('VOU entry browser checks failed')
} finally {
  await db.destroy()
}
console.log('VOU entry browser checks completed; fixture connection closed')
