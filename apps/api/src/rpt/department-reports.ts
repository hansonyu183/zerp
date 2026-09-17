import type { RptColumn, RptParameter } from './service.ts'

function columns(
  fields: readonly (readonly [string, string, RptColumn['type']])[],
): RptColumn[] {
  return fields.map(([alias, name, type], index) => ({
    alias,
    name,
    type,
    order: index + 1,
    width: 160,
    visible: true,
  }))
}
const asOf: RptParameter = {
  key: 'asOfDate',
  name: '截止日期',
  type: 'DATE',
  required: true,
}
const book: RptParameter = {
  key: 'bookId',
  name: '账簿',
  type: 'REFERENCE',
  referenceType: 'ACCOUNTING_BOOK',
  required: true,
}

/** These reviewed SQL definitions are the reporting entry points for limited customer access. */
export const departmentReports = [
  {
    key: 'customer-balance',
    subjectId: '01M2R3D0000000000000000001',
    name: '客户往来余额',
    customerScoped: true,
    parameters: [book, asOf],
    sql: `WITH facts AS (
      SELECT line.dimensions->>'CUSTOMER' AS customer_id, journal.currency, subject.settlement_purpose,
        CASE WHEN line.direction = 'DEBIT' THEN line.amount ELSE -line.amount END AS debit_amount
      FROM acc_journal_entries journal
      JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
      JOIN acc_subjects subject ON subject.id = line.subject_id
      WHERE journal.book_id = :bookId AND journal.business_date <= :asOfDate::date
        AND subject.settlement_purpose IN ('RECEIVABLE', 'ADVANCE_RECEIPT')
        AND line.dimensions->>'CUSTOMER' = ANY(:authorizedCustomerIds::varchar[])
    ) SELECT customer.code::text AS customer_code, facts.currency::text AS currency,
      COALESCE(SUM(facts.debit_amount) FILTER (WHERE facts.settlement_purpose = 'RECEIVABLE'), 0)::numeric AS receivable,
      COALESCE(SUM(-facts.debit_amount) FILTER (WHERE facts.settlement_purpose = 'ADVANCE_RECEIPT'), 0)::numeric AS advance_receipt
      FROM facts JOIN bob_archive_objects customer ON customer.id = facts.customer_id
      GROUP BY customer.id, customer.code, facts.currency ORDER BY customer.code, facts.currency`,
    columns: columns([
      ['customer_code', '客户编码', 'TEXT'],
      ['currency', '币种', 'TEXT'],
      ['receivable', '应收余额', 'DECIMAL'],
      ['advance_receipt', '预收余额', 'DECIMAL'],
    ]),
  },
  {
    key: 'customer-sales',
    subjectId: '01M2R3D0000000000000000002',
    name: '客户销售订单明细',
    customerScoped: true,
    parameters: [
      {
        key: 'dates',
        name: '期间',
        type: 'DATE_RANGE',
        required: true,
      } satisfies RptParameter,
    ],
    sql: `SELECT customer.code::text AS customer_code, version.display_name::text AS customer_name,
      document.id::text AS document_id, document.document_no::text AS document_no,
      detail.business_date AS business_date, detail.currency::text AS currency,
      (detail.total_amount_minor::numeric / 100)::numeric AS amount
      FROM vou_documents document
      JOIN approval_entries approval ON approval.subject_id = document.id AND approval.domain = 'vou' AND approval.entity = 'sale-order' AND approval.status = 'APPROVED'
      JOIN vou_sale_order_details detail ON detail.approval_entry_id = approval.id
      JOIN vou_reference_snapshots reference ON reference.approval_entry_id = approval.id AND reference.field = 'customer' AND reference.line_no = 0 AND reference.item_no = 0
      JOIN bob_archive_objects customer ON customer.id = reference.object_id
      JOIN dcl_customer_versions version ON version.approval_entry_id = reference.approval_reference_id
      WHERE detail.business_date BETWEEN (:dates::date[])[1] AND (:dates::date[])[2]
        AND customer.id = ANY(:authorizedCustomerIds::varchar[])
      ORDER BY detail.business_date, document.document_no`,
    columns: columns([
      ['customer_code', '客户编码', 'TEXT'],
      ['customer_name', '客户名称', 'TEXT'],
      ['document_id', '单据标识', 'ID'],
      ['document_no', '单号', 'TEXT'],
      ['business_date', '业务日期', 'DATE'],
      ['currency', '币种', 'TEXT'],
      ['amount', '金额', 'DECIMAL'],
    ]),
  },
  {
    key: 'ledger',
    subjectId: '01M2R3D0000000000000000003',
    name: '科目流水',
    customerScoped: false,
    parameters: [
      book,
      {
        key: 'dates',
        name: '期间',
        type: 'DATE_RANGE',
        required: true,
      } satisfies RptParameter,
    ],
    sql: `SELECT journal.business_date AS business_date, subject.code::text AS subject_code, subject.name::text AS subject_name,
      journal.currency::text AS currency, (CASE WHEN line.direction = 'DEBIT' THEN line.amount ELSE 0 END)::numeric AS debit_amount,
      (CASE WHEN line.direction = 'CREDIT' THEN line.amount ELSE 0 END)::numeric AS credit_amount
      FROM acc_journal_entries journal JOIN acc_journal_lines line ON line.journal_entry_id = journal.id
      JOIN acc_subjects subject ON subject.id = line.subject_id
      WHERE journal.book_id = :bookId AND journal.business_date BETWEEN (:dates::date[])[1] AND (:dates::date[])[2]
      ORDER BY journal.business_date, journal.id, line.id`,
    columns: columns([
      ['business_date', '业务日期', 'DATE'],
      ['subject_code', '科目编码', 'TEXT'],
      ['subject_name', '科目名称', 'TEXT'],
      ['currency', '币种', 'TEXT'],
      ['debit_amount', '借方金额', 'DECIMAL'],
      ['credit_amount', '贷方金额', 'DECIMAL'],
    ]),
  },
  {
    key: 'inventory',
    subjectId: '01M2R3D0000000000000000004',
    name: '库存数量余额',
    customerScoped: false,
    parameters: [book, asOf],
    sql: `SELECT warehouse.code::text AS warehouse_code, product.code::text AS product_code, SUM(entry.quantity)::numeric AS quantity
      FROM acc_inventory_entries entry JOIN aux_objects warehouse ON warehouse.id = entry.warehouse_id
      JOIN bob_archive_objects product ON product.id = entry.product_id
      WHERE entry.book_id = :bookId AND entry.business_date <= :asOfDate::date AND entry.reversed_at IS NULL
      GROUP BY warehouse.id, warehouse.code, product.id, product.code ORDER BY warehouse.code, product.code`,
    columns: columns([
      ['warehouse_code', '仓库编码', 'TEXT'],
      ['product_code', '产品编码', 'TEXT'],
      ['quantity', '库存数量', 'DECIMAL'],
    ]),
  },
] as const
