import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const contract = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, 'contracts/openapi/dist/openapi.json'),
    'utf8',
  ),
)

test('Accounting Opening requires server Approval actions without a duplicate state', () => {
  const opening = contract.components.schemas.Opening
  assert.ok(opening, 'Opening schema is missing')
  assert.ok(
    opening.required?.includes('availableApprovalActions'),
    'Opening.availableApprovalActions must be required',
  )
  assert.deepEqual(opening.properties.availableApprovalActions, {
    type: 'array',
    items: { $ref: '#/components/schemas/ApprovalLifecycleAction' },
  })
  assert.equal(opening.properties.state, undefined)
})

test('Approval metadata remains factual for Accounting Opening', () => {
  assert.equal(
    contract.components.schemas.ApprovalMeta.properties
      ?.availableApprovalActions,
    undefined,
  )
})
