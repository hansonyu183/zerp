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

const projections = [
  'DclOperatingEntityListItem',
  'DclOperatingEntityView',
  'DclWarehouseListItem',
  'DclWarehouseView',
  'DclVehicleListItem',
  'DclVehicleView',
  'DclFundAccountListItem',
  'DclFundAccountView',
  'DclProductListItem',
  'DclProductView',
  'DclPartyListItem',
  'DclPartyView',
  'DclEmployeeListItem',
  'DclEmployeeView',
  'DclSupplierListItem',
  'DclSupplierView',
  'DclCustomerListItem',
  'DclCustomerView',
  'DclOtherUnitListItem',
  'DclOtherUnitView',
  'DclSalesPartnerListItem',
  'DclSalesPartnerView',
  'DclAccMappingListItem',
  'DclAccMappingView',
  'DclRptDefinitionListItem',
  'DclRptDefinitionView',
  'DclWflProcessDefinitionListItem',
  'DclWflProcessDefinitionView',
]

function effectiveObjectSchema(schema) {
  const required = new Set(schema.required ?? [])
  const properties = { ...(schema.properties ?? {}) }
  for (const part of schema.allOf ?? []) {
    const nested = part.$ref
      ? contract.components.schemas[part.$ref.split('/').at(-1)]
      : part
    const effective = effectiveObjectSchema(nested)
    for (const name of effective.required) required.add(name)
    Object.assign(properties, effective.properties)
  }
  return { required, properties }
}

test('all mutable DCL list and detail projections require server Approval actions', () => {
  for (const name of projections) {
    const schema = contract.components.schemas[name]
    assert.ok(schema, `${name} schema is missing`)
    const effective = effectiveObjectSchema(schema)
    assert.ok(
      effective.required.has('availableApprovalActions'),
      `${name}.availableApprovalActions must be required`,
    )
    assert.deepEqual(effective.properties.availableApprovalActions, {
      type: 'array',
      items: { $ref: '#/components/schemas/ApprovalLifecycleAction' },
    })
  }
})

test('Approval metadata remains factual', () => {
  for (const name of ['ApprovalMeta', 'ApprovalVersionMeta']) {
    const schema = contract.components.schemas[name]
    assert.equal(schema.properties?.availableApprovalActions, undefined)
  }
})
