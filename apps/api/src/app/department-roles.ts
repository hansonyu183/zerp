import { workflowCreatePermission, type VouEntity } from '@zerp/model'
import catalog from '../generated/target-permission-catalog.json' with { type: 'json' }
import { departmentReports } from '../rpt/department-reports.ts'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import { ulid } from 'ulid'
import type { DB } from '../db/generated.ts'

const read = ['query', 'get', 'audit-history', 'attachment-read']
const submit = [
  ...read,
  'submit-new',
  'submit-change',
  'delete',
  'attachment-stage',
  'attachment-cleanup',
]
const approve = [...read, 'approve', 'reject', 'unreject', 'unapprove']
const archives = [
  'customer',
  'supplier',
  'product',
  'other-unit',
  'sales-partner',
]
const sales = [
  'sale-pricing',
  'sale-order',
  'sale-delivery',
  'sale-signoff',
  'sale-return',
]
const salesRead = [
  ...sales,
  'sale-outbound',
  'sale-invoice',
  'sales-receipt',
  'sales-refund',
]
const purchase = ['purchase-inquiry', 'purchase-order', 'purchase-return']
const warehouse = [
  'sale-outbound',
  'purchase-inbound',
  'order-production',
  'self-production',
  'inventory-count',
]
const finance = [
  'sale-invoice',
  'purchase-invoice',
  'sales-receipt',
  'sales-refund',
  'purchase-payment',
  'purchase-refund',
  'other-receipt',
  'other-payment',
  'employee-loan',
  'employee-repayment',
  'employee-loan-writeoff',
  'expense-reimbursement',
  'expense-payment',
  'other-income',
  'asset-acquisition',
  'asset-sale',
  'asset-liquidation',
  'bill-receipt',
  'bill-payment',
  'bill-issue',
  'bill-discount',
  'bill-maturity',
  'intermediary-calculation',
  'service-contract',
  'service-acceptance',
  'opening',
]
const paths = (
  domain: string,
  entities: readonly string[],
  actions: readonly string[],
) =>
  entities.flatMap((entity) =>
    actions.map((action) => `/${domain}/${entity}/${action}`),
  )
const bobRead = (entities: string[]) =>
  paths('bob', entities, [
    'query',
    'get',
    'versions',
    'audit-history',
    ...(entities.includes('customer') ? ['attachment-read'] : []),
  ])
const dclApprove = (entities: string[]) =>
  paths('dcl', entities, [
    'submission-query',
    'submission-get',
    ...(entities.includes('customer') ? ['attachment-read'] : []),
    'approve',
    'reject',
    'unreject',
    'unapprove',
  ])
const aux = (entities: string[]) =>
  paths('aux', entities, [
    'query',
    'get',
    'create',
    'save',
    'delete',
    'enable',
    'disable',
  ])
const workflow = (
  entities: readonly string[],
  mode: 'submit' | 'approve' | 'both',
) => [
  ...paths(
    'wfl',
    ['process-instance'],
    [
      'query',
      'get',
      'open-document',
      'audit-history',
      ...(mode !== 'approve' ? ['cancel-child'] : []),
      ...(mode !== 'submit'
        ? ['retry-child', 'approve-child', 'reject-child']
        : []),
    ],
  ),
  ...(mode !== 'approve'
    ? entities.map((entity) => workflowCreatePermission(entity as VouEntity))
    : []),
]
const base = bobRead(['product'])
const salesBase = [
  ...base,
  ...bobRead(['customer']),
  ...paths('vou', salesRead, read),
]
const purchaseBase = [
  ...base,
  ...bobRead(['supplier']),
  ...paths(
    'vou',
    [
      ...purchase,
      'purchase-inbound',
      'purchase-invoice',
      'purchase-payment',
      'purchase-refund',
    ],
    read,
  ),
]
const accountRead = paths(
  'acc',
  ['book', 'subject', 'mapping'],
  ['query', 'get'],
)

