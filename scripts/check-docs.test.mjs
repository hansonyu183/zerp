import assert from 'node:assert/strict'
import test from 'node:test'
import prettier from 'prettier'

import {
  generateAdrIndex,
  validateAdrIndex,
  validateAdrDocuments,
  validateLegacyLanguage,
  validateSkillReferences,
  validateUseCaseOwnership,
} from './check-docs.mjs'

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
