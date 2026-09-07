import type {
  FundAccountCurrentData,
  VehicleCurrentData,
  WarehouseCurrentData,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import {
  TargetBootstrapService,
  type PermissionCatalogMigrationReport,
  type PermissionPathMapping,
} from '../app/bootstrap.ts'
import { preserveLegacyBobArchivePermissionCatalog } from '../bob/migration-guard.ts'
import type { DB } from '../db/generated.ts'

export type AuxAssetEntity = 'warehouse' | 'vehicle' | 'fund-account'
export type AuxAssetSourceStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface AuxAssetSourceEntry {
  id: string
  subjectId: string
  entity: AuxAssetEntity
  versionNo: number
  status: AuxAssetSourceStatus
}

export interface AuxAssetSelectedSource {
  subjectId: string
  entity: AuxAssetEntity
  entryId: string
  source: 'HIGHEST_APPROVED' | 'OPEN_V1'
}

export interface AuxAssetMigrationBlocker {
  kind:
    | 'UNRESOLVED_CANDIDATE'
    | 'MISSING_CURRENT_SOURCE'
    | 'CURRENT_ALREADY_EXISTS'
    | 'INVALID_SOURCE_SNAPSHOT'
    | 'INVALID_HISTORICAL_REFERENCE'
  entity: AuxAssetEntity
  subjectId: string
  approvedEntryId: string | null
  candidateEntryId: string | null
  detail?: string
}

export type AuxAssetSourcePlan =
  | { ok: true; sources: AuxAssetSelectedSource[] }
  | { ok: false; blockers: AuxAssetMigrationBlocker[] }

const readPermissionMappings = (entity: AuxAssetEntity) =>
  [
    {
      from: `/bob/${entity}/query`,
      to: [`/aux/${entity}/query`],
    },
    {
      from: `/dcl/${entity}/query`,
      to: [`/aux/${entity}/query`],
    },
    {
      from: `/bob/${entity}/get`,
      to: [`/aux/${entity}/get`],
    },
    {
      from: `/dcl/${entity}/get`,
      to: [`/aux/${entity}/get`],
    },
  ] satisfies PermissionPathMapping[]

const writePermissionMappings = (entity: AuxAssetEntity) =>
  [
    {
      from: `/dcl/${entity}/submit-new`,
      to: [`/aux/${entity}/create`],
    },
    {
      from: `/dcl/${entity}/submit-change`,
      to: [
        `/aux/${entity}/save`,
        `/aux/${entity}/enable`,
        `/aux/${entity}/disable`,
      ],
    },
  ] satisfies PermissionPathMapping[]

export const auxAssetPermissionMappings: readonly PermissionPathMapping[] = [
  ...readPermissionMappings('warehouse'),
  ...writePermissionMappings('warehouse'),
  ...readPermissionMappings('vehicle'),
  ...writePermissionMappings('vehicle'),
  ...readPermissionMappings('fund-account'),
  ...writePermissionMappings('fund-account'),
]

export function requiresAuxAssetPermissionMigration(
  existingPaths: readonly string[],
  targetPaths: readonly string[],
): boolean {
  const existing = new Set(existingPaths)
  const target = new Set(targetPaths)
  return auxAssetPermissionMappings.some(
    (mapping) =>
      existing.has(mapping.from) &&
      !target.has(mapping.from) &&
      mapping.to.every((path) => target.has(path)),
  )
}

export type AuxAssetCurrentData =
  WarehouseCurrentData | VehicleCurrentData | FundAccountCurrentData

export interface AuxAssetCurrentImport {
  entity: AuxAssetEntity
  id: string
  code: string
  data: AuxAssetCurrentData
  enabled: boolean
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
}

export interface AuxAssetCurrentImporter {
  importCurrent(
    transaction: Transaction<DB>,
    input: AuxAssetCurrentImport,
  ): Promise<void>
}

export interface AuxAssetMigrationReport {
  warehouses: number
  vehicles: number
  fundAccounts: number
  openV1Sources: number
  vouReferenceSnapshots: number
  historicalReferenceFacts: number
  permissionCatalog: PermissionCatalogMigrationReport
}

export class AuxAssetMigrationBlockedError extends Error {
  readonly blockers: readonly AuxAssetMigrationBlocker[]

  constructor(blockers: readonly AuxAssetMigrationBlocker[]) {
    super('AUX asset migration is blocked by unresolved source data')
    this.name = 'AuxAssetMigrationBlockedError'
    this.blockers = blockers
  }
}

interface StoredSourceEntry extends AuxAssetSourceEntry {
  code: string | null
  subjectCreatedAt: Date
  subjectCreatedBy: string
  updatedAt: Date
  updatedBy: string
}

interface HistoricalReferenceFact {
  entity: AuxAssetEntity
  objectId: string
  approvalEntryId: string | null
  source: string
}

interface HistoricalVouReferenceRow {
  approvalEntryId: string
  field: string
  lineNo: number
  itemNo: number
  objectId: string
  approvalReferenceId: string | null
  referenceEntity: string | null
  referenceCode: string | null
}

interface HistoricalVouReferenceBackfill {
  row: HistoricalVouReferenceRow
  entity: AuxAssetEntity
  data: AuxAssetCurrentData
}

export interface WarehouseHistoricalRow {
  name: string
  address: string | null
  contact_name: string | null
  contact_phone: string | null
  manager_employee_id: string | null
  manager_employee_code: string | null
  manager_employee_name: string | null
  remark: string | null
  enabled: boolean
}

export interface VehicleHistoricalRow {
  name: string
  plate_number: string | null
  vehicle_type_object_id: string | null
  vehicle_type_snapshot: unknown
  carrier_affiliation_type: string | null
  carrier_operating_entity_id: string | null
  carrier_operating_entity_code: string | null
  carrier_operating_entity_name: string | null
  carrier_other_unit_object_id: string | null
  carrier_other_unit_approval_entry_id: string | null
  carrier_other_unit_code: string | null
  carrier_other_unit_name: string | null
  carrier_snapshot: unknown
  vin: string | null
  engine_number: string | null
  rated_load_micros: string | number | bigint | null
  bulk_liquid_capable: boolean
  remark: string | null
  enabled: boolean
}

export interface FundAccountHistoricalRow {
  name: string
  currency: string | null
  account_name: string | null
  account_number: string | null
  bank_name: string | null
  branch_name: string | null
  operating_entity_id: string | null
  operating_entity_code: string | null
  operating_entity_name: string | null
  operating_entity_snapshot: unknown
  remark: string | null
  enabled: boolean
}

export type AuxAssetHistoricalVersion =
  | { entity: 'warehouse'; row: WarehouseHistoricalRow }
  | { entity: 'vehicle'; row: VehicleHistoricalRow }
  | { entity: 'fund-account'; row: FundAccountHistoricalRow }

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function requiredText(value: unknown, field: string): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result) throw new Error(`${field} is missing`)
  return result
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function snapshot(
  value: unknown,
  expectedId: string | null,
  field: string,
): { id: string; code: string; name: string } {
  const source = record(value)
  const id = requiredText(source.id ?? source.objectId, `${field}.id`)
  const code = requiredText(source.code, `${field}.code`)
  const name = requiredText(source.name, `${field}.name`)
  if (!expectedId || id !== expectedId)
    throw new Error(`${field} snapshot does not match its stable ID`)
  return { id, code, name }
}

