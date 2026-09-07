import type {
  EmployeeCurrentData,
  OperatingEntityCurrentData,
} from '@zerp/model'
import { sql, type Kysely, type Transaction } from 'kysely'
import { ulid } from 'ulid'

import type { TargetPermissionCatalogEntry } from '../../scripts/target-artifacts.ts'
import { auxPeopleDataSchemas } from '../app/aux-contract.ts'
import {
  TargetBootstrapService,
  type PermissionCatalogMigrationReport,
  type PermissionPathMapping,
} from '../app/bootstrap.ts'
import type { DB } from '../db/generated.ts'

export type AuxPeopleEntity = 'operating-entity' | 'employee'
export type AuxPeopleSourceStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface AuxPeopleSourceEntry {
  id: string
  subjectId: string
  entity: AuxPeopleEntity
  versionNo: number
  status: AuxPeopleSourceStatus
}

export interface AuxPeopleSelectedSource {
  subjectId: string
  entity: AuxPeopleEntity
  entryId: string
  source: 'HIGHEST_APPROVED' | 'OPEN_V1'
}

export interface AuxPeopleMigrationBlocker {
  kind:
    | 'UNRESOLVED_CANDIDATE'
    | 'MISSING_CURRENT_SOURCE'
    | 'CURRENT_ALREADY_EXISTS'
    | 'INVALID_SOURCE_SNAPSHOT'
    | 'INVALID_HISTORICAL_REFERENCE'
  entity: AuxPeopleEntity
  subjectId: string
  approvedEntryId: string | null
  candidateEntryId: string | null
  detail?: string
}

export type AuxPeopleSourcePlan =
  | { ok: true; sources: AuxPeopleSelectedSource[] }
  | { ok: false; blockers: AuxPeopleMigrationBlocker[] }

export const auxPeoplePermissionMappings: readonly PermissionPathMapping[] = [
  {
    from: '/bob/operating-entity/query',
    to: ['/aux/operating-entity/query'],
  },
  {
    from: '/dcl/operating-entity/query',
    to: ['/aux/operating-entity/query'],
  },
  {
    from: '/bob/operating-entity/get',
    to: ['/aux/operating-entity/get'],
  },
  {
    from: '/dcl/operating-entity/get',
    to: ['/aux/operating-entity/get'],
  },
  {
    from: '/dcl/operating-entity/submit-new',
    to: ['/aux/operating-entity/create'],
  },
  {
    from: '/dcl/operating-entity/submit-change',
    to: [
      '/aux/operating-entity/save',
      '/aux/operating-entity/enable',
      '/aux/operating-entity/disable',
    ],
  },
  { from: '/bob/employee/query', to: ['/aux/employee/query'] },
  { from: '/dcl/employee/query', to: ['/aux/employee/query'] },
  { from: '/bob/employee/get', to: ['/aux/employee/get'] },
  { from: '/dcl/employee/get', to: ['/aux/employee/get'] },
  { from: '/dcl/employee/submit-new', to: ['/aux/employee/create'] },
  {
    from: '/dcl/employee/submit-change',
    to: ['/aux/employee/save', '/aux/employee/enable', '/aux/employee/disable'],
  },
]

export function requiresAuxPeoplePermissionMigration(
  existingPaths: readonly string[],
  targetPaths: readonly string[],
): boolean {
  const existing = new Set(existingPaths)
  const target = new Set(targetPaths)
  return auxPeoplePermissionMappings.some(
    (mapping) =>
      existing.has(mapping.from) &&
      !target.has(mapping.from) &&
      mapping.to.every((path) => target.has(path)),
  )
}

export type AuxPeopleCurrentData =
  OperatingEntityCurrentData | EmployeeCurrentData

export interface AuxPeopleCurrentImport {
  entity: AuxPeopleEntity
  id: string
  code: string
  data: AuxPeopleCurrentData
  enabled: boolean
  createdAt: Date
  createdBy: string
  updatedAt: Date
  updatedBy: string
}

export interface AuxPeopleCurrentImporter {
  importCurrent(
    transaction: Transaction<DB>,
    input: AuxPeopleCurrentImport,
  ): Promise<void>
}

export interface AuxPeopleMigrationReport {
  operatingEntities: number
  employees: number
  openV1Sources: number
  vouReferenceSnapshots: number
  historicalReferenceFacts: number
  permissionCatalog: PermissionCatalogMigrationReport
}

