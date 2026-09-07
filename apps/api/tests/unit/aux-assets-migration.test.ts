import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  auxAssetEntityForHistoricalVouReference,
  auxAssetPermissionMappings,
  convertAuxAssetHistoricalData,
  planAuxAssetSources,
  requiresAuxAssetPermissionMigration,
  type AuxAssetSourceEntry,
} from '../../src/aux/migration-assets.ts'

const entry = (
  overrides: Partial<AuxAssetSourceEntry>,
): AuxAssetSourceEntry => ({
  id: '01J00000000000000000000000',
  subjectId: '01J10000000000000000000000',
  entity: 'warehouse',
  versionNo: 1,
  status: 'APPROVED',
  ...overrides,
})

test('AUX asset migration chooses highest approved content and only open V1', () => {
  assert.deepEqual(
    planAuxAssetSources([
      entry({ id: 'approved-v1', versionNo: 1 }),
      entry({ id: 'approved-v2', versionNo: 2 }),
      entry({
        id: 'vehicle-v1',
        subjectId: 'vehicle-subject',
        entity: 'vehicle',
        status: 'PENDING',
      }),
    ]),
    {
      ok: true,
      sources: [
        {
          subjectId: '01J10000000000000000000000',
          entity: 'warehouse',
          entryId: 'approved-v2',
          source: 'HIGHEST_APPROVED',
        },
        {
          subjectId: 'vehicle-subject',
          entity: 'vehicle',
          entryId: 'vehicle-v1',
          source: 'OPEN_V1',
        },
      ],
    },
  )
})

test('AUX asset migration blocks unresolved candidates instead of silently choosing', () => {
  assert.deepEqual(
    planAuxAssetSources([
      entry({ id: 'approved-v1' }),
      entry({ id: 'candidate-v2', versionNo: 2, status: 'REJECTED' }),
    ]),
    {
      ok: false,
      blockers: [
        {
          kind: 'UNRESOLVED_CANDIDATE',
          entity: 'warehouse',
          subjectId: '01J10000000000000000000000',
          approvedEntryId: 'approved-v1',
          candidateEntryId: 'candidate-v2',
        },
      ],
    },
  )
  assert.equal(
    planAuxAssetSources([
      entry({ id: 'candidate-v2', versionNo: 2, status: 'PENDING' }),
    ]).ok,
    false,
  )
})

test('AUX asset permissions map only confirmed current-data authority', () => {
  for (const entity of ['warehouse', 'vehicle', 'fund-account'] as const) {
    assert.ok(
      auxAssetPermissionMappings.some(
        (mapping) =>
          mapping.from === `/dcl/${entity}/submit-new` &&
          mapping.to.length === 1 &&
          mapping.to[0] === `/aux/${entity}/create`,
      ),
    )
    assert.ok(
      auxAssetPermissionMappings.some(
        (mapping) =>
          mapping.from === `/dcl/${entity}/submit-change` &&
          mapping.to.join(',') ===
            `/aux/${entity}/save,/aux/${entity}/enable,/aux/${entity}/disable`,
      ),
    )
  }
  assert.ok(
    !auxAssetPermissionMappings.some(({ from }) =>
      /\/(approve|reject|unapprove|unreject|versions|audit-history|delete)$/.test(
        from,
      ),
    ),
  )
  assert.equal(
    requiresAuxAssetPermissionMigration(
      ['/dcl/warehouse/submit-change'],
      [
        '/aux/warehouse/save',
        '/aux/warehouse/enable',
        '/aux/warehouse/disable',
      ],
    ),
    true,
  )
})

