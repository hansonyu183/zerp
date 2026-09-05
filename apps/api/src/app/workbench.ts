import {
  availableApprovalActions,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
} from '@zerp/model'
import { sql, type Kysely } from 'kysely'

import type { DB } from '../db/generated.ts'
import { archiveEntities } from '../dcl/archive-contract.ts'
import { vouEntities } from '@zerp/model'

const dclApprovalEntities = [
  ...archiveEntities,
  'warehouse',
  'wfl-process-definition',
] as const

export type WorkbenchQueryInput = {
  page: number
  pageSize: 20
  filters?: {
    kind?: 'ARCHIVE' | 'DOCUMENT'
    entity?: string
    status?: 'PENDING' | 'REJECTED'
    keyword?: string
  }
}

export type WorkbenchItem = {
  domain: 'dcl' | 'vou'
  entity: string
  subjectOrDocumentId: string
  submissionId: string
  code: string
  name: string
  status: 'PENDING' | 'REJECTED'
  revision: string
  availableActions: Array<
    'view' | 'edit' | 'delete' | 'reject' | 'approve' | 'unreject'
  >
  updatedAt: string
}

type WorkbenchRow = {
  id: string
  domain: 'dcl' | 'vou'
  entity: string
  subject_id: string
  status: ApprovalStatus
  revision: string
  submitted_by: string
  submitted_at: Date
  rejected_by: string | null
  rejected_at: Date | null
  rejection_reason: string | null
  code: string
  name: string
  updated_at: Date
}

function visibleEntities(
  actor: ApprovalActor,
  domain: 'dcl' | 'vou',
  candidates: readonly string[],
) {
  const queryable = new Set(
    actor.permissions.flatMap((permission) => {
      const match = permission.match(/^\/(dcl|vou)\/([^/]+)\/query$/)
      return match?.[1] === domain ? [match[2]!] : []
    }),
  )
  return candidates.filter((entity) => queryable.has(entity))
}

function entryFromRow(row: WorkbenchRow): ApprovalEntry {
  return {
    id: row.id,
    domain: row.domain,
    entity: row.entity,
    subjectId: row.subject_id,
    versionNo: row.domain === 'dcl' ? 1 : null,
    status: row.status,
    revision: String(row.revision),
    metadata: {
      submitted: {
        actorId: row.submitted_by,
        occurredAt: row.submitted_at.toISOString(),
      },
      ...(row.status === 'REJECTED' &&
      row.rejected_by &&
      row.rejected_at &&
      row.rejection_reason
        ? {
            rejected: {
              actorId: row.rejected_by,
              occurredAt: row.rejected_at.toISOString(),
              reason: row.rejection_reason,
            },
          }
        : {}),
    },
  }
}