export class AuxPeopleMigrationBlockedError extends Error {
  readonly blockers: readonly AuxPeopleMigrationBlocker[]

  constructor(blockers: readonly AuxPeopleMigrationBlocker[]) {
    super('AUX people migration is blocked by unresolved source data')
    this.name = 'AuxPeopleMigrationBlockedError'
    this.blockers = blockers
  }
}

interface StoredSourceEntry extends AuxPeopleSourceEntry {
  code: string | null
  subjectCreatedAt: Date
  subjectCreatedBy: string
  updatedAt: Date
  updatedBy: string
}

interface HistoricalReferenceFact {
  entity: AuxPeopleEntity
  objectId: string
  approvalEntryId: string
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
  entity: AuxPeopleEntity
  data: AuxPeopleCurrentData
}

export interface OperatingEntityHistoricalRow {
  legal_name: string
  short_name: string
  legal_identifier: string | null
  registered_address: string
  contact_name: string
  contact_phone: string
  invoice_title: string
  invoice_address: string
  invoice_phone: string
  invoice_bank: string
  invoice_account: string
  remark: string | null
  enabled: boolean
}

export interface EmployeeHistoricalRow {
  display_name: string
  legal_name: string | null
  legal_identifier: string | null
  employee_category_id: string | null
  department_id: string | null
  position_id: string | null
  operating_entity_id: string | null
  operating_entity_code: string | null
  operating_entity_name: string | null
  work_phone: string | null
  work_email: string | null
  hired_on: Date | string | null
  remark: string | null
  source_snapshots: unknown
  enabled: boolean
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sourceSnapshot(
  sources: Record<string, unknown>,
  field: 'employeeCategory' | 'department' | 'position',
  expectedId: string | null,
) {
  const snapshot = record(sources[field])
  const id = text(snapshot.id)
  const code = text(snapshot.code)
  const name = text(snapshot.name)
  if (!expectedId || id !== expectedId || !code || !name)
    throw new Error(`${field} snapshot does not match its stable ID`)
  return { id, code, name }
}

export type AuxPeopleHistoricalVersion =
  | { entity: 'operating-entity'; row: OperatingEntityHistoricalRow }
  | { entity: 'employee'; row: EmployeeHistoricalRow }

export function convertAuxPeopleHistoricalData(source: {
  entity: 'operating-entity'
  row: OperatingEntityHistoricalRow
}): OperatingEntityCurrentData
export function convertAuxPeopleHistoricalData(source: {
  entity: 'employee'
  row: EmployeeHistoricalRow
}): EmployeeCurrentData
export function convertAuxPeopleHistoricalData(
  source: AuxPeopleHistoricalVersion,
): AuxPeopleCurrentData {
  if (source.entity === 'operating-entity') {
    const version = source.row
    return auxPeopleDataSchemas['operating-entity'].parse({
      legalName: version.legal_name,
      shortName: version.short_name,
      legalIdentifier: version.legal_identifier ?? '',
      registeredAddress: version.registered_address,
      contactName: version.contact_name,
      contactPhone: version.contact_phone,
      invoiceTitle: version.invoice_title,
      invoiceAddress: version.invoice_address,
      invoicePhone: version.invoice_phone,
      invoiceBank: version.invoice_bank,
      invoiceAccount: version.invoice_account,
      remark: version.remark ?? '',
    })
  }

  const version = source.row
  const sources = record(version.source_snapshots)
  const operatingEntity = {
    id: version.operating_entity_id ?? '',
    code: version.operating_entity_code ?? '',
    name: version.operating_entity_name ?? '',
  }
  if (
    !version.operating_entity_id ||
    !operatingEntity.code ||
    !operatingEntity.name
  )
    throw new Error('operatingEntity snapshot does not match its stable ID')
  const hiredOn =
    version.hired_on instanceof Date
      ? version.hired_on.toISOString().slice(0, 10)
      : (version.hired_on ?? '')
  return auxPeopleDataSchemas.employee.parse({
    identityKind: sources.identityKind,
    legalName: version.legal_name ?? '',
    displayName: version.display_name,
    legalIdentifier: version.legal_identifier ?? '',
    contactName: text(sources.contactName),
    phone: text(sources.phone),
    address: text(sources.address),
    employeeCategory: sourceSnapshot(
      sources,
      'employeeCategory',
      version.employee_category_id,
    ),
    department: sourceSnapshot(sources, 'department', version.department_id),
    position: sourceSnapshot(sources, 'position', version.position_id),
    employmentDate: hiredOn,
    workPhone: version.work_phone ?? '',
    workEmail: version.work_email ?? '',
    operatingEntity,
    remark: version.remark ?? '',
  })
}

export function auxPeopleEntityForHistoricalVouReference(
  field: string,
  referenceEntity: string | null,
): AuxPeopleEntity | null {
  const leaf =
    field
      .split('.')
      .at(-1)
      ?.replace(/\[\d+\]$/, '') ?? ''
  if (leaf === 'counterparty')
    return referenceEntity === 'employee' ? 'employee' : null
  const fieldEntity =
    leaf === 'operatingEntity'
      ? 'operating-entity'
      : [
            'employee',
            'handler',
            'salesperson',
            'purchaser',
            'custodian',
          ].includes(leaf)
        ? 'employee'
        : null
  if (!fieldEntity) return null
  if (referenceEntity && referenceEntity !== fieldEntity)
    throw new Error(
      `historical VOU reference entity ${referenceEntity} does not match ${field}`,
    )
  return fieldEntity
}

export class AuxPeopleMigrationService {
  private readonly db: Kysely<DB>
  private readonly importer: AuxPeopleCurrentImporter
  private readonly bootstrap: TargetBootstrapService

