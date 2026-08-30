import assert from 'node:assert/strict'
import test from 'node:test'
import prettier from 'prettier'

import {
  generateAdrIndex,
  validateAdrIndex,
  validateAdrDocuments,
  validateCurrentArchitectureAssertions,
  validateCurrentStateLegacyLanguage,
  validateBobFormalTerminology,
  validateLegacyLanguage,
  parseUseCaseMissingBaseline,
  validateSkillReferences,
  validateUseCaseMissingBaseline,
  validateUseCaseMissingBaselineReduction,
  validateUseCaseOwnership,
} from './check-docs.mjs'

test('rejects outdated BOB architecture terms', () => {
  const readModel = 'read ' + 'model'
  const projection = 'pro' + 'jection'
  const stableRoot = 'stable ' + 'root'
  const failures = validateBobFormalTerminology([
    {
      file: 'contracts/openapi/schemas/bob.yaml',
      source: `description: BOB current ${readModel}`,
    },
    {
      file: 'backend/db/queries/bob.sql',
      source: `-- BOB query ${projection}`,
    },
    {
      file: 'docs/domains/bob.md',
      source: `BOB owns the ${stableRoot}`,
    },
  ])

  assert.equal(failures.length, 3)
  assert.match(failures.join('\n'), /bob\.yaml:1/)
  assert.match(failures.join('\n'), /bob\.sql:1/)
  assert.match(failures.join('\n'), /bob\.md:1/)
})

test('rejects outdated terms throughout a BOB-scoped source file', () => {
  const projection = 'pro' + 'jection'
  const failures = validateBobFormalTerminology([
    {
      file: 'backend/internal/domains/dcl/bob_query_integration_test.go',
      source: `func assertBOBQueryResult() {}\nquery ${projection}`,
    },
  ])

  assert.equal(failures.length, 1)
  assert.match(failures[0], /bob_query_integration_test\.go:2/)
})

test('accepts the formal BOB read-only terminology and DCL ownership', () => {
  assert.deepEqual(
    validateBobFormalTerminology([
      {
        file: 'docs/domains/bob.md',
        source:
          'DCL owns stable subjects and typed relationship identities. BOB provides current effective read-only business data.',
      },
      {
        file: 'backend/db/queries/bob_blockers.sql',
        source: 'Exact VOU Approval-entry blocker projection.',
      },
    ]),
    [],
  )
})

test('accepts reciprocal ADR supersession metadata', () => {
  assert.deepEqual(
    validateAdrDocuments([
      {
        file: 'docs/adr/0001-old.md',
        source:
          '---\nid: ADR-0001\ndate: 2026-08-01\nstatus: superseded\nsuperseded_by: ADR-0002\n---\n\n# Old\n',
      },
      {
        file: 'docs/adr/0002-new.md',
        source:
          '---\nid: ADR-0002\ndate: 2026-08-02\nstatus: accepted\nsupersedes: ADR-0001\n---\n\n# New\n',
      },
    ]),
    [],
  )
})

test('rejects a superseding ADR when its predecessor is not reciprocally superseded', () => {
  const failures = validateAdrDocuments([
    {
      file: 'docs/adr/0001-old.md',
      source:
        '---\nid: ADR-0001\ndate: 2026-08-01\nstatus: accepted\n---\n\n# Old\n',
    },
    {
      file: 'docs/adr/0002-new.md',
      source:
        '---\nid: ADR-0002\ndate: 2026-08-02\nstatus: accepted\nsupersedes: ADR-0001\n---\n\n# New\n',
    },
  ])

  assert.match(failures.join('\n'), /status 必须是 superseded/)
  assert.match(failures.join('\n'), /superseded_by 必须包含 ADR-0002/)
})

test('rejects every missing reverse supersession link', () => {
  const failures = validateAdrDocuments([
    {
      file: 'docs/adr/0001-old.md',
      source:
        '---\nid: ADR-0001\ndate: 2026-08-01\nstatus: superseded\nsuperseded_by: ADR-0002, ADR-0003\n---\n\n# Old\n',
    },
    {
      file: 'docs/adr/0002-first.md',
      source:
        '---\nid: ADR-0002\ndate: 2026-08-02\nstatus: accepted\nsupersedes: ADR-0001\n---\n\n# First\n',
    },
    {
      file: 'docs/adr/0003-second.md',
      source:
        '---\nid: ADR-0003\ndate: 2026-08-03\nstatus: accepted\n---\n\n# Second\n',
    },
  ])

  assert.match(failures.join('\n'), /0003-second.*不互相对应/)
})

