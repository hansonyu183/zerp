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
  validateUseCaseMissingBaseline,
  validateUseCaseMissingBaselineReduction,
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
        { domain: 'aux', entity: 'warehouse', definition: warehousePage },
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

test('use-case baseline can only describe current target-route gaps', () => {
  assert.deepEqual(validateUseCaseMissingBaseline([], []), [])
  assert.match(
    validateUseCaseMissingBaseline([], ['app/target-probe']).join('\n'),
    /未登记新增债务/,
  )
  assert.match(
    validateUseCaseMissingBaselineReduction([], ['app/target-probe']).join(
      '\n',
    ),
    /只能随债务减少/,
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
