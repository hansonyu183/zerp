import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('Vitest configurations collect every frontend case exactly once', () => {
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const directory = mkdtempSync(resolve(root, '.scratch/collection-'))
  try {
    const collected = []
    for (const config of [
      'vitest.config.ts',
      'vitest.vuetify.config.ts',
      'vitest.static.config.ts',
    ]) {
      const output = resolve(directory, `${config}.json`)
      const result = spawnSync(
        'pnpm',
        ['exec', 'vitest', 'list', '--config', config, `--json=${output}`],
        { cwd: resolve(root, 'frontend'), encoding: 'utf8' },
      )
      assert.equal(result.status, 0, result.stdout + result.stderr)
      collected.push(JSON.parse(readFileSync(output, 'utf8')))
    }
    const expectedFiles = ['tests/unit/target', 'tests/static'].flatMap(
      (directory) =>
        readdirSync(resolve(root, 'frontend', directory), { recursive: true })
          .filter((file) => file.endsWith('.spec.ts'))
          .map((file) => resolve(root, 'frontend', directory, file)),
    )
    assert.deepEqual(
      [...new Set(collected.flat().map(({ file }) => file))].sort(),
      expectedFiles.sort(),
    )
    const keys = collected.flat().map(({ file, name }) => `${file}:${name}`)
    assert.equal(
      new Set(keys).size,
      keys.length,
      'a test was collected by multiple configurations',
    )
    assert.ok(
      collected[0].some(({ file }) =>
        file.endsWith('/app-layout.component.spec.ts'),
      ),
    )
    assert.ok(
      collected[1].every(({ file }) => file.endsWith('.vuetify.spec.ts')),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

// Exercise Make through process boundaries: command stand-ins expose exits and
// invocations without starting databases or duplicating expensive browser work.
test('complete validation executes mandatory stages and propagates command failures', () => {
  mkdirSync(resolve(root, '.scratch'), { recursive: true })
  const directory = mkdtempSync(resolve(root, '.scratch/validation-cli-'))
  try {
    const log = resolve(directory, 'calls.jsonl')
    const executable = `#!${process.execPath}
import { appendFileSync } from 'node:fs'
const args = process.argv.slice(2).join(' ')
appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n')
if (args === process.env.FAIL_COMMAND) process.exit(17)
`
    for (const command of ['pnpm', 'docker'])
      writeFileSync(resolve(directory, command), executable, { mode: 0o755 })
    const run = (target, failure = '') => {
      writeFileSync(log, '')
      const result = spawnSync('make', ['--no-print-directory', target], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          CALL_LOG: log,
          FAIL_COMMAND: failure,
        },
      })
      const calls = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      return { result, calls }
    }
    const required = [
      'format:check',
      'docs:check',
      'check:ci-workflow',
      'check:validation',
      '--filter @zerp/frontend check:architecture',
      '--filter @zerp/api generate:artifacts',
      '--filter @zerp/api generate:db',
      '--filter @zerp/api test:artifacts',
      '--filter @zerp/api typecheck',
      '--filter @zerp/api-client typecheck',
      '--filter @zerp/model typecheck',
      '--filter @zerp/wfl-starlark typecheck',
      '--filter @zerp/frontend typecheck',
      '--filter @zerp/frontend lint',
      '--filter @zerp/frontend format:check',
      '--filter @zerp/model test',
      '--filter @zerp/api test:unit',
      '--filter @zerp/frontend test:pure',
      '--filter @zerp/frontend test:component',
      '--filter @zerp/api test:integration',
      '--filter @zerp/api check:catalog',
      '--filter @zerp/api validate:rpt',
      '--filter @zerp/wfl-starlark wasm:build',
      '--filter @zerp/wfl-starlark test:node',
      '--filter @zerp/wfl-starlark test:browser',
      '--filter @zerp/api e2e',
      '--filter @zerp/api e2e:wfl',
      '--filter @zerp/api e2e:vou-catalog',
      '--filter @zerp/api e2e:vou-opening',
      '--filter @zerp/api e2e:vou-entry',
    ]
    const success = run('e2e')
    assert.equal(
      success.result.status,
      0,
      success.result.stdout + success.result.stderr,
    )
    for (const command of required)
      assert.equal(
        success.calls.filter((call) => call === command).length,
        1,
        command,
      )
    assert.equal(
      success.calls.filter((call) => call.includes('up -d --wait target-db'))
        .length,
      5,
    )
    assert.equal(
      success.calls.filter((call) =>
        call.includes('up -d --build --wait target-api target-web'),
      ).length,
      1,
    )
    for (const command of [
      'docs:check',
      '--filter @zerp/frontend check:architecture',
      '--filter @zerp/api generate:db',
      '--filter @zerp/frontend test:component',
      '--filter @zerp/api test:integration',
      '--filter @zerp/wfl-starlark test:browser',
      '--filter @zerp/api e2e:vou-entry',
    ]) {
      const failure = run('e2e', command)
      assert.notEqual(failure.result.status, 0, command)
      assert.equal(
        failure.calls.at(-1),
        command,
        'validation must stop at the failed stage',
      )
    }
    for (const target of ['check-static', 'test-unit', 'test-component']) {
      const quick = run(target)
      assert.equal(
        quick.result.status,
        0,
        quick.result.stdout + quick.result.stderr,
      )
      assert.ok(
        quick.calls.every(
          (call) => !/compose|generate:|wasm:build|test:browser/.test(call),
        ),
        target,
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
