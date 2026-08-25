import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDirectory = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureConfig = join(
  frontendDirectory,
  'tests',
  'fixtures',
  'vue-template-typecheck',
  'tsconfig.json',
)

const result = spawnSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vue-tsc', '--pretty', 'false', '--project', fixtureConfig],
  {
    cwd: frontendDirectory,
    encoding: 'utf8',
  },
)
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

assert.notEqual(
  result.status,
  0,
  'vue-tsc accepted an invalid Vue template fixture',
)
assert.match(output, /InvalidTemplate\.vue.*TS2339/u)
