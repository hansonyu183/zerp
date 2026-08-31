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

test('VOU list and detail projections require server Approval actions', () => {
  for (const name of ['VouListItem', 'VouDocumentView']) {
    const schema = contract.components.schemas[name]
    assert.ok(schema, `${name} schema is missing`)
    assert.ok(
      schema.required?.includes('availableApprovalActions'),
      `${name}.availableApprovalActions must be required`,
    )
    assert.deepEqual(schema.properties.availableApprovalActions, {
      type: 'array',
      items: { $ref: '#/components/schemas/ApprovalLifecycleAction' },
    })
  }
})

test('VOU exposes the generic reject action with a required reason request', () => {
  const operation = contract.paths['/vou/{entity}/reject']?.post
  assert.ok(operation, 'POST /vou/{entity}/reject is missing')
  assert.deepEqual(operation.requestBody.content['application/json'].schema, {
    $ref: '#/components/schemas/VouReverseRequest',
  })
  assert.ok(
    contract.components.schemas.VouReverseRequest.required.includes('reason'),
  )
})
