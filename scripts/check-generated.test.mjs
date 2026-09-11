import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')

test('generated CLI detects database, contract, added, deleted and staged drift from either cwd', () => {
  fs.mkdirSync(path.join(root, '.scratch'), { recursive: true })
  const fixture = fs.mkdtempSync(path.join(root, '.scratch/generated-check-'))
  try {
    fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true })
    fs.copyFileSync(
      path.join(root, 'scripts/check-generated.mjs'),
      path.join(fixture, 'scripts/check-generated.mjs'),
    )
    for (const file of [
      'apps/api/src/db/generated.ts',
      'apps/api/src/generated/openapi.json',
    ]) {
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true })
      fs.writeFileSync(path.join(fixture, file), 'baseline\n')
    }
    const git = (...args) =>
      execFileSync('git', args, { cwd: fixture, stdio: 'pipe' })
    git('init', '-q')
    git('add', '.')
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'baseline',
    )
    const check = (expected, file) => {
      for (const cwd of [fixture, path.join(fixture, 'apps/api')]) {
        const result = spawnSync(
          process.execPath,
          [path.join(fixture, 'scripts/check-generated.mjs')],
          { cwd, encoding: 'utf8' },
        )
        assert.equal(result.status, expected, result.stdout + result.stderr)
        if (file)
          assert.ok(
            (result.stdout + result.stderr).includes(file),
            result.stdout + result.stderr,
          )
      }
    }
    check(0)
    for (const file of [
      'apps/api/src/db/generated.ts',
      'apps/api/src/generated/openapi.json',
    ]) {
      fs.appendFileSync(path.join(fixture, file), 'drift\n')
      check(1, file)
      git('checkout', '--', file)
      fs.unlinkSync(path.join(fixture, file))
      check(1, file)
      git('checkout', '--', file)
    }
    const added = 'apps/api/src/generated/new.ts'
    fs.writeFileSync(path.join(fixture, added), 'new\n')
    check(1, added)
    git('add', added)
    check(1, added)
    git('reset', '--hard', '-q', 'HEAD')
    check(0)
    fs.writeFileSync(path.join(fixture, 'unrelated.txt'), 'unrelated')
    check(0)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
})