function stableColumns(
  id: string | null,
  code: string | null,
  name: string | null,
  field: string,
): { id: string; code: string; name: string } {
  if (!id || !code || !name)
    throw new Error(`${field} snapshot does not match its stable ID`)
  return {
    id: requiredText(id, `${field}.id`),
    code: requiredText(code, `${field}.code`),
    name: requiredText(name, `${field}.name`),
  }
}

function ratedLoadKg(value: VehicleHistoricalRow['rated_load_micros']): number {
  if (value === null) return 0
  const text = String(value)
  if (!/^-?\d+$/.test(text)) throw new Error('ratedLoadKg is invalid')
  const micros = BigInt(text)
  if (micros < 0n || micros > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('ratedLoadKg is outside the exact migration range')
  return Number(micros) / 1_000_000
}

export function convertAuxAssetHistoricalData(source: {
  entity: 'warehouse'
  row: WarehouseHistoricalRow
}): WarehouseCurrentData
export function convertAuxAssetHistoricalData(source: {
  entity: 'vehicle'
  row: VehicleHistoricalRow
}): VehicleCurrentData
export function convertAuxAssetHistoricalData(source: {
  entity: 'fund-account'
  row: FundAccountHistoricalRow
}): FundAccountCurrentData
export function convertAuxAssetHistoricalData(
  source: AuxAssetHistoricalVersion,
): AuxAssetCurrentData {
  if (source.entity === 'warehouse') {
    const row = source.row
    const manager = row.manager_employee_id
      ? stableColumns(
          row.manager_employee_id,
          row.manager_employee_code,
          row.manager_employee_name,
          'manager',
        )
      : null
    return {
      name: requiredText(row.name, 'name'),
      address: optionalText(row.address),
      contactName: optionalText(row.contact_name),
      contactPhone: optionalText(row.contact_phone),
      manager,
      remark: optionalText(row.remark),
    }
  }
  if (source.entity === 'vehicle') {
    const row = source.row
    const vehicleType = snapshot(
      row.vehicle_type_snapshot,
      row.vehicle_type_object_id,
      'vehicleType',
    )
    const carrierSnapshot = record(row.carrier_snapshot)
    const kind = row.carrier_affiliation_type
    if (carrierSnapshot.kind !== kind)
      throw new Error('carrier snapshot does not match its affiliation type')
    const carrier: VehicleCurrentData['carrier'] =
      kind === 'INTERNAL'
        ? {
            kind,
            operatingEntityId: stableColumns(
              row.carrier_operating_entity_id,
              row.carrier_operating_entity_code,
              row.carrier_operating_entity_name,
              'carrier',
            ).id,
            code: requiredText(carrierSnapshot.code, 'carrier.code'),
            name: requiredText(carrierSnapshot.name, 'carrier.name'),
          }
        : kind === 'EXTERNAL'
          ? {
              kind,
              otherUnitId: stableColumns(
                row.carrier_other_unit_object_id,
                row.carrier_other_unit_code,
                row.carrier_other_unit_name,
                'carrier',
              ).id,
              approvalEntryId: requiredText(
                row.carrier_other_unit_approval_entry_id,
                'carrier.approvalEntryId',
              ),
              code: requiredText(carrierSnapshot.code, 'carrier.code'),
              name: requiredText(carrierSnapshot.name, 'carrier.name'),
            }
          : (() => {
              throw new Error('carrier affiliation type is invalid')
            })()
    const carrierId =
      carrier.kind === 'INTERNAL'
        ? carrier.operatingEntityId
        : carrier.otherUnitId
    const snapshotId = optionalText(
      carrierSnapshot.operatingEntityId ?? carrierSnapshot.otherUnitId,
    )
    if (
      carrierId !== snapshotId ||
      carrier.code !==
        (carrier.kind === 'INTERNAL'
          ? row.carrier_operating_entity_code
          : row.carrier_other_unit_code) ||
      carrier.name !==
        (carrier.kind === 'INTERNAL'
          ? row.carrier_operating_entity_name
          : row.carrier_other_unit_name) ||
      (carrier.kind === 'EXTERNAL' &&
        carrier.approvalEntryId !== carrierSnapshot.approvalEntryId)
    )
      throw new Error('carrier snapshot does not match its exact reference')
    return {
      name: requiredText(row.name, 'name'),
      plateNumber: requiredText(row.plate_number, 'plateNumber')
        .replace(/\s/g, '')
        .toUpperCase(),
      vehicleType,
      carrier,
      vin: optionalText(row.vin).toUpperCase(),
      engineNumber: optionalText(row.engine_number),
      ratedLoadKg: ratedLoadKg(row.rated_load_micros),
      bulkWaterCarrier: row.bulk_liquid_capable,
      remark: optionalText(row.remark),
    }
  }
  const row = source.row
  const operatingEntity = snapshot(
    row.operating_entity_snapshot,
    row.operating_entity_id,
    'operatingEntity',
  )
  if (
    operatingEntity.code !== row.operating_entity_code ||
    operatingEntity.name !== row.operating_entity_name
  )
    throw new Error(
      'operatingEntity snapshot does not match its stable reference',
    )
  return {
    name: requiredText(row.name, 'name'),
    currency: requiredText(row.currency, 'currency').toUpperCase(),
    accountName: requiredText(row.account_name, 'accountName'),
    bank: requiredText(row.bank_name, 'bank'),
    branch: optionalText(row.branch_name),
    accountNumber: requiredText(row.account_number, 'accountNumber')
      .replace(/[\s-]/g, '')
      .toUpperCase(),
    operatingEntity,
    remark: optionalText(row.remark),
  }
}

export function auxAssetEntityForHistoricalVouReference(
  field: string,
  referenceEntity: string | null,
): AuxAssetEntity | null {
  const leaf =
    field
      .split('.')
      .at(-1)
      ?.replace(/\[\d+\]$/, '') ?? ''
  const entity = [
    'warehouse',
    'materialWarehouse',
    'finishedWarehouse',
  ].includes(leaf)
    ? 'warehouse'
    : leaf === 'vehicle'
      ? 'vehicle'
      : leaf === 'fundAccount'
        ? 'fund-account'
        : null
  if (!entity) return null
  if (referenceEntity && referenceEntity !== entity)
    throw new Error(
      `historical VOU reference entity ${referenceEntity} does not match ${field}`,
    )
  return entity
}

export class AuxAssetMigrationService {
  private readonly db: Kysely<DB>
  private readonly importer: AuxAssetCurrentImporter
  private readonly bootstrap: TargetBootstrapService

  constructor(
    db: Kysely<DB>,
    importer: AuxAssetCurrentImporter,
    bootstrap = new TargetBootstrapService(db),
  ) {
    this.db = db
    this.importer = importer
    this.bootstrap = bootstrap
  }

  async migrate(
    targetCatalog: readonly TargetPermissionCatalogEntry[],
  ): Promise<AuxAssetMigrationReport> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('aux:asset-one-time-migration', 0))`.execute(
        transaction,
      )
      await this.upgradeSchema(transaction)
      await sql`
        LOCK TABLE dcl_subjects, approval_entries, aux_objects,
          aux_reference_facts, vou_reference_snapshots,
          dcl_warehouse_versions, dcl_vehicle_versions,
          dcl_fund_account_versions, dcl_warehouse_reference_facts,
          dcl_warehouse_usage_facts, dcl_code_counters,
          object_number_counters, acc_opening_snapshots,
          acc_journal_entries, acc_journal_lines, acc_inventory_entries,
          app_permissions, app_role_permissions, app_roles, app_users,
          app_user_roles
        IN SHARE ROW EXCLUSIVE MODE
      `.execute(transaction)
      const sourceRows = await this.readSources(transaction)
      const sourcePlan = planAuxAssetSources(sourceRows)
      const blockers: AuxAssetMigrationBlocker[] = sourcePlan.ok
        ? []
        : [...sourcePlan.blockers]
      const subjectsWithEntries = new Set(
        sourceRows.map((source) => source.subjectId),
      )
      const subjects = await sql<{
        id: string
        entity: AuxAssetEntity
      }>`
        SELECT id, entity
        FROM dcl_subjects
        WHERE entity IN ('warehouse', 'vehicle', 'fund-account')
        ORDER BY entity, id
      `.execute(transaction)
      for (const subject of subjects.rows)
        if (!subjectsWithEntries.has(subject.id))
          blockers.push({
            kind: 'MISSING_CURRENT_SOURCE',
            entity: subject.entity,
            subjectId: subject.id,
            approvedEntryId: null,
            candidateEntryId: null,
          })
      const existing = await sql<{ id: string; entity: AuxAssetEntity }>`
        SELECT id, entity
        FROM aux_objects
        WHERE entity IN ('warehouse', 'vehicle', 'fund-account')
        FOR UPDATE
      `.execute(transaction)
      for (const row of existing.rows)
        blockers.push({
          kind: 'CURRENT_ALREADY_EXISTS',
          entity: row.entity,
          subjectId: row.id,
          approvedEntryId: null,
          candidateEntryId: null,
        })
      if (!sourcePlan.ok || blockers.length > 0)
        throw new AuxAssetMigrationBlockedError(blockers)

      const byEntryId = new Map(sourceRows.map((row) => [row.id, row]))
      const selected = sourcePlan.sources
        .map((selection) => ({
          ...selection,
          entry: byEntryId.get(selection.entryId)!,
        }))
        .sort((left, right) =>
          left.entity === right.entity
            ? left.subjectId.localeCompare(right.subjectId)
            : left.entity.localeCompare(right.entity),
        )
      const imports: Array<{
        source: (typeof selected)[number]
        current: AuxAssetCurrentImport
      }> = []
      const invalidSources: AuxAssetMigrationBlocker[] = []
      for (const source of selected) {
        try {
          imports.push({
            source,
            current: await this.currentImport(transaction, source.entry),
          })
        } catch (error) {
          invalidSources.push({
            kind: 'INVALID_SOURCE_SNAPSHOT',
            entity: source.entity,
            subjectId: source.subjectId,
            approvedEntryId:
              source.source === 'HIGHEST_APPROVED' ? source.entryId : null,
            candidateEntryId:
              source.source === 'OPEN_V1' ? source.entryId : null,
            detail: error instanceof Error ? error.message : String(error),
          })
        }
      }
      const selectedEntities = new Map(
        selected.map((source) => [source.subjectId, source.entity]),
      )
      const historicalReferenceFacts =
        await this.readHistoricalReferenceFacts(transaction)
      const vouBackfill = await this.prepareHistoricalVouBackfill(transaction)
      invalidSources.push(...vouBackfill.blockers)
      const allHistoricalReferenceFacts = [
        ...historicalReferenceFacts,
        ...vouBackfill.backfills.map(({ row, entity }) => ({
          entity,
          objectId: row.objectId,
          approvalEntryId: row.approvalReferenceId,
          source: `vou:${row.approvalEntryId}:${row.field}:${row.lineNo}:${row.itemNo}`,
        })),
      ]
      for (const fact of allHistoricalReferenceFacts)
        if (selectedEntities.get(fact.objectId) !== fact.entity)
          invalidSources.push({
            kind: 'INVALID_HISTORICAL_REFERENCE',
            entity: fact.entity,
            subjectId: fact.objectId,
            approvedEntryId: fact.approvalEntryId,
            candidateEntryId: null,
            detail: `${fact.source}: referenced stable identity is absent or has another entity`,
          })
      if (invalidSources.length > 0)
        throw new AuxAssetMigrationBlockedError(invalidSources)

      for (const { source, current } of imports) {
        try {
          await this.importer.importCurrent(transaction, current)
        } catch (error) {
          throw new AuxAssetMigrationBlockedError([
            {
              kind: 'INVALID_SOURCE_SNAPSHOT',
              entity: source.entity,
              subjectId: source.subjectId,
              approvedEntryId:
                source.source === 'HIGHEST_APPROVED' ? source.entryId : null,
              candidateEntryId:
                source.source === 'OPEN_V1' ? source.entryId : null,
              detail: error instanceof Error ? error.message : String(error),
            },
          ])
        }
        await transaction
          .insertInto('app_audit_events')
          .values({
            id: ulid(),
            event_type: `AUX_${source.entity.replaceAll('-', '_').toUpperCase()}_MIGRATED`,
            actor_user_id: current.updatedBy,
            target_type: source.entity,
            target_id: current.id,
            result: 'SUCCESS',
            summary: JSON.stringify({
              sourceApprovalEntryId: source.entryId,
              sourceKind: source.source,
            }),
            created_at: current.updatedAt,
            created_by: current.updatedBy,
          })
          .execute()
      }
      await this.applyHistoricalVouBackfill(transaction, vouBackfill.backfills)
      const registeredHistoricalReferenceFacts =
        await this.registerHistoricalReferenceFacts(
          transaction,
          allHistoricalReferenceFacts,
        )
      await sql`
        INSERT INTO object_number_counters(domain, entity, last_value)
        SELECT 'aux', entity, next_value - 1
        FROM dcl_code_counters
        WHERE entity IN ('warehouse', 'vehicle', 'fund-account')
        ON CONFLICT (domain, entity) DO UPDATE
          SET last_value = GREATEST(
            object_number_counters.last_value,
            EXCLUDED.last_value
          )
      `.execute(transaction)
      const permissionCatalog =
        await this.bootstrap.migratePermissionCatalogInTransaction(
          transaction,
          preserveLegacyBobArchivePermissionCatalog(
            targetCatalog,
            await transaction
              .selectFrom('app_permissions')
              .select([
                'id',
                'path',
                'domain',
                'entity',
                'action',
                'description',
              ])
              .execute(),
          ),
          auxAssetPermissionMappings,
        )
      return {
        warehouses: selected.filter((source) => source.entity === 'warehouse')
          .length,
        vehicles: selected.filter((source) => source.entity === 'vehicle')
          .length,
        fundAccounts: selected.filter(
          (source) => source.entity === 'fund-account',
        ).length,
        openV1Sources: selected.filter((source) => source.source === 'OPEN_V1')
          .length,
        vouReferenceSnapshots: vouBackfill.backfills.length,
        historicalReferenceFacts: registeredHistoricalReferenceFacts,
        permissionCatalog,
      }
    })
  }

  private async upgradeSchema(transaction: Transaction<DB>): Promise<void> {
    await sql`
      ALTER TABLE aux_objects
        DROP CONSTRAINT IF EXISTS aux_objects_entity_check
    `.execute(transaction)
    await sql`
      ALTER TABLE aux_objects
        ADD CONSTRAINT aux_objects_entity_check CHECK (entity IN (
          'product-category', 'product-type', 'employee-category', 'department',
          'position', 'settlement-method', 'payment-method', 'dictionary-type',
          'dictionary-item', 'measurement-unit', 'income-expense-type',
          'asset-category', 'operating-entity', 'employee',
          'warehouse', 'vehicle', 'fund-account'
        ))
    `.execute(transaction)
  }

  private async readSources(
    transaction: Transaction<DB>,
  ): Promise<StoredSourceEntry[]> {
    const rows = await sql<{
      subject_id: string
      entity: AuxAssetEntity
      code: string | null
      subject_created_at: Date
      subject_created_by: string
      entry_id: string | null
      version_no: number | null
      status: AuxAssetSourceStatus | null
      updated_at: Date | null
      updated_by: string | null
    }>`
      SELECT subject.id AS subject_id, subject.entity, subject.code,
        subject.created_at AS subject_created_at,
        subject.created_by AS subject_created_by,
        entry.id AS entry_id, entry.version_no, entry.status,
        entry.updated_at, entry.updated_by
      FROM dcl_subjects subject
      LEFT JOIN approval_entries entry
        ON entry.domain = 'dcl'
       AND entry.entity = subject.entity
       AND entry.subject_id = subject.id
      WHERE subject.entity IN ('warehouse', 'vehicle', 'fund-account')
      ORDER BY subject.entity, subject.id, entry.version_no, entry.id
    `.execute(transaction)
    return rows.rows.flatMap((row) =>
      row.entry_id &&
      row.version_no !== null &&
      row.status &&
      row.updated_at &&
      row.updated_by
        ? [
            {
              id: row.entry_id,
              subjectId: row.subject_id,
              entity: row.entity,
              versionNo: row.version_no,
              status: row.status,
              code: row.code,
              subjectCreatedAt: row.subject_created_at,
              subjectCreatedBy: row.subject_created_by,
              updatedAt: row.updated_at,
              updatedBy: row.updated_by,
            },
          ]
        : [],
    )
  }

  private async currentImport(
    transaction: Transaction<DB>,
    source: StoredSourceEntry,
  ): Promise<AuxAssetCurrentImport> {
    if (!source.code)
      throw new Error('source stable identity has no business code')
    const common = {
      entity: source.entity,
      id: source.subjectId,
      code: source.code,
      createdAt: source.subjectCreatedAt,
      createdBy: source.subjectCreatedBy,
      updatedAt: source.updatedAt,
      updatedBy: source.updatedBy,
    }
    if (source.entity === 'warehouse') {
      const result = await sql<WarehouseHistoricalRow>`
        SELECT name, address, contact_name, contact_phone,
          manager_employee_id, manager_employee_code, manager_employee_name,
          remark, enabled
        FROM dcl_warehouse_versions
        WHERE approval_entry_id = ${source.id}
      `.execute(transaction)
      const row = result.rows[0]
      if (!row) throw new Error('warehouse typed snapshot is missing')
      return {
        ...common,
        entity: source.entity,
        enabled: row.enabled,
        data: convertAuxAssetHistoricalData({ entity: source.entity, row }),
      }
    }
    if (source.entity === 'vehicle') {
      const result = await sql<VehicleHistoricalRow>`
        SELECT name, plate_number, vehicle_type_object_id,
          vehicle_type_snapshot, carrier_affiliation_type,
          carrier_operating_entity_id, carrier_operating_entity_code,
          carrier_operating_entity_name, carrier_other_unit_object_id,
          carrier_other_unit_approval_entry_id, carrier_other_unit_code,
          carrier_other_unit_name, carrier_snapshot, vin, engine_number,
          rated_load_micros, bulk_liquid_capable, remark, enabled
        FROM dcl_vehicle_versions
        WHERE approval_entry_id = ${source.id}
      `.execute(transaction)
      const row = result.rows[0]
      if (!row) throw new Error('vehicle typed snapshot is missing')
      return {
        ...common,
        entity: source.entity,
        enabled: row.enabled,
        data: convertAuxAssetHistoricalData({ entity: source.entity, row }),
      }
    }
    const result = await sql<FundAccountHistoricalRow>`
      SELECT name, currency, account_name, account_number, bank_name,
        branch_name, operating_entity_id, operating_entity_code,
        operating_entity_name, operating_entity_snapshot, remark, enabled
      FROM dcl_fund_account_versions
      WHERE approval_entry_id = ${source.id}
    `.execute(transaction)
    const row = result.rows[0]
    if (!row) throw new Error('fund-account typed snapshot is missing')
    return {
      ...common,
      entity: source.entity,
      enabled: row.enabled,
      data: convertAuxAssetHistoricalData({ entity: source.entity, row }),
    }
  }

  private async readHistoricalReferenceFacts(
    transaction: Transaction<DB>,
  ): Promise<HistoricalReferenceFact[]> {
    const result = await sql<{
      entity: AuxAssetEntity
      object_id: string
      approval_entry_id: string | null
      source: string
    }>`
      SELECT 'warehouse' AS entity, warehouse_id AS object_id,
        approval_entry_id,
        concat('dcl:warehouse-reference:', id) AS source
      FROM dcl_warehouse_reference_facts
      UNION ALL
      SELECT 'warehouse', warehouse_id, NULL,
        concat('dcl:warehouse-usage:', id)
      FROM dcl_warehouse_usage_facts
      UNION ALL
      SELECT 'warehouse', warehouse_id,
        COALESCE(vou_approval_entry_id, opening_approval_entry_id),
        concat('acc:inventory:', id)
      FROM acc_inventory_entries
      UNION ALL
      SELECT 'warehouse', line.dimensions->>'WAREHOUSE', journal.id,
        concat('acc:journal:', journal.id, ':line:', line.id, ':dimension:WAREHOUSE')
      FROM acc_journal_lines line
      JOIN acc_journal_entries journal ON journal.id = line.journal_entry_id
      WHERE nullif(line.dimensions->>'WAREHOUSE', '') IS NOT NULL
      UNION ALL
      SELECT 'fund-account', line.dimensions->>'FUND_ACCOUNT', journal.id,
        concat('acc:journal:', journal.id, ':line:', line.id, ':dimension:FUND_ACCOUNT')
      FROM acc_journal_lines line
      JOIN acc_journal_entries journal ON journal.id = line.journal_entry_id
      WHERE nullif(line.dimensions->>'FUND_ACCOUNT', '') IS NOT NULL
      UNION ALL
      SELECT 'warehouse', line.value->'dimensions'->>'WAREHOUSE',
        opening.approval_entry_id,
        concat('acc:opening:', opening.approval_entry_id, ':line:',
          line.ordinality, ':dimension:WAREHOUSE')
      FROM acc_opening_snapshots opening
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(opening.payload->'lines') = 'array'
          THEN opening.payload->'lines' ELSE '[]'::jsonb END
      ) WITH ORDINALITY line(value, ordinality)
      WHERE nullif(line.value->'dimensions'->>'WAREHOUSE', '') IS NOT NULL
      UNION ALL
      SELECT 'fund-account', line.value->'dimensions'->>'FUND_ACCOUNT',
        opening.approval_entry_id,
        concat('acc:opening:', opening.approval_entry_id, ':line:',
          line.ordinality, ':dimension:FUND_ACCOUNT')
      FROM acc_opening_snapshots opening
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(opening.payload->'lines') = 'array'
          THEN opening.payload->'lines' ELSE '[]'::jsonb END
      ) WITH ORDINALITY line(value, ordinality)
      WHERE nullif(line.value->'dimensions'->>'FUND_ACCOUNT', '') IS NOT NULL
      ORDER BY entity, object_id, source
    `.execute(transaction)
    return result.rows.map((row) => ({
      entity: row.entity,
      objectId: row.object_id,
      approvalEntryId: row.approval_entry_id,
      source: row.source,
    }))
  }

  private async prepareHistoricalVouBackfill(
    transaction: Transaction<DB>,
  ): Promise<{
    backfills: HistoricalVouReferenceBackfill[]
    blockers: AuxAssetMigrationBlocker[]
  }> {
    const result = await sql<{
      approval_entry_id: string
      field: string
      line_no: number
      item_no: number
      object_id: string
      approval_reference_id: string | null
      reference_entity: string | null
      reference_code: string | null
    }>`
      SELECT approval_entry_id, field, line_no, item_no, object_id,
        approval_reference_id, reference_entity, reference_code
      FROM vou_reference_snapshots
      WHERE aux_snapshot IS NULL
      ORDER BY approval_entry_id, field, line_no, item_no
    `.execute(transaction)
    const rows: HistoricalVouReferenceRow[] = result.rows.map((row) => ({
      approvalEntryId: row.approval_entry_id,
      field: row.field,
      lineNo: row.line_no,
      itemNo: row.item_no,
      objectId: row.object_id,
      approvalReferenceId: row.approval_reference_id,
      referenceEntity: row.reference_entity,
      referenceCode: row.reference_code,
    }))
    const backfills: HistoricalVouReferenceBackfill[] = []
    const blockers: AuxAssetMigrationBlocker[] = []
    const historical = new Map<
      string,
      { objectId: string; code: string; data: AuxAssetCurrentData }
    >()
    for (const row of rows) {
      let entity: AuxAssetEntity | null
      try {
        entity = auxAssetEntityForHistoricalVouReference(
          row.field,
          row.referenceEntity,
        )
      } catch (error) {
        const expected = auxAssetEntityForHistoricalVouReference(
          row.field,
          null,
        )
        blockers.push(
          this.historicalReferenceBlocker(expected ?? 'warehouse', row, error),
        )
        continue
      }
      if (!entity) continue
      if (!row.approvalReferenceId) {
        blockers.push(
          this.historicalReferenceBlocker(
            entity,
            row,
            new Error('historical VOU asset reference has no Approval Entry'),
          ),
        )
        continue
      }
      const key = `${entity}\0${row.approvalReferenceId}`
      try {
        let exact = historical.get(key)
        if (!exact) {
          exact = await this.readHistoricalAuxAssetData(
            transaction,
            entity,
            row.approvalReferenceId,
          )
          historical.set(key, exact)
        }
        if (
          exact.objectId !== row.objectId ||
          (row.referenceCode !== null && exact.code !== row.referenceCode)
        )
          throw new Error(
            'historical VOU asset reference does not match its stable identity',
          )
        backfills.push({ row, entity, data: exact.data })
      } catch (error) {
        blockers.push(this.historicalReferenceBlocker(entity, row, error))
      }
    }
    return { backfills, blockers }
  }

  private historicalReferenceBlocker(
    entity: AuxAssetEntity,
    row: HistoricalVouReferenceRow,
    error: unknown,
  ): AuxAssetMigrationBlocker {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      kind: 'INVALID_HISTORICAL_REFERENCE',
      entity,
      subjectId: row.objectId,
      approvedEntryId: row.approvalReferenceId,
      candidateEntryId: null,
      detail: `VOU ${row.approvalEntryId} ${row.field}:${row.lineNo}:${row.itemNo}: ${reason}`,
    }
  }

  private async readHistoricalAuxAssetData(
    transaction: Transaction<DB>,
    entity: AuxAssetEntity,
    approvalEntryId: string,
  ): Promise<{ objectId: string; code: string; data: AuxAssetCurrentData }> {
    const source = await sql<{ object_id: string; code: string | null }>`
      SELECT entry.subject_id AS object_id, subject.code
      FROM approval_entries entry
      JOIN dcl_subjects subject ON subject.id = entry.subject_id
      WHERE entry.id = ${approvalEntryId}
        AND entry.domain = 'dcl'
        AND entry.entity = ${entity}
        AND subject.entity = ${entity}
    `.execute(transaction)
    const identity = source.rows[0]
    if (!identity?.code)
      throw new Error(`exact ${entity} typed Approval snapshot is missing`)
    const stored: StoredSourceEntry = {
      id: approvalEntryId,
      subjectId: identity.object_id,
      entity,
      versionNo: 1,
      status: 'APPROVED',
      code: identity.code,
      subjectCreatedAt: new Date(0),
      subjectCreatedBy: '',
      updatedAt: new Date(0),
      updatedBy: '',
    }
    const current = await this.currentImport(transaction, stored)
    return { objectId: current.id, code: current.code, data: current.data }
  }

  private async applyHistoricalVouBackfill(
    transaction: Transaction<DB>,
    backfills: readonly HistoricalVouReferenceBackfill[],
  ): Promise<void> {
    for (const { row, entity, data } of backfills)
      await sql`
        UPDATE vou_reference_snapshots
        SET aux_snapshot = ${JSON.stringify(data)}::jsonb,
          reference_entity = ${entity}
        WHERE approval_entry_id = ${row.approvalEntryId}
          AND field = ${row.field}
          AND line_no = ${row.lineNo}
          AND item_no = ${row.itemNo}
          AND aux_snapshot IS NULL
      `.execute(transaction)
  }

  private async registerHistoricalReferenceFacts(
    transaction: Transaction<DB>,
    facts: readonly HistoricalReferenceFact[],
  ): Promise<number> {
    const unique = [
      ...new Map(
        facts.map((fact) => [
          `${fact.entity}\0${fact.objectId}\0${fact.source}`,
          fact,
        ]),
      ).values(),
    ]
    for (let offset = 0; offset < unique.length; offset += 500)
      await transaction
        .insertInto('aux_reference_facts')
        .values(
          unique.slice(offset, offset + 500).map((fact) => ({
            id: ulid(),
            aux_object_id: fact.objectId,
            source: fact.source,
          })),
        )
        .execute()
    return unique.length
  }
}

export function planAuxAssetSources(
  entries: readonly AuxAssetSourceEntry[],
): AuxAssetSourcePlan {
  const grouped = new Map<
    string,
    { entity: AuxAssetEntity; entries: AuxAssetSourceEntry[] }
  >()
  for (const entry of entries) {
    const existing = grouped.get(entry.subjectId)
    if (existing) existing.entries.push(entry)
    else
      grouped.set(entry.subjectId, { entity: entry.entity, entries: [entry] })
  }

  const sources: AuxAssetSelectedSource[] = []
  const blockers: AuxAssetMigrationBlocker[] = []
  for (const [subjectId, group] of grouped) {
    const approved = group.entries
      .filter((entry) => entry.status === 'APPROVED')
      .sort((left, right) => right.versionNo - left.versionNo)[0]
    const candidates = group.entries
      .filter(
        (entry) => entry.status === 'PENDING' || entry.status === 'REJECTED',
      )
      .sort(
        (left, right) =>
          left.versionNo - right.versionNo || left.id.localeCompare(right.id),
      )
    const candidate = candidates[0]
    if (
      candidate &&
      (approved || candidates.length !== 1 || candidate.versionNo !== 1)
    ) {
      blockers.push({
        kind: 'UNRESOLVED_CANDIDATE',
        entity: group.entity,
        subjectId,
        approvedEntryId: approved?.id ?? null,
        candidateEntryId: candidate.id,
      })
      continue
    }
    const selected = approved ?? candidate
    if (!selected) {
      blockers.push({
        kind: 'MISSING_CURRENT_SOURCE',
        entity: group.entity,
        subjectId,
        approvedEntryId: null,
        candidateEntryId: null,
      })
      continue
    }
    sources.push({
      subjectId,
      entity: group.entity,
      entryId: selected.id,
      source: approved ? 'HIGHEST_APPROVED' : 'OPEN_V1',
    })
  }
  return blockers.length > 0 ? { ok: false, blockers } : { ok: true, sources }
}