  constructor(
    db: Kysely<DB>,
    importer: AuxPeopleCurrentImporter,
    bootstrap = new TargetBootstrapService(db),
  ) {
    this.db = db
    this.importer = importer
    this.bootstrap = bootstrap
  }

  async migrate(
    targetCatalog: readonly TargetPermissionCatalogEntry[],
  ): Promise<AuxPeopleMigrationReport> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended('aux:people-one-time-migration', 0))`.execute(
        transaction,
      )
      await this.upgradeSchema(transaction)
      await sql`
        LOCK TABLE dcl_subjects, approval_entries, aux_objects,
          aux_reference_facts, vou_reference_snapshots,
          dcl_operating_entity_versions, dcl_employee_versions,
          dcl_customer_versions, dcl_customer_version_subunits,
          dcl_supplier_versions, dcl_supplier_version_operating_entities,
          dcl_other_unit_versions, dcl_other_unit_version_operating_entities,
          dcl_sales_partner_versions,
          dcl_sales_partner_version_operating_entities,
          dcl_warehouse_versions, dcl_vehicle_versions,
          dcl_fund_account_versions,
          dcl_code_counters, object_number_counters,
          acc_opening_snapshots, acc_register_entries,
          acc_journal_entries, acc_journal_lines,
          app_permissions, app_role_permissions, app_roles, app_users,
          app_user_roles
        IN SHARE ROW EXCLUSIVE MODE
      `.execute(transaction)
      const subjectRows = await sql<{
        id: string
        entity: AuxPeopleEntity
      }>`
        SELECT id, entity
        FROM dcl_subjects
        WHERE entity IN ('operating-entity', 'employee')
        ORDER BY entity, id
      `.execute(transaction)
      const sourceRows = await this.readSources(transaction)
      const sourcePlan = planAuxPeopleSources(sourceRows)
      const blockers: AuxPeopleMigrationBlocker[] = sourcePlan.ok
        ? []
        : [...sourcePlan.blockers]
      const subjects = new Map(
        subjectRows.rows.map((source) => [source.id, source.entity]),
      )
      const subjectsWithEntries = new Set(
        sourceRows.map((source) => source.subjectId),
      )
      for (const [subjectId, entity] of subjects)
        if (!subjectsWithEntries.has(subjectId))
          blockers.push({
            kind: 'MISSING_CURRENT_SOURCE',
            entity,
            subjectId,
            approvedEntryId: null,
            candidateEntryId: null,
          })
      const existing = await sql<{ id: string; entity: AuxPeopleEntity }>`
        SELECT id, entity
        FROM aux_objects
        WHERE entity IN ('operating-entity', 'employee')
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
        throw new AuxPeopleMigrationBlockedError(blockers)

