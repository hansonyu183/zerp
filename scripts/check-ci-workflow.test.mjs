import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const workflowPath = new URL('../.github/workflows/ci.yml', import.meta.url)
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

test('CI only runs target topology checks and always cleans target resources', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  const target = jobBlock(workflow, 'target')

  assert.match(target, /^    name: target$/m)
  assert.match(target, /^          ref: \$\{\{ env\.CI_COMMIT_SHA \}\}$/m)
  assert.match(
    target,
    /^          go-version-file: packages\/wfl-starlark\/go\/go\.mod$/m,
  )
  assert.ok(
    target.includes('TARGET_POSTGRES_PASSWORD=zerp-target-ci make target-e2e'),
  )
  assert.match(target, /^        if: always\(\)$/m)
  assert.ok(target.includes('make target-down'))

  for (const legacy of [
    'backend-unit',
    'backend-integration',
    'openapi-generated',
    'sqlc-generated',
    'make e2e',
    'make check-openapi-generated',
  ]) {
    assert.equal(
      workflow.includes(legacy),
      false,
      `legacy CI residue: ${legacy}`,
    )
  }
})

test('workflow contract remains a local target-only gate', async () => {
  const [workflowFiles, packageText, makefile] = await Promise.all([
    readdir(workflowsDirectory),
    readFile(packagePath, 'utf8'),
    readFile(makefilePath, 'utf8'),
  ])
  const packageJson = JSON.parse(packageText)

  assert.deepEqual(workflowFiles.sort(), ['ci.yml'])
  assert.equal(
    packageJson.scripts['check:ci-workflow'],
    'node --test scripts/check-ci-workflow.test.mjs',
  )
  assert.match(makefile, /^check-ci-workflow:\n\tpnpm check:ci-workflow$/m)
  assert.match(
    makefile,
    /^check: check-common check-ci-workflow target-check$/m,
  )
  assert.match(makefile, /^test: target-test$/m)
  assert.match(makefile, /^e2e: target-e2e$/m)
})
