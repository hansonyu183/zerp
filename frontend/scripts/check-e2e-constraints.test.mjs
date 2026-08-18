import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  checkRepositoryE2EConstraints,
  validateE2EConstraintSources,
} from './check-e2e-constraints.mjs'

test('allows diagnostics outside reliability-sensitive flows', () => {
  assert.deepEqual(
    validateE2EConstraintSources({
      testSources: {
        'ordinary.spec.ts': `
          const fixture = { video: 'demo.webm' }
          await page.screenshot({ path: 'failure.png' })
        `,
      },
    }),
    [],
  )
})

test('enforces serial interactions and static locators', () => {
  const violations = validateE2EConstraintSources({
    testSources: {
      'unsafe.spec.ts': `
        test('unsafe', { tag: '@system-serial' }, async ({ page }) => {
          await page.getByLabel('名称').click()
          await page.getByRole('button').click({ force: true })
          await page.getByRole('combobox', { name: '状态' }).click()
          await page.getByRole('option', { name: optionName, exact: true }).click()
        })
      `,
    },
  })

  assert.equal(violations.length, 4)
  assert.match(violations.join('\n'), /getByLabel requires/)
  assert.match(violations.join('\n'), /force: true/)
  assert.match(violations.join('\n'), /getByRole requires name and exact: true/)
})

test('only applies locator rules to serial tests', () => {
  assert.deepEqual(
    validateE2EConstraintSources({
      testSources: {
        'ordinary.spec.ts': `await page.getByRole('button').click({ force: true })`,
      },
    }),
    [],
  )
})

test('recursively scans nested E2E sources', () => {
  const frontendRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'e2e-constraints-'),
  )
  try {
    fs.mkdirSync(path.join(frontendRoot, 'tests/e2e/nested'), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(frontendRoot, 'tests/e2e/nested/unsafe.js'),
      `test('unsafe', { tag: '@system-serial' }, () => {
        page.getByLabel('名称').click()
      })`,
    )

    const violations = checkRepositoryE2EConstraints(frontendRoot)
    assert.equal(violations.length, 1)
    assert.match(violations[0], /nested\/unsafe\.js/)
  } finally {
    fs.rmSync(frontendRoot, { recursive: true, force: true })
  }
})