/** Session-scoped pending approval projections. It does not authorize writes. */
export class WorkbenchService {
  private readonly db: Kysely<DB>

  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async query(input: WorkbenchQueryInput, actor: ApprovalActor) {
    const dclEntities = visibleEntities(actor, 'dcl', dclApprovalEntities)
    const vouVisibleEntities = visibleEntities(actor, 'vou', vouEntities)
    const rows = await Promise.all([
      this.queryDcl(dclEntities),
      this.queryVou(vouVisibleEntities),
    ])
    const keyword = input.filters?.keyword?.trim().toLocaleLowerCase()
    const items = rows
      .flat()
      .flatMap((row): WorkbenchItem[] => {
        const lifecycleActions = availableApprovalActions(
          entryFromRow(row),
          actor,
        ).filter(
          (action): action is 'reject' | 'approve' | 'unreject' =>
            action !== 'unapprove',
        )
        if (input.filters?.kind === 'ARCHIVE' && row.domain !== 'dcl') return []
        if (input.filters?.kind === 'DOCUMENT' && row.domain !== 'vou')
          return []
        if (input.filters?.entity && row.entity !== input.filters.entity)
          return []
        if (input.filters?.status && row.status !== input.filters.status)
          return []
        if (
          keyword &&
          !`${row.code}\n${row.name}`.toLocaleLowerCase().includes(keyword)
        )
          return []
        const resourceActions: Array<'view' | 'delete'> = []
        if (actor.permissions.includes(`/${row.domain}/${row.entity}/get`)) {
          resourceActions.push('view')
        }
        if (
          row.submitted_by === actor.id &&
          actor.permissions.includes(`/${row.domain}/${row.entity}/delete`)
        )
          resourceActions.push('delete')
        const availableActions = [...resourceActions, ...lifecycleActions]
        if (availableActions.length === 0) return []
        return [
          {
            domain: row.domain,
            entity: row.entity,
            subjectOrDocumentId: row.subject_id,
            submissionId: row.id,
            code: row.code,
            name: row.name,
            status: row.status as 'PENDING' | 'REJECTED',
            revision: String(row.revision),
            availableActions,
            updatedAt: row.updated_at.toISOString(),
          },
        ]
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    const offset = (input.page - 1) * input.pageSize
    return {
      items: items.slice(offset, offset + input.pageSize),
      total: items.length,
      page: input.page,
      pageSize: input.pageSize,
    }
  }

  private async queryDcl(entities: readonly string[]): Promise<WorkbenchRow[]> {
    if (entities.length === 0) return []
    const result = await sql<WorkbenchRow>`
      SELECT
        e.id, e.domain, e.entity, e.subject_id, e.status, e.revision,
        e.submitted_by, e.submitted_at, e.rejected_by, e.rejected_at,
        e.rejection_reason, e.updated_at,
        COALESCE(s.code, mapping.vou_entity_snapshot->>'code', e.subject_id) AS code,
        COALESCE(
          customer.display_name, supplier.display_name, other_unit.display_name,
          employee.display_name, sales_partner.display_name, product.name,
          warehouse.name, vehicle.name, fund_account.name, operating_entity.legal_name,
          mapping.vou_entity_snapshot->>'name', rpt_definition.name,
          wfl_definition.compiled_graph->>'name', s.code, e.subject_id
        ) AS name
      FROM approval_entries e
      INNER JOIN dcl_subjects s ON s.id = e.subject_id
      LEFT JOIN dcl_customer_versions customer ON customer.approval_entry_id = e.id
      LEFT JOIN dcl_supplier_versions supplier ON supplier.approval_entry_id = e.id
      LEFT JOIN dcl_other_unit_versions other_unit ON other_unit.approval_entry_id = e.id
      LEFT JOIN dcl_employee_versions employee ON employee.approval_entry_id = e.id
      LEFT JOIN dcl_sales_partner_versions sales_partner ON sales_partner.approval_entry_id = e.id
      LEFT JOIN dcl_product_versions product ON product.approval_entry_id = e.id
      LEFT JOIN dcl_warehouse_versions warehouse ON warehouse.approval_entry_id = e.id
      LEFT JOIN dcl_vehicle_versions vehicle ON vehicle.approval_entry_id = e.id
      LEFT JOIN dcl_fund_account_versions fund_account ON fund_account.approval_entry_id = e.id
      LEFT JOIN dcl_operating_entity_versions operating_entity ON operating_entity.approval_entry_id = e.id
      LEFT JOIN dcl_acc_mapping_versions mapping ON mapping.approval_entry_id = e.id
      LEFT JOIN dcl_rpt_definition_versions rpt_definition ON rpt_definition.approval_entry_id = e.id
      LEFT JOIN wfl_definition_versions wfl_definition ON wfl_definition.approval_entry_id = e.id
      WHERE e.domain = 'dcl'
        AND e.status IN ('PENDING', 'REJECTED')
        AND e.entity IN (${sql.join(entities)})
    `.execute(this.db)
    return result.rows
  }

  private async queryVou(entities: readonly string[]): Promise<WorkbenchRow[]> {
    if (entities.length === 0) return []
    const result = await sql<WorkbenchRow>`
      SELECT
        e.id, e.domain, e.entity, e.subject_id, e.status, e.revision,
        e.submitted_by, e.submitted_at, e.rejected_by, e.rejected_at,
        e.rejection_reason, e.updated_at,
        d.document_no AS code,
        COALESCE((
          SELECT reference_name
          FROM vou_reference_snapshots reference
          WHERE reference.approval_entry_id = e.id
            AND reference.reference_name IS NOT NULL
          ORDER BY
            CASE reference.reference_entity
              WHEN 'customer' THEN 0
              WHEN 'supplier' THEN 1
              WHEN 'other-unit' THEN 2
              WHEN 'sales-partner' THEN 3
              ELSE 4
            END,
            reference.field,
            reference.line_no,
            reference.item_no
          LIMIT 1
        ), d.document_no) AS name
      FROM approval_entries e
      INNER JOIN vou_documents d ON d.id = e.subject_id AND d.entity = e.entity
      WHERE e.domain = 'vou'
        AND e.status IN ('PENDING', 'REJECTED')
        AND e.entity IN (${sql.join(entities)})
    `.execute(this.db)
    return result.rows
  }
}
