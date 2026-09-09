import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  seedSaleOrderReferences,
  saleOrderPayload,
  sourceOrderLineId,
} from '../tests/integration/wfl-fixture.ts'
import { TargetBootstrapService } from '../src/app/bootstrap.ts'
import { hashPassword } from '../src/app/session.ts'
import { AccService } from '../src/acc/service.ts'
import { WflService, type WflVouPort } from '../src/wfl/service.ts'
import { VouService } from '../src/vou/service.ts'
import { AuxService } from '../src/aux/service.ts'
import { BobArchiveService } from '../src/bob/archives.ts'
const require = createRequire(new URL('../package.json', import.meta.url))
const { ulid } = require('ulid')
import { createDatabase } from '../src/db/database.ts'
import { browserTopology } from './browser-topology.ts'
const { databaseUrl, apiOrigin: origin, webOrigin: web } = browserTopology()
const db = createDatabase(databaseUrl)
try {
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
  const { createNodeWflStarlark } = require('@zerp/wfl-starlark/node')
  const runtime = await createNodeWflStarlark()
  let vou: VouService
  const port: WflVouPort = {
    createChild: (...args) => vou.createChild(...args),
    approveChild: (...args) => vou.approveChild(...args),
    rejectChild: (...args) => vou.rejectChild(...args),
    retryChild: (...args) => vou.retryChild(...args),
    cancelChild: (...args) => vou.cancelChild(...args),
  }
  const wfl = new WflService(db, runtime, port)
  vou = new VouService(db, { acc: new AccService(db), wfl })
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
  await db.destroy()
}
