import assert from 'node:assert/strict'
import test from 'node:test'

import {
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

test('keeps every ADR in the matching index status section', () => {
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
  const validIndex =
    '# ADRs\n\n## Accepted\n\n| ADR |\n| --- |\n| [ADR-0001](0001-current.md) |\n\n## Rejected\n\n| ADR |\n| --- |\n| [ADR-0002](0002-no.md) |\n'

  assert.deepEqual(validateAdrDocuments(documents), [])
  assert.deepEqual(validateAdrIndex(validIndex, documents), [])
  assert.match(
    validateAdrIndex(
      validIndex.replace('## Rejected', '## Superseded'),
      documents,
    ).join('\n'),
    /缺少 rejected 状态分区/,
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
    validateLegacyLanguage([
      {
        file: 'docs/domains/bob.md',
        source:
          '不保留兼容字段。 <!-- docs-check: legacy-exception=unknown-reason -->',
      },
    ]).join('\n'),
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
    validateLegacyLanguage([
      {
        file: 'docs/domains/bob.md',
        source:
          '不保留兼容字段。 <!-- docs-check: legacy-exception=contract-cutover -->',
      },
    ]),
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
