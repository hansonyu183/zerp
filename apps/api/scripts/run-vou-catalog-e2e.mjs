import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { createApp } from '../src/app.ts'
import { SessionService } from '../src/app/session.ts'
import { BobService } from '../src/bob/service.ts'
import { loadConfig } from '../src/platform/config.ts'
import { seedVouCatalogFixture } from '../tests/fixtures/vou-catalog.ts'
import { withWflDatabase } from '../tests/integration/wfl-fixture.ts'

const frontend = new URL('../../../frontend/', import.meta.url)
const frontendRequire = createRequire(new URL('package.json', frontend))
const { createServer } = await import(frontendRequire.resolve('vite'))

// The caller supplies the authorized database. The existing fixture transaction
// rolls back every test fact; shared services and schema are left in place.
await withWflDatabase(async (db) => {
  const fixture = await seedVouCatalogFixture(db)
  const config = loadConfig({
    DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL,
    TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const origins = []
  const app = createApp({
    config,
    session: new SessionService(db, config),
    bob: new BobService(db),
    vou: fixture.vou,
    corsAllowedOrigins: origins,
  })
  let api
  let vite
  try {
    await new Promise((resolve) => {
      api = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () =>
        resolve(),
      )
    })
    const address = api.address()
    if (!address || typeof address === 'string')
      throw new Error('API did not bind TCP')
    const apiOrigin = `http://127.0.0.1:${address.port}`
    process.env.VITE_TARGET_API_BASE_URL = apiOrigin
    vite = await createServer({
      root: fileURLToPath(frontend),
      configFile: fileURLToPath(new URL('vite.target.config.ts', frontend)),
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'error',
    })
    await vite.listen()
    const webAddress = vite.httpServer?.address()
    if (!webAddress || typeof webAddress === 'string')
      throw new Error('Web did not bind TCP')
    const webOrigin = `http://127.0.0.1:${webAddress.port}`
    origins.push(webOrigin)
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
    try {
      if (vite) await vite.close()
    } finally {
      if (api)
        await new Promise((resolve, reject) =>
          api.close((error) => (error ? reject(error) : resolve())),
        )
    }
  }
})
console.log(
  'VOU catalog browser checks completed; temporary API/Web closed and fixture rolled back',
)
