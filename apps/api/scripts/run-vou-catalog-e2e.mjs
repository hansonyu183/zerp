import { spawn } from 'node:child_process'
import { createDatabase } from '../src/db/database.ts'
import { seedVouCatalogFixture } from '../tests/fixtures/vou-catalog.ts'
import { browserTopology } from './browser-topology.ts'
const { databaseUrl, apiOrigin, webOrigin } = browserTopology()
const db = createDatabase(databaseUrl)
try {
  const fixture = await seedVouCatalogFixture(db)
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
      'vou-catalog.spec.ts',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        TARGET_WEB_BASE_URL: webOrigin,
        TARGET_API_BASE_URL: apiOrigin,
        TARGET_E2E_USERNAME: fixture.submitter.username,
        TARGET_E2E_PASSWORD: fixture.submitter.password,
        TARGET_E2E_REVIEWER_USERNAME: fixture.reviewer.username,
        TARGET_E2E_REVIEWER_PASSWORD: fixture.reviewer.password,
        TARGET_E2E_CREATE_ONLY_USERNAME: fixture.noQuery.username,
        TARGET_E2E_CREATE_ONLY_PASSWORD: fixture.noQuery.password,
        TARGET_E2E_VOU_CATALOG_JSON: JSON.stringify(
          Object.fromEntries(
            Object.entries(fixture.documents).map(([entity, document]) => [
              entity,
              {
                documentId: document.documentId,
                documentNo: document.documentNo,
              },
            ]),
          ),
        ),
      },
    },
  )
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve)
    child.once('error', reject)
  })
  if (code !== 0) throw new Error('VOU catalog browser checks failed')
} finally {
  await db.destroy()
}