      const byEntryId = new Map(sourceRows.map((row) => [row.id, row]))
      const selected = sourcePlan.sources
        .map((selection) => ({
          ...selection,
          entry: byEntryId.get(selection.entryId)!,
        }))
        .sort((left, right) => {
          if (left.entity === right.entity)
            return left.subjectId.localeCompare(right.subjectId)
          return left.entity === 'operating-entity' ? -1 : 1
        })
      const imports: Array<{
        source: (typeof selected)[number]
        current: AuxPeopleCurrentImport
      }> = []
      const invalidSources: AuxPeopleMigrationBlocker[] = []
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
          approvalEntryId: row.approvalEntryId,
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
        throw new AuxPeopleMigrationBlockedError(invalidSources)
      for (const { source, current } of imports) {
        try {
          await this.importer.importCurrent(transaction, current)
        } catch (error) {
          throw new AuxPeopleMigrationBlockedError([
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
        WHERE entity IN ('operating-entity', 'employee')
        ON CONFLICT (domain, entity) DO UPDATE
          SET last_value = GREATEST(
            object_number_counters.last_value,
            EXCLUDED.last_value
          )
      `.execute(transaction)
      const permissionCatalog =
        await this.bootstrap.migratePermissionCatalogInTransaction(
          transaction,
          targetCatalog,
          auxPeoplePermissionMappings,
        )
      return {
        operatingEntities: selected.filter(
          (source) => source.entity === 'operating-entity',
        ).length,
        employees: selected.filter((source) => source.entity === 'employee')
          .length,
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
          'asset-category', 'operating-entity', 'employee'
        ))
    `.execute(transaction)
    for (const table of [
      'dcl_supplier_version_operating_entities',
      'dcl_other_unit_version_operating_entities',
      'dcl_sales_partner_version_operating_entities',
    ])
      await sql`
        ALTER TABLE ${sql.table(table)}
          ALTER COLUMN operating_entity_approval_entry_id DROP NOT NULL
      `.execute(transaction)
    await sql`
      ALTER TABLE vou_reference_snapshots
        ADD COLUMN IF NOT EXISTS aux_snapshot jsonb
    `.execute(transaction)
    await sql`
      ALTER TABLE vou_reference_snapshots
        DROP CONSTRAINT IF EXISTS vou_reference_snapshots_aux_snapshot_check
    `.execute(transaction)
    await sql`
      ALTER TABLE vou_reference_snapshots
        ADD CONSTRAINT vou_reference_snapshots_aux_snapshot_check
        CHECK (aux_snapshot IS NULL OR jsonb_typeof(aux_snapshot) = 'object')
    `.execute(transaction)
  }

  private async readHistoricalReferenceFacts(
    transaction: Transaction<DB>,
  ): Promise<HistoricalReferenceFact[]> {
    const result = await sql<{
      entity: AuxPeopleEntity
      object_id: string
      approval_entry_id: string
      source: string
    }>`
      SELECT 'operating-entity' AS entity,
        default_operating_entity_id AS object_id, approval_entry_id,
        concat('dcl:customer:', approval_entry_id, ':defaultOperatingEntity') AS source
      FROM dcl_customer_versions
      WHERE default_operating_entity_id IS NOT NULL
      UNION ALL
      SELECT 'operating-entity', default_operating_entity_id, approval_entry_id,
        concat('dcl:supplier:', approval_entry_id, ':defaultOperatingEntity')
      FROM dcl_supplier_versions
      WHERE default_operating_entity_id IS NOT NULL
      UNION ALL
      SELECT 'employee', default_purchaser_employee_id, approval_entry_id,
        concat('dcl:supplier:', approval_entry_id, ':defaultPurchaser')
      FROM dcl_supplier_versions
      WHERE default_purchaser_employee_id IS NOT NULL
      UNION ALL
      SELECT 'operating-entity', operating_entity_id, approval_entry_id,
        concat('dcl:supplier:', approval_entry_id, ':operatingEntities.', operating_entity_id)
      FROM dcl_supplier_version_operating_entities
      UNION ALL
      SELECT 'operating-entity', default_operating_entity_id, approval_entry_id,
        concat('dcl:other-unit:', approval_entry_id, ':defaultOperatingEntity')
      FROM dcl_other_unit_versions
      WHERE default_operating_entity_id IS NOT NULL
      UNION ALL
      SELECT 'operating-entity', operating_entity_id, approval_entry_id,
        concat('dcl:other-unit:', approval_entry_id, ':operatingEntities.', operating_entity_id)
      FROM dcl_other_unit_version_operating_entities
      UNION ALL
      SELECT 'operating-entity', default_operating_entity_id, approval_entry_id,
        concat('dcl:sales-partner:', approval_entry_id, ':defaultOperatingEntity')
      FROM dcl_sales_partner_versions
      WHERE default_operating_entity_id IS NOT NULL
      UNION ALL
      SELECT 'operating-entity', operating_entity_id, approval_entry_id,
        concat('dcl:sales-partner:', approval_entry_id, ':operatingEntities.', operating_entity_id)
      FROM dcl_sales_partner_version_operating_entities
      UNION ALL
      SELECT 'operating-entity', operating_entity_id, approval_entry_id,
        concat('dcl:employee:', approval_entry_id, ':operatingEntity')
      FROM dcl_employee_versions
      WHERE operating_entity_id IS NOT NULL
      UNION ALL
      SELECT 'employee', manager_employee_id, approval_entry_id,
        concat('dcl:warehouse:', approval_entry_id, ':manager')
      FROM dcl_warehouse_versions
      WHERE manager_employee_id IS NOT NULL
      UNION ALL
      SELECT 'operating-entity', carrier_operating_entity_id, approval_entry_id,
        concat('dcl:vehicle:', approval_entry_id, ':carrier')
      FROM dcl_vehicle_versions
      WHERE carrier_affiliation_type = 'INTERNAL'
        AND carrier_operating_entity_id IS NOT NULL
      UNION ALL
      SELECT 'operating-entity', operating_entity_id, approval_entry_id,
        concat('dcl:fund-account:', approval_entry_id, ':operatingEntity')
      FROM dcl_fund_account_versions
      WHERE operating_entity_id IS NOT NULL
      UNION ALL
      SELECT 'employee', primary_sales_attribution_object_id,
        customer_approval_entry_id,
        concat(
          'dcl:customer:', customer_approval_entry_id,
          ':subunits.', subunit_id, '.primarySalesAttribution'
        )
      FROM dcl_customer_version_subunits
      WHERE primary_sales_attribution_type = 'INTERNAL_EMPLOYEE'
        AND primary_sales_attribution_object_id IS NOT NULL
      UNION ALL
      SELECT 'employee', line.value->'dimensions'->>'EMPLOYEE',
        opening.approval_entry_id,
        concat(
          'acc:opening:', opening.approval_entry_id, ':line:',
          line.ordinality, ':dimension:EMPLOYEE'
        )
      FROM acc_opening_snapshots opening
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(opening.payload->'lines') = 'array'
            THEN opening.payload->'lines'
          ELSE '[]'::jsonb
        END
      ) WITH ORDINALITY line(value, ordinality)
      WHERE nullif(line.value->'dimensions'->>'EMPLOYEE', '') IS NOT NULL
      UNION ALL
      SELECT 'employee', line.dimensions->>'EMPLOYEE', journal.id,
        concat(
          'acc:journal:', journal.id, ':line:', line.id,
          ':dimension:EMPLOYEE'
        )
      FROM acc_journal_lines line
      JOIN acc_journal_entries journal ON journal.id = line.journal_entry_id
      WHERE journal.opening_approval_entry_id IS NULL
        AND nullif(line.dimensions->>'EMPLOYEE', '') IS NOT NULL
      UNION ALL
      SELECT (bill->'originatingCounterparty'->>'entity')::varchar,
        bill->'originatingCounterparty'->>'objectId', opening.approval_entry_id,
        concat(
          'acc:opening:', opening.approval_entry_id, ':bill:',
          bill->>'billId', ':originating-counterparty'
        )
      FROM acc_opening_snapshots opening
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(opening.payload->'bills') = 'array'
            THEN opening.payload->'bills'
          ELSE '[]'::jsonb
        END
      ) bill
      WHERE bill->'originatingCounterparty'->>'entity'
        IN ('operating-entity', 'employee')
        AND nullif(bill->'originatingCounterparty'->>'objectId', '') IS NOT NULL
        AND nullif(bill->>'billId', '') IS NOT NULL
      UNION ALL
      SELECT (entry.payload->'originatingCounterparty'->>'entity')::varchar,
        entry.payload->'originatingCounterparty'->>'objectId',
        entry.opening_approval_entry_id,
        concat(
          'acc:opening:', entry.opening_approval_entry_id, ':bill:',
          COALESCE(NULLIF(entry.payload->>'billId', ''), entry.object_id),
          ':originating-counterparty'
        )
      FROM acc_register_entries entry
      WHERE entry.register_kind = 'BILL'
        AND entry.source_kind = 'OPENING'
        AND entry.opening_approval_entry_id IS NOT NULL
        AND entry.payload->'originatingCounterparty'->>'entity'
          IN ('operating-entity', 'employee')
        AND nullif(
          entry.payload->'originatingCounterparty'->>'objectId', ''
        ) IS NOT NULL
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
    blockers: AuxPeopleMigrationBlocker[]
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
    const blockers: AuxPeopleMigrationBlocker[] = []
    const historical = new Map<
      string,
      { objectId: string; code: string; data: AuxPeopleCurrentData }
    >()
    for (const row of rows) {
      let entity: AuxPeopleEntity | null
      try {
        entity = auxPeopleEntityForHistoricalVouReference(
          row.field,
          row.referenceEntity,
        )
      } catch (error) {
        const expected = auxPeopleEntityForHistoricalVouReference(
          row.field,
          null,
        )
        blockers.push(
          this.historicalReferenceBlocker(
            expected ?? 'employee',
            row.objectId,
            row.approvalReferenceId,
            row,
            error,
          ),
        )
        continue
      }
      if (!entity) continue
      if (!row.approvalReferenceId) {
        blockers.push(
          this.historicalReferenceBlocker(
            entity,
            row.objectId,
            null,
            row,
            new Error('historical VOU people reference has no Approval Entry'),
          ),
        )
        continue
      }
      const key = `${entity}\0${row.approvalReferenceId}`
      try {
        let snapshot = historical.get(key)
        if (!snapshot) {
          snapshot = await this.readHistoricalAuxPeopleData(
            transaction,
            entity,
            row.approvalReferenceId,
          )
          historical.set(key, snapshot)
        }
        if (
          snapshot.objectId !== row.objectId ||
          (row.referenceCode !== null && snapshot.code !== row.referenceCode)
        )
          throw new Error(
            'historical VOU people reference does not match its stable identity',
          )
        backfills.push({ row, entity, data: snapshot.data })
      } catch (error) {
        blockers.push(
          this.historicalReferenceBlocker(
            entity,
            row.objectId,
            row.approvalReferenceId,
            row,
            error,
          ),
        )
      }
    }
    return { backfills, blockers }
  }

  private historicalReferenceBlocker(
    entity: AuxPeopleEntity,
    objectId: string,
    approvalReferenceId: string | null,
    row: Pick<
      HistoricalVouReferenceRow,
      'approvalEntryId' | 'field' | 'lineNo' | 'itemNo'
    >,
    error: unknown,
  ): AuxPeopleMigrationBlocker {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      kind: 'INVALID_HISTORICAL_REFERENCE',
      entity,
      subjectId: objectId,
      approvedEntryId: approvalReferenceId,
      candidateEntryId: null,
      detail: `VOU ${row.approvalEntryId} ${row.field}:${row.lineNo}:${row.itemNo}: ${reason}`,
    }
  }

  private async readHistoricalAuxPeopleData(
    transaction: Transaction<DB>,
    entity: AuxPeopleEntity,
    approvalEntryId: string,
  ): Promise<{ objectId: string; code: string; data: AuxPeopleCurrentData }> {
    if (entity === 'operating-entity') {
      const result = await sql<
        OperatingEntityHistoricalRow & {
          object_id: string
          code: string | null
        }
      >`
        SELECT entry.subject_id AS object_id, subject.code,
          version.legal_name, version.short_name, version.legal_identifier,
          version.registered_address, version.contact_name,
          version.contact_phone, version.invoice_title,
          version.invoice_address, version.invoice_phone,
          version.invoice_bank, version.invoice_account, version.remark,
          version.enabled
        FROM approval_entries entry
        JOIN dcl_subjects subject
          ON subject.id = entry.subject_id
         AND subject.entity = 'operating-entity'
        JOIN dcl_operating_entity_versions version
          ON version.approval_entry_id = entry.id
        WHERE entry.id = ${approvalEntryId}
          AND entry.domain = 'dcl'
          AND entry.entity = 'operating-entity'
      `.execute(transaction)
      const row = result.rows[0]
      if (!row || !row.code)
        throw new Error(
          'exact operating-entity typed Approval snapshot is missing',
        )
      return {
        objectId: row.object_id,
        code: row.code,
        data: convertAuxPeopleHistoricalData({ entity, row }),
      }
    }

    const result = await sql<
      EmployeeHistoricalRow & { object_id: string; code: string | null }
    >`
      SELECT entry.subject_id AS object_id, subject.code,
        version.display_name, version.legal_name, version.legal_identifier,
        version.employee_category_id, version.department_id,
        version.position_id, version.operating_entity_id,
        version.operating_entity_code, version.operating_entity_name,
        version.work_phone, version.work_email, version.hired_on,
        version.remark, version.source_snapshots, version.enabled
      FROM approval_entries entry
      JOIN dcl_subjects subject
        ON subject.id = entry.subject_id
       AND subject.entity = 'employee'
      JOIN dcl_employee_versions version
        ON version.approval_entry_id = entry.id
      WHERE entry.id = ${approvalEntryId}
        AND entry.domain = 'dcl'
        AND entry.entity = 'employee'
    `.execute(transaction)
    const row = result.rows[0]
    if (!row || !row.code)
      throw new Error('exact employee typed Approval snapshot is missing')
    return {
      objectId: row.object_id,
      code: row.code,
      data: convertAuxPeopleHistoricalData({ entity, row }),
    }
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

  private async readSources(
    transaction: Transaction<DB>,
  ): Promise<StoredSourceEntry[]> {
    const rows = await sql<{
      subject_id: string
      entity: AuxPeopleEntity
      code: string | null
      subject_created_at: Date
      subject_created_by: string
      entry_id: string | null
      version_no: number | null
      status: AuxPeopleSourceStatus | null
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
      WHERE subject.entity IN ('operating-entity', 'employee')
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
  ): Promise<AuxPeopleCurrentImport> {
    if (!source.code)
      throw new Error('source stable identity has no business code')
    if (source.entity === 'operating-entity') {
      const row = await sql<OperatingEntityHistoricalRow>`
        SELECT legal_name, short_name, legal_identifier, registered_address,
          contact_name, contact_phone, invoice_title, invoice_address,
          invoice_phone, invoice_bank, invoice_account, remark, enabled
        FROM dcl_operating_entity_versions
        WHERE approval_entry_id = ${source.id}
      `.execute(transaction)
      const version = row.rows[0]
      if (!version)
        throw new Error('operating-entity typed snapshot is missing')
      return {
        entity: source.entity,
        id: source.subjectId,
        code: source.code,
        enabled: version.enabled,
        createdAt: source.subjectCreatedAt,
        createdBy: source.subjectCreatedBy,
        updatedAt: source.updatedAt,
        updatedBy: source.updatedBy,
        data: convertAuxPeopleHistoricalData({
          entity: source.entity,
          row: version,
        }),
      }
    }

    const row = await sql<EmployeeHistoricalRow>`
      SELECT display_name, legal_name, legal_identifier, employee_category_id,
        department_id, position_id, operating_entity_id, operating_entity_code,
        operating_entity_name, work_phone, work_email, hired_on, remark,
        source_snapshots, enabled
      FROM dcl_employee_versions
      WHERE approval_entry_id = ${source.id}
    `.execute(transaction)
    const version = row.rows[0]
    if (!version) throw new Error('employee typed snapshot is missing')
    return {
      entity: source.entity,
      id: source.subjectId,
      code: source.code,
      enabled: version.enabled,
      createdAt: source.subjectCreatedAt,
      createdBy: source.subjectCreatedBy,
      updatedAt: source.updatedAt,
      updatedBy: source.updatedBy,
      data: convertAuxPeopleHistoricalData({
        entity: source.entity,
        row: version,
      }),
    }
  }
}

export function planAuxPeopleSources(
  entries: readonly AuxPeopleSourceEntry[],
): AuxPeopleSourcePlan {
  const grouped = new Map<
    string,
    { entity: AuxPeopleEntity; entries: AuxPeopleSourceEntry[] }
  >()
  for (const entry of entries) {
    const existing = grouped.get(entry.subjectId)
    if (existing) existing.entries.push(entry)
    else
      grouped.set(entry.subjectId, {
        entity: entry.entity,
        entries: [entry],
      })
  }

  const sources: AuxPeopleSelectedSource[] = []
  const blockers: AuxPeopleMigrationBlocker[] = []
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
