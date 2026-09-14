import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { requirementsForLevel, satisfiesRequiredJobs } from './required.mjs'

const scriptPath = new URL('./required.mjs', import.meta.url)
const jobs = ['changes', 'common', 'tooling', 'frontend', 'target']
const requirements = {
  L0: ['changes', 'common'],
  L1: ['changes', 'common', 'tooling'],
  L2: ['changes', 'common', 'tooling', 'frontend'],
  L3: ['changes', 'common', 'tooling', 'target'],
}
function successfulResults(level) {
  return Object.fromEntries(
    jobs.map((job) => [
      job,
      requirements[level].includes(job) ? 'success' : 'skipped',
    ]),
  )
}

for (const [level, required] of Object.entries(requirements)) {
  test(`${level} requires exactly its jobs and permits skipped non-required jobs`, () => {
    assert.deepEqual(requirementsForLevel(level), required)
    assert.equal(
      satisfiesRequiredJobs(level, successfulResults(level)).ok,
      true,
    )
    assert.equal(
      satisfiesRequiredJobs(
        level,
        Object.fromEntries(jobs.map((job) => [job, 'success'])),
      ).ok,
      true,
    )
  })

  test(`${level} rejects missing, failed, cancelled and invalid jobs`, () => {
    for (const job of jobs) {
      for (const status of ['failure', 'cancelled', 'neutral', '', undefined]) {
        const results = { ...successfulResults(level), [job]: status }
        assert.equal(
          satisfiesRequiredJobs(level, results).ok,
          false,
          `${job}: ${status}`,
        )
      }
    }
    for (const job of required) {
      assert.equal(
        satisfiesRequiredJobs(level, {
          ...successfulResults(level),
          [job]: 'skipped',
        }).ok,
        false,
        job,
      )
    }
  })
}

test('rejects invalid levels and malformed job results', () => {
  assert.equal(requirementsForLevel('unknown'), null)
  assert.equal(
    satisfiesRequiredJobs('unknown', successfulResults('L0')).ok,
    false,
  )
  for (const results of [null, [], 'success']) {
    assert.equal(satisfiesRequiredJobs('L2', results).ok, false)
  }
})

function cli(level, results) {
  return spawnSync(
    process.execPath,
    [
      scriptPath.pathname,
      '--level',
      level,
      ...jobs.flatMap((job) => [`--${job}`, results[job]]),
    ],
    { encoding: 'utf8' },
  )
}

test('CLI accepts all workflow levels and rejects skipped required frontend/full-runtime jobs', () => {
  for (const level of Object.keys(requirements)) {
    const result = cli(level, successfulResults(level))
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  }
  for (const [level, job] of [
    ['L2', 'frontend'],
    ['L3', 'target'],
  ]) {
    const result = cli(level, { ...successfulResults(level), [job]: 'skipped' })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, new RegExp(`${job}.*success`))
  }
})
