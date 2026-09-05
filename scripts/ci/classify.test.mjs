import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { classifyPaths } from './classify.mjs'

const scriptPath = new URL('./classify.mjs', import.meta.url)

test('classifies the exact markdown-only L0 allowlist', () => {
  assert.equal(classifyPaths([]), 'L0')
  assert.equal(
    classifyPaths([
      'README.md',
      'AGENTS.md',
      'CONTEXT.md',
      'frontend/README.md',
      'frontend/AGENTS.md',
      'docs/domains/app.md',
      'docs/use-cases/a/b.md',
    ]),
    'L0',
  )
  assert.equal(classifyPaths(['docs/domains/app.ts']), 'L3')
  assert.equal(classifyPaths(['docs.md']), 'L3')
  assert.equal(classifyPaths(['frontend/guide.md']), 'L3')
  assert.equal(classifyPaths(['README.MD']), 'L3')
})

test('classifies the exact CI and documentation tooling L1 allowlist', () => {
  assert.equal(
    classifyPaths([
      '.prettierignore',
      '.prettierrc.json',
      '.github/workflows/ci.yml',
      'scripts/check-docs.mjs',
      'scripts/check-docs.test.mjs',
      'scripts/check-ci-workflow.test.mjs',
      'scripts/ci/classify.mjs',
      'scripts/ci/classify.test.mjs',
      'scripts/ci/required.mjs',
      'scripts/ci/required.test.mjs',
    ]),
    'L1',
  )
  assert.equal(classifyPaths(['docs/domains/app.md', '.prettierignore']), 'L1')
  assert.equal(classifyPaths(['.github/workflows/target.yml']), 'L3')
})

test('fails closed to L3 for every unlisted path, including adds, edits, deletes, and rename halves', () => {
  for (const path of [
    'package.json',
    'pnpm-lock.yaml',
    'Makefile',
    'apps/api/src/index.ts',
    'frontend/src/App.vue',
    'scripts/ci/other.mjs',
    'old-name.ts',
    'new-name.ts',
  ]) {
    assert.equal(classifyPaths([path]), 'L3', path)
  }
  assert.equal(
    classifyPaths(['docs/old-name.md', 'apps/api/src/new-name.ts']),
    'L3',
  )
})

test('CLI reads newline-delimited paths and emits only the computed level', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zerp-ci-classify-'))
  const pathsFile = join(directory, 'paths')
  await writeFile(pathsFile, 'docs/domains/app.md\n.prettierignore\n')

  const result = spawnSync(
    process.execPath,
    [scriptPath.pathname, '--paths-file', pathsFile],
    {
      encoding: 'utf8',
    },
  )

  assert.equal(result.status, 0)
  assert.equal(result.stdout, 'L1\n')
  assert.equal(result.stderr, '')
})

test('CLI rejects malformed arguments and unreadable path files', () => {
  for (const args of [
    [],
    ['--paths-file'],
    ['--unknown', 'paths'],
    ['--paths-file', '/missing/paths'],
  ]) {
    const result = spawnSync(process.execPath, [scriptPath.pathname, ...args], {
      encoding: 'utf8',
    })
    assert.notEqual(result.status, 0, args.join(' '))
    assert.equal(result.stdout, '', args.join(' '))
    assert.notEqual(result.stderr, '', args.join(' '))
  }
})
