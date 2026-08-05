export interface BillVoucherConfig {
  entity: 'bill-receipt' | 'bill-payment'
  title: string
  mode: 'receipt' | 'payment'
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
}