test('historical asset conversion preserves adopted typed snapshots', () => {
  const managerId = '01J10000000000000000000001'
  const operatingEntityId = '01J10000000000000000000002'
  const otherUnitId = '01J10000000000000000000003'
  const otherUnitEntryId = '01J10000000000000000000004'
  const vehicleTypeId = '01J10000000000000000000005'

  assert.deepEqual(
    convertAuxAssetHistoricalData({
      entity: 'warehouse',
      row: {
        name: '一号仓',
        address: null,
        contact_name: '张三',
        contact_phone: null,
        manager_employee_id: managerId,
        manager_employee_code: 'EMP-0001',
        manager_employee_name: '历史负责人',
        remark: null,
        enabled: true,
      },
    }),
    {
      name: '一号仓',
      address: '',
      contactName: '张三',
      contactPhone: '',
      manager: { id: managerId, code: 'EMP-0001', name: '历史负责人' },
      remark: '',
    },
  )

  assert.deepEqual(
    convertAuxAssetHistoricalData({
      entity: 'vehicle',
      row: {
        name: '外协车',
        plate_number: '沪A12345',
        vehicle_type_object_id: vehicleTypeId,
        vehicle_type_snapshot: {
          id: vehicleTypeId,
          code: 'DIT-0001',
          name: '罐车',
        },
        carrier_affiliation_type: 'EXTERNAL',
        carrier_operating_entity_id: null,
        carrier_operating_entity_code: null,
        carrier_operating_entity_name: null,
        carrier_other_unit_object_id: otherUnitId,
        carrier_other_unit_approval_entry_id: otherUnitEntryId,
        carrier_other_unit_code: 'OTU-0001',
        carrier_other_unit_name: '历史承运商',
        carrier_snapshot: {
          kind: 'EXTERNAL',
          otherUnitId,
          approvalEntryId: otherUnitEntryId,
          code: 'OTU-0001',
          name: '历史承运商',
        },
        vin: null,
        engine_number: 'E-1',
        rated_load_micros: '12500000',
        bulk_liquid_capable: true,
        remark: null,
        enabled: false,
      },
    }),
    {
      name: '外协车',
      plateNumber: '沪A12345',
      vehicleType: { id: vehicleTypeId, code: 'DIT-0001', name: '罐车' },
      carrier: {
        kind: 'EXTERNAL',
        otherUnitId,
        approvalEntryId: otherUnitEntryId,
        code: 'OTU-0001',
        name: '历史承运商',
      },
      vin: '',
      engineNumber: 'E-1',
      ratedLoadKg: 12.5,
      bulkWaterCarrier: true,
      remark: '',
    },
  )

  assert.deepEqual(
    convertAuxAssetHistoricalData({
      entity: 'fund-account',
      row: {
        name: '基本户',
        currency: 'CNY',
        account_name: '测试公司',
        account_number: 'CN-12 34',
        bank_name: '测试银行',
        branch_name: null,
        operating_entity_id: operatingEntityId,
        operating_entity_code: 'OPE-0001',
        operating_entity_name: '历史主体',
        operating_entity_snapshot: {
          objectId: operatingEntityId,
          code: 'OPE-0001',
          name: '历史主体',
        },
        remark: null,
        enabled: true,
      },
    }),
    {
      name: '基本户',
      currency: 'CNY',
      accountName: '测试公司',
      bank: '测试银行',
      branch: '',
      accountNumber: 'CN1234',
      operatingEntity: {
        id: operatingEntityId,
        code: 'OPE-0001',
        name: '历史主体',
      },
      remark: '',
    },
  )
})

test('historical VOU asset references use a closed field/entity mapping', () => {
  for (const field of ['warehouse', 'materialWarehouse', 'finishedWarehouse'])
    assert.equal(
      auxAssetEntityForHistoricalVouReference(field, null),
      'warehouse',
    )
  assert.equal(
    auxAssetEntityForHistoricalVouReference('vehicle', null),
    'vehicle',
  )
  assert.equal(
    auxAssetEntityForHistoricalVouReference('fundAccount', null),
    'fund-account',
  )
  assert.equal(auxAssetEntityForHistoricalVouReference('supplier', null), null)
  assert.throws(() =>
    auxAssetEntityForHistoricalVouReference('warehouse', 'vehicle'),
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
