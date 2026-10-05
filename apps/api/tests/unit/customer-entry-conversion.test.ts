import assert from 'node:assert/strict'
import test from 'node:test'
import { projectArchives } from '../../src/dcl/customer-cutover/plan.ts'

test('historical customer conversion backfills ordinary dictionary purpose with recovery evidence', () => {
  const source = {
    aux_objects: [
      { id: 'dictionary', entity: 'dictionary-type', data: { name: '旧分类' } },
    ],
  }
  const plan = projectArchives(source)
  assert.equal(
    (plan.tables.aux_objects![0]!.data as { purpose: string }).purpose,
    'GENERAL',
  )
  assert.deepEqual(plan.evidence.aux_objects, source.aux_objects)
  assert.equal('purpose' in source.aux_objects[0]!.data, false)
})

test('historical customer preview blocks calculation data whose customer classification has no approved conversion', () => {
  for (const table of [
    'vou_intermediary_source_line_snapshots',
    'vou_intermediary_calculation_details',
    'vou_intermediary_scripts',
  ]) {
    const plan = projectArchives({
      [table]: [{ id: 'existing', customer_type_code: 'old' }],
    })
    assert.deepEqual(plan.review, [
      {
        kind: 'CUSTOMER_ENTRY_CALCULATION_CONVERSION_REQUIRED',
        table,
        identity: 'existing',
      },
    ])
  }
})
