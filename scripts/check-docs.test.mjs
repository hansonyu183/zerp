import assert from 'node:assert/strict'
import test from 'node:test'
import prettier from 'prettier'

import {
  generateAdrIndex,
  isUseCasePageFile,
  parseTargetEntryPage,
  parseTargetRegisteredResourcePages,
  parseTargetRouterPages,
  validateAdrDocuments,
  validateAdrIndex,
  validateTargetRouteUseCases,
  validateOrphanUseCases,
} from './check-docs.mjs'

test('accepts reciprocal ADR supersession metadata and generated indexes', async () => {
  const documents = [
    {
      file: 'docs/adr/0001-earlier.md',
      source:
        '---\nid: ADR-0001\ndate: 2026-08-01\nstatus: superseded\nsuperseded_by: ADR-0002\n---\n\n# Earlier\n',
    },
    {
      file: 'docs/adr/0002-current.md',
      source:
        '---\nid: ADR-0002\ndate: 2026-08-02\nstatus: accepted\nsupersedes: ADR-0001\n---\n\n# Current\n',
    },
  ]
  assert.deepEqual(validateAdrDocuments(documents), [])
  const index = await prettier.format(generateAdrIndex(documents), {
    parser: 'markdown',
  })
  assert.deepEqual(await validateAdrIndex(index, documents), [])
})

test('validates the target HTML build entry without using it as page coverage', () => {
  assert.deepEqual(
    parseTargetEntryPage(
      '<title>ZERP</title><body data-use-case="app/target-probe"><script type="module" src="/src/target/main.ts"></script></body>',
    ),
    { failures: [], pages: [] },
  )
  assert.match(
    parseTargetEntryPage('<body></body>').failures.join('\n'),
    /缺少 title/,
  )
})

test('requires every titled target route to declare a use-case key', () => {
  const parsed = parseTargetRouterPages(`
    const routes = [
      {
        path: '/signin',
        name: 'signin',
        component: SignIn,
        meta: { public: true, title: '登录' },
      },
    ]
  `)

  assert.deepEqual(parsed.pages, [])
  assert.match(parsed.failures.join('\n'), /\/signin 缺少 meta\.useCaseKey/)
})

test('includes explicitly documented Resource Host pages from the Registry', () => {
  assert.deepEqual(
    parseTargetRegisteredResourcePages(`
      const resources = [
        {
          domain: 'bob',
          entity: 'supplier',
          definition: supplierPage,
          useCaseKey: 'bob/supplier-management',
        },
      ]
    `),
    {
      failures: [],
      pages: [
        {
          title: 'bob/supplier',
          route: '/bob/supplier',
          source:
            '[资源登记](../../frontend/src/target/navigation/registry.ts)',
          useCaseKey: 'bob/supplier-management',
        },
      ],
    },
  )
})

test('requires a document for every target route use-case key', () => {
  assert.match(
    validateTargetRouteUseCases(
      [
        {
          route: '/signin',
          source: '[目标路由](../../frontend/src/target/router/index.ts)',
          title: '登录',
          useCaseKey: 'app/signin',
        },
      ],
      new Set(),
    ).join('\n'),
    /app\/signin/,
  )
})

test('excludes directory README files from page coverage but still rejects ordinary orphan use cases', () => {
  assert.equal(isUseCasePageFile('docs/use-cases/vou/README.md'), false)
  assert.equal(isUseCasePageFile('docs/use-cases/vou/sale-order.md'), true)
  assert.deepEqual(
    validateOrphanUseCases(
      [{ useCaseKey: 'vou/sale-order' }],
      new Set(['vou/sale-order']),
    ),
    [],
  )
  assert.match(
    validateOrphanUseCases(
      [{ useCaseKey: 'vou/sale-order' }],
      new Set(['vou/sale-order', 'vou/ghost-page']),
    ).join('\n'),
    /vou\/ghost-page/,
  )
})

test('documents the constrained RPT code registration without accepting arbitrary dynamic resources', () => {
  const registration = `{domain:'rpt',entity:':code',definition:reportPage,useCaseKey:'rpt/report-query'}`
  const parsed = parseTargetRegisteredResourcePages(registration)
  assert.deepEqual(parsed.failures, [])
  assert.equal(parsed.pages[0].route, '/rpt/:code')
  assert.ok(
    parseTargetRegisteredResourcePages(registration.replace("'rpt'", "'bob'"))
      .failures.length,
  )
})

test('documents the shared VOU catalog without accepting an arbitrary dynamic resource', () => {
  const registration = `{domain:'vou',entity:':entity',definition:voucherPage,useCaseKey:'vou/catalog'}`
  const parsed = parseTargetRegisteredResourcePages(registration)
  assert.deepEqual(parsed.failures, [])
  assert.equal(parsed.pages[0].route, '/vou/:entity')
  assert.ok(
    parseTargetRegisteredResourcePages(registration.replace("'vou'", "'bob'"))
      .failures.length,
  )
})

