export interface BillVoucherConfig {
  entity: 'bill-receipt' | 'bill-payment' | 'bill-issue'
  title: string
  mode: 'receipt' | 'payment' | 'issue'
  maxBillLines: number
  maxCashLines: number
}

export const billVoucherConfigs: Readonly<
  Record<BillVoucherConfig['entity'], BillVoucherConfig>
> = {
  'bill-receipt': {
    entity: 'bill-receipt',
    title: '票据收入',
    mode: 'receipt',
    maxBillLines: 20,
    maxCashLines: 20,
  },
  'bill-payment': {
    entity: 'bill-payment',
    title: '票据付出',
    mode: 'payment',
    maxBillLines: 20,
    maxCashLines: 0,
  },
  'bill-issue': {
    entity: 'bill-issue',
    title: '票据开出',
    mode: 'issue',
    maxBillLines: 20,
    maxCashLines: 20,
  },
}