export const departmentRoles = [
  {
    key: 'customer-service',
    name: '客服',
    scope: 'ALL',
    paths: [
      ...salesBase,
      ...paths('vou', sales, submit),
      ...workflow(sales, 'submit'),
    ],
  },
  {
    key: 'customer-service-supervisor',
    name: '客服主管',
    scope: 'ALL',
    paths: [
      ...salesBase,
      ...paths('vou', sales, [...submit, ...approve]),
      ...paths(
        'vou',
        ['sales-receipt', 'sales-refund'],
        [...submit, ...approve],
      ),
      ...dclApprove(['customer']),
      ...workflow(sales, 'both'),
    ],
  },
  {
    key: 'salesperson',
    name: '业务员',
    scope: 'OWN',
    paths: [...salesBase, ...paths('vou', ['sale-order'], submit)],
  },
  {
    key: 'sales-manager',
    name: '业务经理',
    scope: 'ALL',
    paths: [
      ...salesBase,
      ...paths('vou', ['sale-order'], approve),
      ...dclApprove(['customer']),
    ],
  },
  {
    key: 'purchaser',
    name: '采购员',
    scope: 'NONE',
    paths: [...purchaseBase, ...paths('vou', purchase, submit)],
  },
  {
    key: 'purchase-supervisor',
    name: '采购主管',
    scope: 'NONE',
    paths: [
      ...purchaseBase,
      ...paths('vou', purchase, approve),
      ...dclApprove(['supplier', 'product']),
      ...aux(['product-category', 'product-type', 'measurement-unit']),
    ],
  },
  {
    key: 'warehouse-administrator',
    name: '仓库管理员',
    scope: 'ALL',
    paths: [
      ...salesBase,
      ...purchaseBase,
      ...paths('vou', warehouse, submit),
      ...workflow(warehouse, 'submit'),
    ],
  },
  {
    key: 'warehouse-supervisor',
    name: '仓库主管',
    scope: 'ALL',
    paths: [
      ...salesBase,
      ...purchaseBase,
      ...paths('vou', warehouse, approve),
      ...aux(['warehouse', 'vehicle']),
      ...workflow(warehouse, 'approve'),
    ],
  },
  {
    key: 'accountant',
    name: '会计',
    scope: 'ALL',
    paths: [
      ...bobRead(archives),
      ...paths('vou', [...salesRead, ...purchase, ...warehouse], read),
      ...paths('vou', finance, submit),
      ...accountRead,
      '/vou/sale-invoice/unbilled',
      '/vou/purchase-invoice/unbilled',
    ],
  },
  {
    key: 'accounting-supervisor',
    name: '会计主管',
    scope: 'ALL',
    paths: [
      ...bobRead(archives),
      ...paths('vou', [...salesRead, ...purchase, ...warehouse], read),
      ...paths('vou', finance, approve),
      ...accountRead,
      ...paths('acc', ['subject'], ['create', 'save', 'delete']),
      '/acc/mapping/save',
      ...paths('acc', ['period'], ['query', 'lock', 'unlock']),
      ...dclApprove(['other-unit', 'sales-partner']),
      ...aux([
        'fund-account',
        'payment-method',
        'income-expense-type',
        'asset-category',
        'tax-information',
      ]),
      '/aux/settlement-method/query',
      '/aux/settlement-method/get',
      '/aux/settlement-method/save',
    ],
  },
  {
    key: 'archive-administrator',
    name: '档案管理员',
    scope: 'ALL',
    paths: [
      ...bobRead(archives),
      ...paths('dcl', archives, [
        'submission-query',
        'submission-get',
        'submit-new',
        'submit-change',
        'delete',
      ]),
      ...paths(
        'dcl',
        ['customer'],
        ['attachment-stage', 'attachment-cleanup', 'attachment-read'],
      ),
    ],
  },
  {
    key: 'hr-supervisor',
    name: '人事主管',
    scope: 'NONE',
    paths: aux(['employee', 'employee-category', 'department', 'position']),
  },
] as const