test('rejects malformed and dangling ADR supersession metadata', () => {
  const failures = validateAdrDocuments([
    {
      file: 'docs/adr/0001-old.md',
      source:
        '---\nid: ADR-0001\ndate: yesterday\nstatus: superseded\nsuperseded_by: ADR-0099\n---\n\n# Old\n',
    },
  ])

  assert.match(failures.join('\n'), /date 必须为 YYYY-MM-DD/)
  assert.match(failures.join('\n'), /目标不存在：ADR-0099/)
})

test('requires an ADR filename number to match its frontmatter id', () => {
  const failures = validateAdrDocuments([
    {
      file: 'docs/adr/0001-mismatched.md',
      source:
        '---\nid: ADR-0002\ndate: 2026-08-01\nstatus: accepted\n---\n\n# Mismatched\n',
    },
  ])

  assert.match(failures.join('\n'), /文件编号 0001 必须与 id ADR-0002 一致/)
})

test('requires the committed ADR index to match generated content', async () => {
  const documents = [
    {
      file: 'docs/adr/0001-current.md',
      source:
        '---\nid: ADR-0001\ndate: 2026-08-01\nstatus: accepted\n---\n\n# Current\n',
    },
    {
      file: 'docs/adr/0002-no.md',
      source:
        '---\nid: ADR-0002\ndate: 2026-08-02\nstatus: rejected\n---\n\n# No\n',
    },
  ]
  assert.deepEqual(validateAdrDocuments(documents), [])
  const validIndex = await prettier.format(generateAdrIndex(documents), {
    parser: 'markdown',
  })
  assert.deepEqual(await validateAdrIndex(validIndex, documents), [])
  assert.match(
    (
      await validateAdrIndex(
        validIndex.replace('## Rejected', '## Superseded'),
        documents,
      )
    ).join('\n'),
    /已漂移；请运行 pnpm docs:adr-index/,
  )
})

test('generates the ADR index from frontmatter and titles and detects drift', async () => {
  const documents = [
    {
      file: 'docs/adr/0001-old.md',
      source:
        '---\nid: ADR-0001\ndate: 2026-08-01\nstatus: superseded\nsuperseded_by: ADR-0002\n---\n\n# Old decision\n',
    },
    {
      file: 'docs/adr/0002-current.md',
      source:
        '---\nid: ADR-0002\ndate: 2026-08-02\nstatus: accepted\nsupersedes: ADR-0001\n---\n\n# Current decision\n',
    },
    {
      file: 'docs/adr/0003-rejected.md',
      source:
        '---\nid: ADR-0003\ndate: 2026-08-03\nstatus: rejected\n---\n\n# Rejected decision\n',
    },
  ]

  const index = generateAdrIndex(documents)
  assert.match(
    index,
    /\| \[ADR-0002\]\(0002-current\.md\) \| 2026-08-02 \| Current decision \|/,
  )
  assert.match(
    index,
    /\| \[ADR-0001\]\(0001-old\.md\) \| 2026-08-01 \| Old decision \| \[ADR-0002\]/,
  )
  assert.match(
    index,
    /\| \[ADR-0003\]\(0003-rejected\.md\) \| 2026-08-03 \| Rejected decision \|/,
  )
  const formattedIndex = await prettier.format(index, { parser: 'markdown' })
  assert.deepEqual(await validateAdrIndex(formattedIndex, documents), [])
  assert.match(
    (
      await validateAdrIndex(
        formattedIndex.replace('Current decision', 'Stale title'),
        documents,
      )
    ).join('\n'),
    /已漂移；请运行 pnpm docs:adr-index/,
  )
})

test('only validates skill-shaped references, not API paths', () => {
  assert.deepEqual(
    validateSkillReferences([
      {
        file: 'docs/use-cases/bob/other-unit.md',
        source: 'POST /bob/other-unit/get',
      },
      { file: 'docs/agents/review.md', source: 'Use /code-review skill.' },
    ]),
    [],
  )
  assert.match(
    validateLegacyLanguage(
      [
        {
          file: 'docs/domains/bob.md',
          source:
            '不保留兼容字段。 <!-- docs-check: legacy-exception=unknown-reason ref=ADR-0004 -->',
        },
      ],
      new Set(['ADR-0004']),
    ).join('\n'),
    /未允许的 legacy 例外理由/,
  )
  assert.match(
    validateSkillReferences([
      {
        file: 'docs/agents/review.md',
        source: 'Note the gap for /unlisted-tool.',
      },
    ]).join('\n'),
    /unlisted-tool/,
  )
})

