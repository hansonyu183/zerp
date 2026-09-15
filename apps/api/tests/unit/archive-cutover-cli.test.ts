import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(
  new URL('../../scripts/cutover-archives.ts', import.meta.url),
)

test('archive cutover CLI keeps malformed database credentials out of diagnostics', () => {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      TARGET_DATABASE_URL:
        'postgres://review:SYNTHETIC_REVIEW_PASSWORD@localhost:invalid/review_test',
      TARGET_DATABASE_SCOPE: 'isolated',
    },
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'archive_cutover_failed\n')
})

for (const scenario of [
  {
    name: 'argument parsing',
    args: ['--SYNTHETIC_REVIEW_PASSWORD'],
    url: 'postgres://review:SYNTHETIC_REVIEW_PASSWORD@localhost:1/review_test',
  },
  { name: 'missing configuration', args: [], url: '' },
  {
    name: 'missing apply prerequisites',
    args: ['--apply'],
    url: 'postgres://review:SYNTHETIC_REVIEW_PASSWORD@localhost:1/review_test',
  },
  {
    name: 'backup manifest read',
    args: [
      '--apply',
      '--writers-frozen',
      '--baseline',
      'unused',
      '--backup',
      `${script}/SYNTHETIC_PRIVATE_BACKUP`,
    ],
    url: 'postgres://review:SYNTHETIC_REVIEW_PASSWORD@localhost:1/review_test',
  },
]) {
  test(`archive cutover CLI reports only a stable code for ${scenario.name} failures`, () => {
    const result = spawnSync(process.execPath, [script, ...scenario.args], {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        TARGET_DATABASE_URL: scenario.url,
        TARGET_DATABASE_SCOPE: 'isolated',
      },
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'archive_cutover_failed\n')
  })
}