test('requires a definition and rejects a separately assigned component in a resource registration', () => {
  const source =
    "{domain:'bob',entity:'supplier',useCaseKey:'bob/supplier-management'"
  assert.match(
    parseTargetRegisteredResourcePages(source + '}').failures.join('\n'),
    /缺少 definition/,
  )
  assert.match(
    parseTargetRegisteredResourcePages(
      source + ',definition:supplierPage,component:WrongPage}',
    ).failures.join('\n'),
    /不得登记 component/,
  )
})

test('counts registrations without ownership and accepts shared use cases', () => {
  const missing = parseTargetRegisteredResourcePages(
    "{domain:'app',entity:'user',definition:userPage}",
  )
  assert.equal(missing.pages.length, 1)
  assert.match(missing.failures.join('\n'), /useCaseKey/)
  const shared =
    "{domain:'app',entity:'user',definition:userPage,useCaseKey:'app/access-management'}, {domain:'app',entity:'role',definition:rolePage,useCaseKey:'app/access-management'}"
  assert.deepEqual(parseTargetRegisteredResourcePages(shared).failures, [])
  assert.equal(parseTargetRegisteredResourcePages(shared).pages.length, 2)
  assert.match(
    parseTargetRegisteredResourcePages(
      shared.replace("entity:'role'", "entity:'user'"),
    ).failures.join('\n'),
    /资源.*重复/,
  )
})

test('allows shared documents across distinct formal routes', () => {
  const parsed = parseTargetRouterPages(`[
    {path:'/one',component:Page,meta:{title:'One',useCaseKey:'app/shared'}},
    {path:'/two',component:Page,meta:{title:'Two',useCaseKey:'app/shared'}}
  ]`)
  assert.deepEqual(parsed.failures, [])
  assert.equal(parsed.pages.length, 2)
  assert.deepEqual(
    validateTargetRouteUseCases(parsed.pages, new Set(['app/shared'])),
    [],
  )
})

test('rejects domain copies in current modules but accepts root authority', async () => {
  const { validateDomainDocumentLocations } = await import('./check-docs.mjs')
  assert.deepEqual(
    validateDomainDocumentLocations([{ file: 'docs/domains/aux.md' }]),
    [],
  )
  for (const file of [
    'frontend/docs/domains/aux.md',
    'apps/api/docs/domains/aux.md',
  ]) {
    assert.match(
      validateDomainDocumentLocations([{ file }]).join('\n'),
      /禁止维护第二套/,
    )
  }
})

test('importing validation functions performs no repository IO or CLI output', async () => {
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import 'prettier'
    import fs from 'node:fs'
    import cp from 'node:child_process'
    import {syncBuiltinESMExports} from 'node:module'
    const forbidden = () => { throw new Error('unexpected repository IO') }
    const readFileSync = fs.readFileSync
    fs.readFileSync = (file, ...args) => String(file).endsWith('.mjs') ? readFileSync(file, ...args) : forbidden()
    fs.readdirSync = forbidden
    cp.execFileSync = forbidden
    syncBuiltinESMExports()
    process.argv.push('--write-use-case-coverage', '--write-adr-index')
    await import(${JSON.stringify(new URL('./check-docs.mjs', import.meta.url).href)})
  `,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('documentation navigation supports category indexes and rejects missing or orphaned manuals', async () => {
  const { validateDocumentationNavigation } = await import('./check-docs.mjs')
  const documents = [
    {
      file: 'README.md',
      source:
        '[APP](docs/domains/app.md)\n[Operations](docs/operations/README.md)\n[Testing](docs/testing/README.md)',
    },
    { file: 'docs/domains/app.md', source: '# APP' },
    { file: 'docs/operations/README.md', source: '[Startup](startup.md)' },
    { file: 'docs/operations/startup.md', source: '# Startup' },
    { file: 'docs/testing/README.md', source: '[Evidence](result.md)' },
    { file: 'docs/testing/result.md', source: '# Evidence' },
  ]
  assert.deepEqual(validateDocumentationNavigation(documents), [])
  const orphan = documents.map((doc) =>
    doc.file === 'docs/operations/README.md'
      ? { ...doc, source: '# Operations' }
      : doc,
  )
  assert.match(validateDocumentationNavigation(orphan).join('\n'), /startup.md/)
  const missing = documents.filter(
    (doc) => doc.file !== 'docs/operations/startup.md',
  )
  assert.match(
    validateDocumentationNavigation(missing).join('\n'),
    /startup.md/,
  )
})
