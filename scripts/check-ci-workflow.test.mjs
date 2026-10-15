import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const ciPath = new URL('../.github/workflows/ci.yml', import.meta.url)
const targetPath = new URL('../.github/workflows/target.yml', import.meta.url)
const workflowsDirectory = new URL('../.github/workflows/', import.meta.url)
const packagePath = new URL('../package.json', import.meta.url)

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
  assert.match(changes, /L2:\*\|\*:L2\) level=L2/)
  assert.match(changes, /L1:\*\|\*:L1\) level=L1/)
  assert.match(changes, /baseline_level=L3/)
  assert.match(changes, /GITHUB_OUTPUT/)
})

test('CI routes L1, L2 and L3 work and always applies the required summary', async () => {
  const workflow = await readFile(ciPath, 'utf8')
  const tooling = jobBlock(workflow, 'tooling')
  const frontend = jobBlock(workflow, 'frontend')
  const target = jobBlock(workflow, 'target')
  const common = jobBlock(workflow, 'common')
  const required = jobBlock(workflow, 'ci-required')

  assert.match(tooling, /needs\.changes\.outputs\.level != 'L0'/)
  assert.match(tooling, /pnpm check:ci-workflow/)
  assert.match(frontend, /needs\.changes\.outputs\.level == 'L2'/)
  assert.match(target, /needs\.changes\.outputs\.level == 'L3'/)
  assert.match(target, /^    uses: \.\/\.github\/workflows\/target\.yml$/m)
  assert.match(common, /make check-common/)
  assert.match(required, /^    if: always\(\)$/m)
  assert.match(required, /--frontend '\$\{\{ needs\.frontend\.result \}\}'/)
  assert.match(required, /scripts\/ci\/required\.mjs/)
  assert.match(
    required,
    /needs: \[changes, common, tooling, frontend, target\]/,
  )
})

test('L2 validates the frontend without provisioning full runtime dependencies', async () => {
  const workflow = await readFile(ciPath, 'utf8')
  const frontend = jobBlock(workflow, 'frontend')
  for (const command of [
    'pnpm install --frozen-lockfile',
    'pnpm --filter @zerp/frontend typecheck',
    'pnpm --filter @zerp/frontend check:architecture',
    'pnpm --filter @zerp/frontend check',
  ])
    assert.ok(frontend.includes(command), command)
  assert.doesNotMatch(
    frontend,
    /setup-go|playwright install|target-e2e|docker|postgres/i,
  )
  const pkg = JSON.parse(
    await readFile(
      new URL('../frontend/package.json', import.meta.url),
      'utf8',
    ),
  )
  assert.equal(
    pkg.scripts.check,
    'pnpm lint && pnpm format:check && pnpm test:unit && pnpm build:target',
  )
  assert.match(
    pkg.scripts['test:unit'],
    /vitest\.config\.ts.*vitest\.vuetify\.config\.ts/,
  )
})

test('reusable target workflow keeps full acceptance as the default and cleans failures', async () => {
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
  assert.match(target, /^        if: \$\{\{ always\(\) && inputs\.full \}\}$/m)
  assert.match(
    workflow,
    /full:\n        description: [^\n]+\n        type: boolean\n        default: true/,
  )
  assert.ok(target.includes('make target-down'))
})

test('CI behavior tests cover both workflows', async () => {
  const [workflowFiles, packageText] = await Promise.all([
    readdir(workflowsDirectory),
    readFile(packagePath, 'utf8'),
  ])
  const packageJson = JSON.parse(packageText)
  assert.deepEqual(workflowFiles.sort(), ['ci.yml', 'target.yml'])
  assert.equal(
    packageJson.scripts['check:ci-workflow'],
    'node --test scripts/check-ci-workflow.test.mjs scripts/ci/*.test.mjs',
  )
})

test('draft changes run fast while ready and explicitly requested runs retain full acceptance', async () => {
  const [workflow, targetWorkflow] = await Promise.all([
    readFile(ciPath, 'utf8'),
    readFile(targetPath, 'utf8'),
  ])
  for (const event of [
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
    'converted_to_draft',
    'labeled',
    'unlabeled',
  ]) {
    assert.match(workflow, new RegExp(`^      - ${event}$`, 'm'))
  }
  const target = jobBlock(workflow, 'target')
  assert.ok(
    target.includes(
      "full: ${{ !github.event.pull_request.draft || contains(github.event.pull_request.labels.*.name, 'ci:full') }}",
    ),
  )
  const changes = jobBlock(workflow, 'changes')
  assert.ok(
    changes.includes(
      "FORCE_FULL: ${{ contains(github.event.pull_request.labels.*.name, 'ci:full') }}",
    ),
  )
  assert.match(
    changes,
    /if \[\[ "\$FORCE_FULL" == "true" \]\]; then\n            echo "level=L3" >> "\$GITHUB_OUTPUT"\n            exit 0/,
  )
  const fast = targetWorkflow.match(
    /- name: Draft static, unit and component checks([\s\S]*?)(?=      - name:)/,
  )?.[1]
  assert.ok(fast)
  assert.ok(fast.includes('if: ${{ !inputs.full }}'))
  assert.ok(fast.includes('run: make target-static test'))
  assert.doesNotMatch(
    fast,
    /target-e2e|target-test|target-db|playwright|docker|wasm/,
  )
  assert.match(
    targetWorkflow,
    /uses: actions\/setup-go@v6\n        if: \$\{\{ inputs.full \}\}/,
  )
  assert.match(
    targetWorkflow,
    /name: Install browser for full acceptance\n        if: \$\{\{ inputs.full \}\}/,
  )
  assert.match(
    targetWorkflow,
    /name: Full runtime acceptance\n        if: \$\{\{ inputs.full \}\}\n        run: TARGET_POSTGRES_PASSWORD=zerp-target-ci make target-e2e/,
  )
})
