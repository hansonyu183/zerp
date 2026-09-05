import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const ciPath = new URL('../.github/workflows/ci.yml', import.meta.url)
const targetPath = new URL('../.github/workflows/target.yml', import.meta.url)
const workflowsDirectory = new URL('../.github/workflows/', import.meta.url)
const packagePath = new URL('../package.json', import.meta.url)
const makefilePath = new URL('../Makefile', import.meta.url)

function jobBlock(workflow, jobId) {
  const jobs = [...workflow.matchAll(/^  ([a-z0-9-]+):\n/gm)]
  const jobIndex = jobs.findIndex((match) => match[1] === jobId)
  assert.notEqual(jobIndex, -1, `missing CI job: ${jobId}`)

  const start = jobs[jobIndex].index
  const end = jobs[jobIndex + 1]?.index ?? workflow.length
  return workflow.slice(start, end)
}

test('CI runs once for pull request merge commits and cancels superseded runs', async () => {
  const workflow = await readFile(ciPath, 'utf8')

  assert.match(workflow, /^on:\n  pull_request:$/m)
  assert.doesNotMatch(workflow, /^  push:/m)
  assert.match(
    workflow,
    /^  group: ci-\$\{\{ github\.event\.pull_request\.number \}\}$/m,
  )
  assert.match(workflow, /^  cancel-in-progress: true$/m)
  assert.doesNotMatch(workflow, /pull_request\.head\.sha/)
  assert.doesNotMatch(workflow, /^\s+ref:/m)
})

test('changes classifies the tested merge against its base parent', async () => {
  const workflow = await readFile(ciPath, 'utf8')
  const changes = jobBlock(workflow, 'changes')

  assert.match(changes, /^    outputs:\n      level: /m)
  assert.match(changes, /^          fetch-depth: 0$/m)
  assert.match(changes, /git rev-parse HEAD\^1/)
  assert.match(changes, /--no-renames/)
  assert.match(changes, /scripts\/ci\/classify\.mjs/)
  assert.match(changes, /git show "\$base_sha:scripts\/ci\/classify\.mjs"/)
  assert.match(changes, /L3:\*\|\*:L3\) level=L3/)
  assert.match(changes, /L1:\*\|\*:L1\) level=L1/)
  assert.match(changes, /baseline_level=L3/)
  assert.match(changes, /GITHUB_OUTPUT/)
})

test('CI routes L1 and L3 work and always applies the required summary', async () => {
  const workflow = await readFile(ciPath, 'utf8')
  const tooling = jobBlock(workflow, 'tooling')
  const target = jobBlock(workflow, 'target')
  const common = jobBlock(workflow, 'common')
  const required = jobBlock(workflow, 'ci-required')

  assert.match(tooling, /needs\.changes\.outputs\.level != 'L0'/)
  assert.match(tooling, /pnpm check:ci-workflow/)
  assert.match(target, /needs\.changes\.outputs\.level == 'L3'/)
  assert.match(target, /^    uses: \.\/\.github\/workflows\/target\.yml$/m)
  assert.match(common, /make check-common/)
  assert.match(common, /DOCS_USE_CASE_MISSING_BASELINE_BASE:/)
  assert.match(required, /^    if: always\(\)$/m)
  assert.match(required, /scripts\/ci\/required\.mjs/)
  assert.match(required, /needs: \[changes, common, tooling, target\]/)
})

test('reusable target workflow owns the complete target E2E and cleanup only', async () => {
  const workflow = await readFile(targetPath, 'utf8')
  const target = jobBlock(workflow, 'target')

  assert.match(workflow, /^on:\n  workflow_call:$/m)
  assert.doesNotMatch(workflow, /^  pull_request:/m)
  assert.doesNotMatch(workflow, /^  push:/m)
  assert.match(
    target,
    /^          go-version-file: packages\/wfl-starlark\/go\/go\.mod$/m,
  )
  assert.ok(
    target.includes('TARGET_POSTGRES_PASSWORD=zerp-target-ci make target-e2e'),
  )
  assert.match(target, /^        if: always\(\)$/m)
  assert.ok(target.includes('make target-down'))
})

test('local complete validation remains while CI behavior tests cover both workflows', async () => {
  const [workflowFiles, packageText, makefile] = await Promise.all([
    readdir(workflowsDirectory),
    readFile(packagePath, 'utf8'),
    readFile(makefilePath, 'utf8'),
  ])
  const packageJson = JSON.parse(packageText)

  assert.deepEqual(workflowFiles.sort(), ['ci.yml', 'target.yml'])
  assert.equal(
    packageJson.scripts['check:ci-workflow'],
    'node --test scripts/check-ci-workflow.test.mjs scripts/ci/*.test.mjs',
  )
  assert.match(makefile, /^check-ci-workflow:\n\tpnpm check:ci-workflow$/m)
  assert.match(
    makefile,
    /^check: check-common check-ci-workflow target-check$/m,
  )
  assert.match(makefile, /^test: target-test$/m)
  assert.match(makefile, /^e2e: target-e2e$/m)
})
