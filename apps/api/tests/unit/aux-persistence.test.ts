import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('target schema keeps one AUX current root and allows new stable-reference snapshots', async () => {
  const schema = await readFile(
    new URL('../../db/target-schema.sql', import.meta.url),
    'utf8',
  )
  const auxObjects = schema.slice(
    schema.indexOf('CREATE TABLE aux_objects'),
    schema.indexOf('CREATE TABLE aux_reference_facts'),
  )
  assert.match(auxObjects, /'operating-entity', 'employee'/)
  assert.doesNotMatch(
    schema,
    /CREATE TABLE aux_(?:operating_entities|employees)/,
  )
  for (const table of [
    'bob_supplier_version_operating_entities',
    'bob_other_unit_version_operating_entities',
    'bob_sales_partner_version_operating_entities',
  ]) {
    const definition = schema.slice(
      schema.indexOf(`CREATE TABLE ${table}`),
      schema.indexOf(');', schema.indexOf(`CREATE TABLE ${table}`)),
    )
    assert.match(
      definition,
      /operating_entity_approval_entry_id varchar\(26\),/,
    )
    assert.doesNotMatch(
      definition,
      /operating_entity_approval_entry_id varchar\(26\) NOT NULL/,
    )
  }
  const vouReferences = schema.slice(
    schema.indexOf('CREATE TABLE vou_reference_snapshots'),
    schema.indexOf(
      ');',
      schema.indexOf('CREATE TABLE vou_reference_snapshots'),
    ),
  )
  assert.match(
    vouReferences,
    /aux_snapshot jsonb CHECK \(aux_snapshot IS NULL OR jsonb_typeof\(aux_snapshot\) = 'object'\)/,
  )
})

test('target schema admits asset current rows without adding shadow roots', async () => {
  const schema = await readFile(
    new URL('../../db/target-schema.sql', import.meta.url),
    'utf8',
  )
  const auxObjects = schema.slice(
    schema.indexOf('CREATE TABLE aux_objects'),
    schema.indexOf('CREATE TABLE aux_reference_facts'),
  )
  assert.match(auxObjects, /'warehouse', 'vehicle', 'fund-account'/)
  assert.doesNotMatch(
    schema,
    /CREATE TABLE aux_(?:warehouses|vehicles|fund_accounts)/,
  )
})
