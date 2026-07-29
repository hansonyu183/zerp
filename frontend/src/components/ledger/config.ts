import type {
  LedgerColumn,
  LedgerEntityConfig,
  LedgerOption,
  LedgerRecord,
  LedgerReference,
} from './types'
import { formatLocalDateTime } from '@/utils/date'

const inventorySourceEntities: readonly LedgerOption[] = [
  { title: '期初', value: 'opening' },
  { title: '销售出库', value: 'sale-outbound' },
  { title: '销售退货', value: 'sale-return' },
  { title: '采购入库', value: 'purchase-inbound' },
  { title: '采购退货', value: 'purchase-return' },
]

const fundSourceEntities: readonly LedgerOption[] = [
  { title: '期初', value: 'opening' },
  { title: '往来收款', value: 'receipt' },
  { title: '往来付款', value: 'payment' },
  { title: '费用报销', value: 'expense-reimbursement' },
  { title: '其他收入', value: 'other-income' },
]

const partySourceEntities: readonly LedgerOption[] = [
  { title: '期初', value: 'opening' },
  { title: '销售签收', value: 'sale-signoff' },
  { title: '销售退货', value: 'sale-return' },
  { title: '采购入库', value: 'purchase-inbound' },
  { title: '采购退货', value: 'purchase-return' },
  { title: '往来收款', value: 'receipt' },
  { title: '往来付款', value: 'payment' },
]

const containerSourceEntities: readonly LedgerOption[] = [
  { title: '期初', value: 'opening' },
]

const directionText: Readonly<Record<string, string>> = {
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
  col('remark', '备注', (row) => text(row, 'remark')),
]

const inOut: readonly LedgerOption[] = [
  { title: '流入', value: 'IN' },
  { title: '流出', value: 'OUT' },
]

const inventoryInOut: readonly LedgerOption[] = [
  { title: '入库', value: 'IN' },
  { title: '出库', value: 'OUT' },
]

function quantityForDirection(
  row: LedgerRecord,
  direction: 'IN' | 'OUT',
): string {
  return row.direction === direction ? text(row, 'quantity') : ''
}

export const ledgerSourceEntityOptions = inventorySourceEntities

export const ledgerEntityConfigs: Readonly<
  Record<LedgerEntityConfig['entity'], LedgerEntityConfig>
> = {
  inventory: {
    entity: 'inventory',
    title: '库存台账',
    objectLabel: '仓库或商品',
    referenceSources: [{ entity: 'warehouse' }, { entity: 'product' }],
    sourceEntities: inventorySourceEntities,
    directions: inventoryInOut,
    entryColumns: [
      ...commonEntryColumns,
      col('warehouse', '仓库', (row) => reference(row, 'warehouse')),
      col('product', '商品', (row) => reference(row, 'product')),
      col('inQuantity', '入库', (row) => quantityForDirection(row, 'IN'), {
        align: 'end',
      }),
      col('outQuantity', '出库', (row) => quantityForDirection(row, 'OUT'), {
        align: 'end',
      }),
      col('unit', '单位', (row) => nested(row, 'product')?.unit ?? '—'),
      col('unitPrice', '单价', (row) => text(row, 'unitPrice'), {
        align: 'end',
      }),
      col('amount', '金额', (row) => text(row, 'amount'), { align: 'end' }),
      col('currency', '币种', (row) => text(row, 'currency')),
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
    sourceEntities: fundSourceEntities,
    directions: inOut,
    entryColumns: [
      ...commonEntryColumns,
      col('fundAccount', '账户', (row) => reference(row, 'fundAccount')),
      col('direction', '方向', (row) =>
        translated(row, 'direction', directionText)),
      col('amount', '金额', (row) => text(row, 'amount'), { align: 'end' }),
      ...endingEntryColumns,
    ],
    balanceColumns: [
      col('fundAccount', '账户', (row) => reference(row, 'fundAccount')),
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
    sourceEntities: partySourceEntities,
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
      ...endingEntryColumns,
    ],
    balanceColumns: [
      col('counterparty', '往来方', (row) => reference(row, 'counterparty')),
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
    sourceEntities: containerSourceEntities,
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