/** One-time APP initialization. Existing grants are never reconciled on restart. */
export class DepartmentRoleService {
  private readonly db: Kysely<DB>
  constructor(db: Kysely<DB>) {
    this.db = db
  }

  async initialize(): Promise<'created' | 'unchanged'> {
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(74155001)`.execute(tx)
      const key = 'department-roles-v1'
      if (
        await tx
          .selectFrom('app_seed_runs')
          .select('key')
          .where('key', '=', key)
          .executeTakeFirst()
      )
        return 'unchanged'
      const admin = await tx
        .selectFrom('app_roles as r')
        .innerJoin('app_user_roles as ur', 'ur.role_id', 'r.id')
        .innerJoin('app_users as u', 'u.id', 'ur.user_id')
        .select('u.id')
        .where('r.code', '=', 'superadmin')
        .where('r.status', '=', 'ENABLED')
        .where('u.status', '=', 'ENABLED')
        .executeTakeFirst()
      if (!admin)
        throw new Error('department seed requires an active administrator')
      const existing = await tx
        .selectFrom('app_roles')
        .select(['name', 'code'])
        .execute()
      if (
        departmentRoles.some((role) =>
          existing.some(
            (row) =>
              row.name.trim().toLowerCase() === role.name.toLowerCase() ||
              row.code === `department-${role.key}`,
          ),
        )
      )
        throw new Error('department role baseline conflicts')
      const permissions = await tx
        .selectFrom('app_permissions')
        .select(['id', 'path'])
        .where('status', '=', 'ENABLED')
        .execute()
      if (!permissions.some((p) => p.path === '/app/role/create'))
        throw new Error('department seed requires the permission catalog')
      const reports = await tx
        .selectFrom('rpt_definitions')
        .select(['id', 'code'])
        .where(
          'id',
          'in',
          departmentReports.map((report) => report.subjectId),
        )
        .execute()
      if (reports.length !== departmentReports.length)
        throw new Error('department reports must be initialized first')
      for (const role of departmentRoles) {
        const id = ulid()
        await tx
          .insertInto('app_roles')
          .values({
            id,
            code: `department-${role.key}`,
            name: role.name,
            description: '部门初始角色',
            customer_scope: role.scope,
            status: 'ENABLED',
            created_by: admin.id,
            updated_by: admin.id,
          })
          .execute()
        const registered = new Set(catalog.map((permission) => permission.path))
        const requested = new Set(
          role.paths.filter((path) => registered.has(path)),
        )
        const reportKeys =
          role.key === 'accountant' || role.key === 'accounting-supervisor'
            ? ['customer-balance', 'customer-sales', 'ledger', 'inventory']
            : role.key === 'warehouse-administrator' ||
                role.key === 'warehouse-supervisor'
              ? ['inventory']
              : [
                    'customer-service',
                    'customer-service-supervisor',
                    'salesperson',
                    'sales-manager',
                  ].includes(role.key)
                ? ['customer-balance', 'customer-sales']
                : []
        for (const report of departmentReports.filter((item) =>
          reportKeys.includes(item.key),
        )) {
          const code = reports.find((row) => row.id === report.subjectId)!.code
          requested.add(`/rpt/${code}/query`)
          requested.add(`/rpt/${code}/export`)
        }
        if (
          [...requested].some(
            (path) =>
              !permissions.some((permission) => permission.path === path),
          )
        )
          throw new Error(
            'department seed requires all declared permissions to be enabled',
          )
        const grants = permissions
          .filter((p) => requested.has(p.path))
          .map((p) => ({
            role_id: id,
            permission_id: p.id,
            created_by: admin.id,
          }))
        if (!grants.length)
          throw new Error('department role has no registered permissions')
        await tx.insertInto('app_role_permissions').values(grants).execute()
      }
      await tx.insertInto('app_seed_runs').values({ key }).execute()
      return 'created'
    })
  }
}
