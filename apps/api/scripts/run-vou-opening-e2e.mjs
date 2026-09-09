import { spawn } from 'node:child_process'
import { createDatabase } from '../src/db/database.ts'
import { seedOpeningFixture } from '../tests/fixtures/vou-opening.ts'
import { browserTopology } from './browser-topology.ts'
const { databaseUrl, apiOrigin, webOrigin } = browserTopology()
const db = createDatabase(databaseUrl)
try {
  const fixture = await seedOpeningFixture(db)
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
      'vou-opening.spec.ts',
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
        TARGET_E2E_OPENING_JSON: JSON.stringify({
          book: fixture.book,
          debit: fixture.debit,
          credit: fixture.credit,
        }),
      },
    },
  )
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve)
    child.once('error', reject)
  })
  if (code !== 0) throw new Error('VOU opening browser checks failed')
} finally {
  await db.destroy()
}
