import assert from 'node:assert/strict'
import test from 'node:test'
import prettier from 'prettier'

import {
  generateAdrIndex,
  parseTargetEntryPage,
  validateAdrDocuments,
  validateAdrIndex,
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

test('maps the target HTML entry to its use case', () => {
  assert.deepEqual(
    parseTargetEntryPage(
      '<title>ZERP</title><body data-use-case="app/target-probe"><script type="module" src="/src/target/main.ts"></script></body>',
    ),
    {
      failures: [],
      pages: [
        {
          route: '/',
          source: '[应用入口](../../frontend/index.html)',
          title: 'ZERP',
          useCaseKey: 'app/target-probe',
        },
      ],
    },
  )
  assert.match(
    parseTargetEntryPage('<title>ZERP</title><body></body>').failures.join(
      '\n',
    ),
    /缺少 data-use-case/,
  )
})

test('use-case baseline can only describe the current target entry', () => {
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
