export interface BillVoucherConfig {
  entity: 'bill-receipt'
  title: string
  maxBillLines: number
  maxCashLines: number
}

export const billVoucherConfigs: Readonly<
  Record<BillVoucherConfig['entity'], BillVoucherConfig>
> = {
  'bill-receipt': {
    entity: 'bill-receipt',
    title: '票据收入',
    maxBillLines: 20,
    maxCashLines: 20,
  },
}
