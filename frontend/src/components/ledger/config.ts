import type {
  LedgerColumn,
  LedgerEntityConfig,
  LedgerOption,
  LedgerRecord,
  LedgerReference,
} from './types'
import { formatLocalDateTime } from '@/utils/date'

const sourceEntities: readonly LedgerOption[] = [
  { title: '期初', value: 'opening' },
  { title: '销售单', value: 'sale-order' },
  { title: '采购单', value: 'purchase-order' },
  { title: '居间销售单', value: 'intermediary-sale-order' },
  { title: '收款单', value: 'receipt' },
  { title: '付款单', value: 'payment' },
  { title: '费用报销单', value: 'expense-reimbursement' },
  { title: '其它收入单', value: 'other-income' },
  { title: '居间收货确认', value: 'intermediary-receipt' },
  { title: '居间签收确认', value: 'intermediary-signoff' },
]

const directionText: Record<string, string> = {
  IN: '流入',
  OUT: '流出',
  DEBIT: '借记',
  CREDIT: '贷记',
}

const balanceText: Record<string, string> = {
  POSITIVE: '正余额',
  OVERDRAFT: '透支',
  RECEIVABLE: '应收',
  PAYABLE: '应付',
  ZERO: '零余额',
}

const entryTypeText: Record<string, string> = {
  OPENING: '期初',
  POSTING: '入账',
  REVERSAL: '冲销',
}

const containerTypeText: Record<string, string> = {
  SOLVENT: '溶剂桶',
  RESIN: '树脂桶',
}

function nested(row: LedgerRecord, key: string): LedgerReference | null {
  const value = row[key]
  return value && typeof value === 'object'
    ? value as LedgerReference
    : null
}

function reference(row: LedgerRecord, key: string): string {
  const value = nested(row, key)
  return value ? `${value.code} · ${value.name}` : '—'
}

function text(row: LedgerRecord, key: string): string {
  const value = row[key]
  return value === null || value === undefined || value === ''
    ? '—'
    : String(value)
}

function time(row: LedgerRecord, key: string): string {
  const value = text(row, key)
  return formatLocalDateTime(value === '—' ? null : value)
}

function translated(
  row: LedgerRecord,
  key: string,
  values: Record<string, string>,
): string {
  const value = text(row, key)
  return values[value] ?? value
}

function col(
  key: string,
  label: string,
  value: LedgerColumn['value'],
  options: Pick<LedgerColumn, 'align' | 'width'> = {},
): LedgerColumn {
  return { key, label, value, ...options }
}

const commonEntryColumns: readonly LedgerColumn[] = [
  col('effectiveDate', '日期', (row) => text(row, 'effectiveDate')),
  col('occurredAt', '入账', (row) => time(row, 'occurredAt')),
  col('entryType', '类型', (row) =>
    translated(row, 'entryType', entryTypeText)),
  col('sourceDocumentNo', '单号', (row) =>
    text(row, 'sourceDocumentNo')),
]

const endingEntryColumns: readonly LedgerColumn[] = [
  col('reason', '原因', (row) => text(row, 'reason')),
]

const inOut: readonly LedgerOption[] = [
  { title: '流入', value: 'IN' },
  { title: '流出', value: 'OUT' },
]

export const ledgerSourceEntityOptions = sourceEntities

export const ledgerEntityConfigs: Readonly<
  Record<LedgerEntityConfig['entity'], LedgerEntityConfig>
> = {
  inventory: {
    entity: 'inventory',
    title: '库存台账',
    objectLabel: '仓库或商品',
    referenceSources: [{ entity: 'warehouse' }, { entity: 'product' }],
    directions: inOut,
    entryColumns: [
      ...commonEntryColumns,
      col('warehouse', '仓库', (row) => reference(row, 'warehouse')),
      col('product', '商品', (row) => reference(row, 'product')),
      col('direction', '方向', (row) =>
        translated(row, 'direction', directionText)),
      col('quantity', '数量', (row) => text(row, 'quantity'), { align: 'end' }),
      col('unit', '单位', (row) => nested(row, 'product')?.unit ?? '—'),
      ...endingEntryColumns,
    ],
    balanceColumns: [
      col('warehouse', '仓库', (row) => reference(row, 'warehouse')),
      col('product', '商品', (row) => reference(row, 'product')),
      col('quantity', '数量', (row) => text(row, 'quantity'), { align: 'end' }),
      col('unit', '单位', (row) => nested(row, 'product')?.unit ?? '—'),
    ],
  },
  fund: {
    entity: 'fund',
    title: '资金台账',
    objectLabel: '资金账户',
    referenceSources: [{ entity: 'fund-account' }],
    directions: inOut,
    entryColumns: [
      ...commonEntryColumns,
      col('fundAccount', '账户', (row) => reference(row, 'fundAccount')),
      col('direction', '方向', (row) =>
        translated(row, 'direction', directionText)),
      col('amount', '金额', (row) => text(row, 'amount'), { align: 'end' }),
      col('currency', '币种', (row) => text(row, 'currency')),
      ...endingEntryColumns,
    ],
    balanceColumns: [
      col('fundAccount', '账户', (row) => reference(row, 'fundAccount')),
      col('currency', '币种', (row) => text(row, 'currency')),
      col('balanceType', '性质', (row) =>
        translated(row, 'balanceType', balanceText)),
      col('amount', '金额', (row) => text(row, 'amount'), { align: 'end' }),
    ],
  },
  party: {
    entity: 'party',
    title: '往来台账',
    objectLabel: '客户或供应商',
    referenceSources: [
      { entity: 'customer' },
      { entity: 'supplier', filters: { supplierType: 'GENERAL' } },
    ],
    directions: [
      { title: '借记', value: 'DEBIT' },
      { title: '贷记', value: 'CREDIT' },
    ],
    entryColumns: [
      ...commonEntryColumns,
      col('counterparty', '往来方', (row) => reference(row, 'counterparty')),
      col('direction', '方向', (row) =>
        translated(row, 'direction', directionText)),
      col('amount', '金额', (row) => text(row, 'amount'), { align: 'end' }),
      col('currency', '币种', (row) => text(row, 'currency')),
      ...endingEntryColumns,
    ],
    balanceColumns: [
      col('counterparty', '往来方', (row) => reference(row, 'counterparty')),
      col('currency', '币种', (row) => text(row, 'currency')),
      col('balanceType', '性质', (row) =>
        translated(row, 'balanceType', balanceText)),
      col('amount', '金额', (row) => text(row, 'amount'), { align: 'end' }),
    ],
  },
  container: {
    entity: 'container',
    title: '空桶台账',
    objectLabel: '客户',
    referenceSources: [{ entity: 'customer' }],
    directions: [],
    entryColumns: [
      ...commonEntryColumns,
      col('rootDocumentNo', '根单', (row) => text(row, 'rootDocumentNo')),
      col('customer', '客户', (row) => reference(row, 'customer')),
      col('containerType', '桶型', (row) =>
        translated(row, 'containerType', containerTypeText)),
      col('quantity', '增量', (row) => text(row, 'quantity'), {
        align: 'end',
      }),
      ...endingEntryColumns,
    ],
    balanceColumns: [
      col('customer', '客户', (row) => reference(row, 'customer')),
      col('containerType', '桶型', (row) =>
        translated(row, 'containerType', containerTypeText)),
      col('quantity', '欠桶', (row) => text(row, 'quantity'), {
        align: 'end',
      }),
    ],
  },
}