test('requires an explicit legacy exception and keeps BOB rules out of page use cases', () => {
  for (const source of [
    'legacy adapter',
    '旧实体',
    '不保留兼容字段。',
    'fallback path',
    'deprecated API',
    '已删除的接口',
  ]) {
    assert.match(
      validateLegacyLanguage([{ file: 'docs/domains/bob.md', source }]).join(
        '\n',
      ),
      /严格例外/,
    )
  }
  assert.deepEqual(
    validateLegacyLanguage(
      [
        {
          file: 'docs/domains/bob.md',
          source:
            '不保留兼容字段。 <!-- docs-check: legacy-exception=contract-cutover ref=ADR-0004 -->',
        },
      ],
      new Set(['ADR-0004']),
    ),
    [],
  )
  assert.match(
    validateUseCaseOwnership([
      {
        file: 'docs/use-cases/bob/customer.md',
        source: '](../../domains/bob.md)\nDRAFT → EFFECTIVE',
      },
    ]).join('\n'),
    /领域状态机/,
  )
})

test('requires legacy exceptions to cite an existing ADR or migration', () => {
  assert.match(
    validateLegacyLanguage(
      [
        {
          file: 'docs/domains/vou.md',
          source:
            '旧字段已删除。 <!-- docs-check: legacy-exception=release-cutover -->',
        },
      ],
      new Set(['ADR-0004']),
    ).join('\n'),
    /必须声明 ref/,
  )
  assert.match(
    validateLegacyLanguage(
      [
        {
          file: 'docs/domains/vou.md',
          source:
            '旧字段已删除。 <!-- docs-check: legacy-exception=release-cutover ref=ADR-9999 -->',
        },
      ],
      new Set(['ADR-0004']),
    ).join('\n'),
    /引用不存在：ADR-9999/,
  )
})

test('discovers every domain use case and requires its authority link', () => {
  const documents = [
    {
      file: 'docs/use-cases/app/a-new-page.md',
      source: '# New page\n\nNo domain link yet.\n',
    },
  ]

  assert.match(
    validateUseCaseOwnership(documents).join('\n'),
    /缺少 APP 领域规则链接/,
  )
  assert.deepEqual(
    validateUseCaseOwnership([
      {
        ...documents[0],
        source: '](../../domains/app.md)\n',
      },
    ]),
    [],
  )
})

test('applies legacy language checks to current-state documents but not ADRs', () => {
  const failures = validateCurrentStateLegacyLanguage([
    { file: 'CONTEXT.md', source: 'legacy wording' },
    { file: 'README.md', source: 'deprecated wording' },
    { file: 'AGENTS.md', source: 'old write route' },
    { file: 'frontend/README.md', source: 'fallback wording' },
    { file: 'frontend/AGENTS.md', source: 'handler 墓碑' },
    { file: 'backend/README.md', source: '旧实体' },
    { file: 'backend/AGENTS.md', source: 'historical cutover' },
    { file: 'docs/operations/release.md', source: 'old BOB lifecycle' },
    { file: 'docs/agents/guide.md', source: 'BOB customer candidate' },
    { file: 'docs/domains/bob.md', source: 'OIT / KY' },
    { file: 'docs/agents/integration.md', source: 'OIT integration guide' },
    { file: 'docs/adr/0001-history.md', source: 'legacy wording' },
    {
      file: 'docs/adr/0046-cutover.md',
      source:
        'historical cutover; old write path; handler tombstone; old BOB lifecycle; BOB customer candidate; OIT / KY',
    },
  ]).join('\n')

  assert.match(failures, /CONTEXT\.md:1/)
  assert.match(failures, /README\.md:1/)
  assert.match(failures, /AGENTS\.md:1/)
  assert.match(failures, /frontend\/README\.md:1/)
  assert.match(failures, /frontend\/AGENTS\.md:1/)
  assert.match(failures, /backend\/README\.md:1/)
  assert.match(failures, /backend\/AGENTS\.md:1/)
  assert.match(failures, /docs\/operations\/release\.md:1/)
  assert.match(failures, /docs\/agents\/guide\.md:1/)
  assert.match(failures, /docs\/domains\/bob\.md:1/)
  assert.doesNotMatch(failures, /docs\/agents\/integration\.md/)
  assert.doesNotMatch(failures, /docs\/adr\/0001-history\.md/)
  assert.doesNotMatch(failures, /docs\/adr\/0046-cutover\.md/)
})

