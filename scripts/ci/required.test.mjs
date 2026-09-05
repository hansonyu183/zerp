import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { requirementsForLevel, satisfiesRequiredJobs } from './required.mjs'

const scriptPath = new URL('./required.mjs', import.meta.url)

test('defines the exact required jobs for each CI level', () => {
  assert.deepEqual(requirementsForLevel('L0'), ['changes', 'common'])
  assert.deepEqual(requirementsForLevel('L1'), ['changes', 'common', 'tooling'])
  assert.deepEqual(requirementsForLevel('L3'), [
    'changes',
    'common',
    'tooling',
    'target',
  ])
})

test('accepts only successful required jobs and skipped non-required jobs', () => {
  assert.equal(
    satisfiesRequiredJobs('L0', {
      changes: 'success',
      common: 'success',
      tooling: 'skipped',
      target: 'skipped',
    }).ok,
    true,
  )
  assert.equal(
    satisfiesRequiredJobs('L1', {
      changes: 'success',
      common: 'success',
      tooling: 'success',
      target: 'skipped',
    }).ok,
    true,
  )
  assert.equal(
    satisfiesRequiredJobs('L3', {
      changes: 'success',
      common: 'success',
      tooling: 'success',
      target: 'success',
    }).ok,
    true,
  )
})

test('rejects failed, cancelled, skipped, missing, and invalid required outputs', () => {
  for (const [level, results] of [
    [
      'L0',
      {
        changes: 'failure',
        common: 'success',
        tooling: 'skipped',
        target: 'skipped',
      },
    ],
    [
      'L0',
      {
        changes: 'cancelled',
        common: 'success',
        tooling: 'skipped',
        target: 'skipped',
      },
    ],
    [
      'L1',
      {
        changes: 'success',
        common: 'success',
        tooling: 'skipped',
        target: 'skipped',
      },
    ],
    [
      'L3',
      {
        changes: 'success',
        common: 'success',
        tooling: 'success',
        target: 'skipped',
      },
    ],
    [
      'L3',
      { changes: 'success', common: 'success', tooling: 'success', target: '' },
    ],
    [
      'L3',
      {
        changes: 'success',
        common: 'success',
        tooling: 'success',
        target: 'neutral',
      },
    ],
    ['L3', { changes: 'success', common: 'success', tooling: 'success' }],
  ]) {
    assert.equal(
      satisfiesRequiredJobs(level, results).ok,
      false,
      `${level}: ${JSON.stringify(results)}`,
    )
  }
})

test('rejects invalid levels and failures in non-required jobs', () => {
  assert.equal(
    satisfiesRequiredJobs('L2', {
      changes: 'success',
      common: 'success',
      tooling: 'skipped',
      target: 'skipped',
    }).ok,
    false,
  )
  assert.equal(
    satisfiesRequiredJobs('L0', {
      changes: 'success',
      common: 'success',
      tooling: 'success',
      target: 'skipped',
    }).ok,
    true,
  )
  assert.equal(
    satisfiesRequiredJobs('L1', {
      changes: 'success',
      common: 'success',
      tooling: 'success',
      target: 'failure',
    }).ok,
    false,
  )
})

test('CLI accepts the workflow contract and reports violations to stderr', () => {
  const success = spawnSync(
    process.execPath,
    [
      scriptPath.pathname,
      '--level',
      'L1',
      '--changes',
      'success',
      '--common',
      'success',
      '--tooling',
      'success',
      '--target',
      'skipped',
    ],
    { encoding: 'utf8' },
  )
  assert.equal(success.status, 0)
  assert.equal(success.stdout, '')
  assert.equal(success.stderr, '')

  const failure = spawnSync(
    process.execPath,
    [
      scriptPath.pathname,
      '--level',
      'L3',
      '--changes',
      'success',
      '--common',
      'success',
      '--tooling',
      'success',
      '--target',
      'skipped',
    ],
    { encoding: 'utf8' },
  )
  assert.notEqual(failure.status, 0)
  assert.equal(failure.stdout, '')
  assert.match(failure.stderr, /target.*success/i)
})
