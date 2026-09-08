import {
  availableApprovalActions,
  type ApprovalActor,
  type ApprovalEntry,
  type ApprovalStatus,
} from '@zerp/model'
import { sql, type Kysely } from 'kysely'

import type { DB } from '../db/generated.ts'
import { vouTypes } from '@zerp/model'

const wflApprovalEntities = ['process-definition'] as const
const bobApprovalEntities = [
  'customer',
  'product',
  'supplier',
  'other-unit',
  'sales-partner',
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
  domain: 'bob' | 'wfl' | 'vou'
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
  domain: 'bob' | 'wfl' | 'vou'
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
  can_operate?: boolean
}

function visibleEntities(
  actor: ApprovalActor,
  domain: 'bob' | 'wfl' | 'vou',
  candidates: readonly string[],
) {
  const queryable = new Set(
    actor.permissions.flatMap((permission) => {
      const action = domain !== 'vou' ? 'submission-query' : 'query'
      const match = permission.match(/^\/(bob|wfl|vou)\/([^/]+)\/([^/]+)$/)
      return match?.[1] === domain && match[3] === action ? [match[2]!] : []
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
    versionNo: row.domain === 'vou' ? null : 1,
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
    const wflEntities = visibleEntities(actor, 'wfl', wflApprovalEntities)
    const bobEntities = visibleEntities(actor, 'bob', bobApprovalEntities)
    const vouVisibleEntities = visibleEntities(actor, 'vou', vouTypes)
    const rows = await Promise.all([
      this.queryWfl(wflEntities),
      this.queryBob(bobEntities),
      this.queryVou(vouVisibleEntities),
      this.queryOpening(vouVisibleEntities, actor),
    ])
    const keyword = input.filters?.keyword?.trim().toLocaleLowerCase()
    const items = rows
      .flat()
      .flatMap((row): WorkbenchItem[] => {
        const lifecycleActions = (
          row.can_operate === false
            ? []
            : availableApprovalActions(entryFromRow(row), actor)
        ).filter(
          (action): action is 'reject' | 'approve' | 'unreject' =>
            action !== 'unapprove',
        )
        if (input.filters?.kind === 'ARCHIVE' && row.domain === 'vou') return []
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
        const getAction = row.domain !== 'vou' ? 'submission-get' : 'get'
        if (
          actor.permissions.includes(
            `/${row.domain}/${row.entity}/${getAction}`,
          )
        ) {
          resourceActions.push('view')
        }
        if (
          row.can_operate !== false &&
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

  private async queryWfl(entities: readonly string[]): Promise<WorkbenchRow[]> {
    if (entities.length === 0) return []
    const result = await sql<WorkbenchRow>`
      SELECT
        e.id, e.domain, e.entity, e.subject_id, e.status, e.revision,
        e.submitted_by, e.submitted_at, e.rejected_by, e.rejected_at,
        e.rejection_reason, e.updated_at,
        COALESCE(s.code, e.subject_id) AS code,
        COALESCE(
          wfl_definition.compiled_graph->>'name', s.code, e.subject_id
        ) AS name
      FROM approval_entries e
      INNER JOIN wfl_definitions s ON s.id = e.subject_id
      LEFT JOIN wfl_definition_versions wfl_definition ON wfl_definition.approval_entry_id = e.id
      WHERE e.domain = 'wfl'
        AND e.status IN ('PENDING', 'REJECTED')
        AND e.entity IN (${sql.join(entities)})
    `.execute(this.db)
    return result.rows
  }

  private async queryOpening(
    entities: readonly string[],
    actor: ApprovalActor,
  ): Promise<WorkbenchRow[]> {
    if (!entities.includes('opening')) return []
    const result = await sql<WorkbenchRow>`
      SELECT e.id,e.domain,e.entity,e.subject_id,e.status,e.revision,e.submitted_by,e.submitted_at,
        e.rejected_by,e.rejected_at,e.rejection_reason,e.updated_at,
        'OPN-' || book.code AS code,book.name,access.can_operate
      FROM approval_entries e
      JOIN acc_books book ON book.id=e.subject_id
      JOIN acc_opening_snapshots snapshot ON snapshot.approval_entry_id=e.id
      JOIN acc_book_access access ON access.book_id=book.id AND access.user_id=${actor.id} AND access.can_query
      WHERE e.domain='vou' AND e.entity='opening' AND e.status IN ('PENDING','REJECTED')
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

  private async queryBob(entities: readonly string[]): Promise<WorkbenchRow[]> {
    if (entities.length === 0) return []
    const result = await sql<WorkbenchRow>`
      SELECT
        e.id, e.domain, e.entity, e.subject_id, e.status, e.revision,
        e.submitted_by, e.submitted_at, e.rejected_by, e.rejected_at,
        e.rejection_reason, e.updated_at,
        s.code,
        COALESCE(
          supplier.display_name, other_unit.display_name, sales_partner.display_name,
          product.name, customer.display_name, s.code, e.subject_id
        ) AS name
      FROM approval_entries e
      INNER JOIN bob_subjects s ON s.id = e.subject_id
      LEFT JOIN bob_supplier_versions supplier ON supplier.approval_entry_id = e.id
      LEFT JOIN bob_other_unit_versions other_unit ON other_unit.approval_entry_id = e.id
      LEFT JOIN bob_sales_partner_versions sales_partner ON sales_partner.approval_entry_id = e.id
      LEFT JOIN bob_customer_versions customer ON customer.approval_entry_id=e.id
      LEFT JOIN bob_product_versions product ON product.approval_entry_id=e.id
      WHERE e.domain = 'bob'
        AND e.status IN ('PENDING', 'REJECTED')
        AND e.entity IN (${sql.join(entities)})
    `.execute(this.db)
    return result.rows
  }
}