test('protects BOB, AUX, and operations current architecture boundaries', () => {
  const failures = validateCurrentArchitectureAssertions([
    {
      file: 'docs/use-cases/bob/customer.md',
      source: 'BOB is the writer for customer candidates.',
    },
    {
      file: 'docs/domains/bob.md',
      source: '客户结算方式引用必须保存 AUX Approval Entry。',
    },
    {
      file: 'docs/use-cases/dcl/customer.md',
      source: '收款方式引用必须回查 AUX current。',
    },
    {
      file: 'docs/domains/bob.md',
      source:
        '选择结算方式时保存来源 approvalEntryId，并在提交时确认它仍是 latest approved。',
    },
    {
      file: 'docs/operations/release.md',
      source: '| Domain | Owner |\n| BOB | writer |',
    },
    {
      file: 'docs/adr/0046-history.md',
      source:
        'BOB is the writer for customer candidates. 结算方式引用必须回查 AUX current。 | BOB | writer |',
    },
  ]).join('\n')

  assert.match(failures, /use-cases\/bob\/customer\.md:1.*writer 或 candidate/)
  assert.match(failures, /domains\/bob\.md:1.*AUX Approval Entry/)
  assert.match(
    failures,
    /use-cases\/dcl\/customer\.md:1.*AUX Approval Entry 或 current 回查/,
  )
  assert.match(failures, /domains\/bob\.md:1.*current 回查/)
  assert.match(failures, /docs\/operations\/release\.md:2.*BOB 列为 writer/)
  assert.doesNotMatch(failures, /docs\/adr\/0046-history\.md/)
  assert.deepEqual(
    validateCurrentArchitectureAssertions([
      {
        file: 'docs/domains/bob.md',
        source:
          'BOB 不调用 writer；客户结算方式不保存 AUX Approval Entry，也不回查 AUX current。',
      },
      {
        file: 'docs/operations/release.md',
        source: 'BOB 只读 current，不提供双写。',
      },
    ]),
    [],
  )
})

test('rejects newly missing use cases and stale baseline debt', () => {
  assert.match(
    validateUseCaseMissingBaseline(
      ['app/existing'],
      ['app/existing', 'app/new'],
    ).join('\n'),
    /未登记新增债务：app\/new/,
  )
  assert.match(
    validateUseCaseMissingBaseline(
      ['app/existing', 'app/resolved'],
      ['app/existing'],
    ).join('\n'),
    /包含已修复债务：app\/resolved/,
  )
})

test('requires the missing-use-case baseline to exactly match current debt', () => {
  const failures = validateUseCaseMissingBaseline(
    ['app/old', 'app/resolved'],
    ['app/new', 'app/old'],
  ).join('\n')

  assert.match(failures, /未登记新增债务：app\/new/)
  assert.match(failures, /包含已修复债务：app\/resolved/)
})

test('only permits manual baseline reductions', () => {
  assert.deepEqual(
    validateUseCaseMissingBaselineReduction(['app/a', 'app/b'], ['app/a']),
    [],
  )
  assert.match(
    validateUseCaseMissingBaselineReduction(['app/a'], ['app/a', 'app/b']).join(
      '\n',
    ),
    /只能随债务减少：app\/b/,
  )
})

test('requires a controlled, sorted missing-use-case baseline file', () => {
  assert.match(
    parseUseCaseMissingBaseline(
      '{"missingUseCaseKeys":["app/b","app/a"]}',
      'baseline',
    ).failures.join('\n'),
    /必须按字典序排列/,
  )
  assert.match(
    parseUseCaseMissingBaseline(
      '{"missingUseCaseKeys":["app/a","app/a"]}',
      'baseline',
    ).failures.join('\n'),
    /重复页面用例入口：app\/a/,
  )
})
