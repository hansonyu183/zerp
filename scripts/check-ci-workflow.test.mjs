import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const workflowPath = new URL('../.github/workflows/ci.yml', import.meta.url)
const workflowsDirectory = new URL('../.github/workflows/', import.meta.url)
const packagePath = new URL('../package.json', import.meta.url)
const makefilePath = new URL('../Makefile', import.meta.url)
const composePath = new URL('../compose.yaml', import.meta.url)

function jobBlock(workflow, jobId) {
  const jobs = [...workflow.matchAll(/^  ([a-z0-9-]+):\n/gm)]
  const jobIndex = jobs.findIndex((match) => match[1] === jobId)
  assert.notEqual(jobIndex, -1, `missing CI job: ${jobId}`)

  const start = jobs[jobIndex].index
  const end = jobs[jobIndex + 1]?.index ?? workflow.length
  return workflow.slice(start, end)
}

test('CI validates pull requests and every main SHA without cancelling main runs', async () => {
  const workflow = await readFile(workflowPath, 'utf8')

  assert.match(
    workflow,
    /^on:\n  pull_request:\n  push:\n    branches:\n      - main$/m,
  )
  assert.match(
    workflow,
    /^concurrency:\n  group: .+\$\{\{ github\.ref \}\}.*$/m,
  )
  assert.match(
    workflow,
    /^  cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}$/m,
  )
  assert.match(
    workflow,
    /^env:\n  CI_COMMIT_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}$/m,
  )
})

test('CI exposes independently diagnosable jobs through repository commands', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  const requiredCommands = new Map([
    ['docs-format', ['make check-common']],
    ['workflow-contract', ['make check-ci-workflow']],
    ['openapi-generated', ['make check-openapi-generated']],
    ['sqlc-generated', ['make check-sqlc-generated']],
    [
      'backend-unit',
      [
        'make check-runtime',
        'make -C backend quality-format test-unit quality-vet-build quality-race quality-staticcheck quality-vuln quality-image',
      ],
    ],
    [
      'backend-integration',
      [
        'backend/scripts/run-integration-tests-test.sh',
        'make -C backend ENV_FILE=.env.e2e.example TEST_POSTGRES_DB=zerp_ci_test test-integration',
      ],
    ],
    ['frontend', ['pnpm contracts:bundle', 'make check-frontend']],
    [
      'target-foundation',
      ['TARGET_POSTGRES_PASSWORD=zerp-target-ci make target-e2e'],
    ],
    ['shell', ['make check-shell']],
    ['e2e', ['make e2e']],
  ])

  for (const [jobId, commands] of requiredCommands) {
    const block = jobBlock(workflow, jobId)
    assert.match(block, new RegExp(`^    name: ${jobId}$`, 'm'))
    assert.match(block, /^          ref: \$\{\{ env\.CI_COMMIT_SHA \}\}$/m)
    for (const command of commands) {
      assert.ok(block.includes(command), `${jobId} must run: ${command}`)
    }
  }

  assert.match(
    jobBlock(workflow, 'backend-unit'),
    /^    env:\n      BACKEND_ENV: \.env\.example$/m,
  )
  const targetFoundation = jobBlock(workflow, 'target-foundation')
  assert.match(
    targetFoundation,
    /^          go-version-file: backend\/go\.mod$/m,
  )
  assert.match(targetFoundation, /^            backend\/go\.sum$/m)
  assert.match(
    targetFoundation,
    /^            packages\/wfl-starlark\/go\/go\.sum$/m,
  )
})

test('the workflow contract is a local gate and disposable resources are always cleaned', async () => {
  const [workflow, workflowFiles, packageText, makefile] = await Promise.all([
    readFile(workflowPath, 'utf8'),
    readdir(workflowsDirectory),
    readFile(packagePath, 'utf8'),
    readFile(makefilePath, 'utf8'),
  ])
  const packageJson = JSON.parse(packageText)

  assert.equal(workflowFiles.includes('docs.yml'), false)
  assert.equal(
    packageJson.scripts['check:ci-workflow'],
    'node --test scripts/check-ci-workflow.test.mjs',
  )
  assert.match(makefile, /^check-ci-workflow:\n\tpnpm check:ci-workflow$/m)

  const cleanupCommands = new Map([
    ['backend-integration', 'down --volumes --remove-orphans'],
    ['target-foundation', 'make target-down'],
    ['e2e', 'down --volumes --remove-orphans'],
  ])
  for (const [jobId, cleanupCommand] of cleanupCommands) {
    const block = jobBlock(workflow, jobId)
    assert.match(block, /^        if: always\(\)$/m)
    assert.ok(
      block.includes(cleanupCommand),
      `${jobId} must always remove disposable resources`,
    )
  }
})

test('PostgreSQL readiness waits for the final TCP server', async () => {
  const compose = await readFile(composePath, 'utf8')

  assert.match(
    compose,
    /pg_isready -h 127\.0\.0\.1 -U \$\$\{POSTGRES_USER\} -d \$\$\{POSTGRES_DB\}/,
  )
})
