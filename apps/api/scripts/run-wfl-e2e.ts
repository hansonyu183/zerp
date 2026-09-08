import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  withWflDatabase,
  seedSaleOrderReferences,
  saleOrderPayload,
  sourceOrderLineId,
} from '../tests/integration/wfl-fixture.ts'
import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { hashPassword, SessionService } from '../src/app/session.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/platform/config.ts'
import { WflService, type WflVouPort } from '../src/wfl/service.ts'
import { VouService } from '../src/vou/service.ts'
import { AuxService } from '../src/aux/service.ts'
import { BobArchiveService } from '../src/bob/archives.ts'
const require = createRequire(new URL('../package.json', import.meta.url))
const frontRequire = createRequire(
  new URL('../../../frontend/package.json', import.meta.url),
)
const { ulid } = require('ulid'),
  { serve } = require('@hono/node-server')
const { createNodeWflStarlark } = require('@zerp/wfl-starlark/node')
const { createServer } = await import(frontRequire.resolve('vite'))
if (!new URL(process.env.TARGET_TEST_DATABASE_URL!).pathname.endsWith('_test'))
  throw new Error('WFL E2E requires a disposable *_test database')
await withWflDatabase(async (db) => {
  const bootstrap = new TargetBootstrapService(db)
  const paths = (
    await db
      .selectFrom('app_permissions')
      .select('path')
      .where('domain', 'in', ['wfl', 'vou'])
      .execute()
  ).map((p) => p.path)
  async function principal() {
    const password = randomBytes(20).toString('base64url')
    const value = {
      userId: ulid(),
      roleId: ulid(),
      username: `wfl-browser-${ulid()}`,
      password,
      passwordHash: await hashPassword(password),
    }
    await bootstrap.createE2EPrincipal(value, false, paths)
    return value
  }
  const owner = await principal(),
    reviewer = await principal()
  const runtime = await createNodeWflStarlark()
  let vou: VouService
  const port: WflVouPort = {
    createChild: (...a) => vou.createChild(...a),
    approveChild: (...a) => vou.approveChild(...a),
    rejectChild: (...a) => vou.rejectChild(...a),
    retryChild: (...a) => vou.retryChild(...a),
    cancelChild: (...a) => vou.cancelChild(...a),
  }
  const wfl = new WflService(db, runtime, port)
  vou = new VouService(db, {
    wfl,
    acc: {
      async apply() {},
      async partyBalance() {
        return 0n
      },
      async customerCreditOccupancy() {
        return 0n
      },
    },
  })
  const refs = await seedSaleOrderReferences(
    new BobArchiveService(db),
    new AuxService(db),
    owner.userId,
    reviewer.userId,
  )
  const documentId = ulid(),
    submissionId = ulid()
  await vou.submit(
    'sale-order',
    'submit-new',
    {
      documentId,
      submissionId,
      idempotencyKey: submissionId,
      expectedRevision: null,
      payload: saleOrderPayload(refs),
    },
    { id: owner.userId, permissions: [], trusted: true },
    'browser-root',
  )
  const origins: string[] = []
  const config = loadConfig({
    DATABASE_URL: process.env.TARGET_TEST_DATABASE_URL!,
    TARGET_DATABASE_SCOPE: process.env.TARGET_DATABASE_SCOPE,
    APP_SESSION_COOKIE_SECURE: 'false',
  })
  const app = createApp({
    config,
    session: new SessionService(db, config),
    wfl,
    vou,
    corsAllowedOrigins: origins,
  })
  let server: any, vite: any
  try {
    await new Promise<void>((resolve) => {
      server = serve(
        { fetch: app.fetch, hostname: '127.0.0.1', port: 0 },
        resolve,
      )
    })
    const origin = `http://127.0.0.1:${server.address().port}`
    process.env.VITE_TARGET_API_BASE_URL = origin
    vite = await createServer({
      root: new URL('../../../frontend/', import.meta.url).pathname,
      configFile: new URL(
        '../../../frontend/vite.target.config.ts',
        import.meta.url,
      ).pathname,
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'error',
    })
    await vite.listen()
    const web = `http://127.0.0.1:${vite.httpServer.address().port}`
    origins.push(web)
    const script = `root = node(key="root",name="订单",entity="sale-order")\nchild = node(key="child",name="出库",entity="sale-outbound")\nworkflow(code="browser-flow",name="浏览器初版",root=root,edges=[edge(source=root,target=child,relation="outbound",action=sale_outbound(initial={"businessDate":"2026-09-04","currency":"CNY","attachments":[],"sourceLines":[{"sourceLineId":"${sourceOrderLineId}","baseQuantity":"1"}]}))])`
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
        'wfl.spec.ts',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TARGET_WEB_BASE_URL: web,
          TARGET_API_BASE_URL: origin,
          TARGET_E2E_USERNAME: owner.username,
          TARGET_E2E_PASSWORD: owner.password,
          TARGET_E2E_REVIEWER_USERNAME: reviewer.username,
          TARGET_E2E_REVIEWER_PASSWORD: reviewer.password,
          TARGET_E2E_CREATE_ONLY_USERNAME: owner.username,
          TARGET_E2E_CREATE_ONLY_PASSWORD: owner.password,
          TARGET_E2E_WFL_FACTS_JSON: JSON.stringify({
            documentId,
            submissionId,
            script,
          }),
        },
      },
    )
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve)
      child.once('error', reject)
    })
    if (code !== 0) throw new Error('WFL browser test failed')
  } finally {
    if (vite) await vite.close()
    if (server) {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    console.log('WFL browser API/Web stopped; fixture transaction rolling back')
  }
})
