import type { VoucherStatus } from './types'

export const voucherStatusLabels: Readonly<Record<VoucherStatus, string>> = {
  DRAFT: '草稿',
  CHECKED: '已核对',
  APPROVED: '已批准',
  FINALIZED: '已完成',
  ORDERED: '已下单',
  CONFIRMED: '已确认',
  EXECUTED: '已执行',
}

export const voucherStatusOptions: readonly {
  title: string
  value: VoucherStatus
}[] = Object.entries(voucherStatusLabels).map(([value, title]) => ({
  title,
  value: value as VoucherStatus,
}))

export function formatVoucherStatus(
  status: VoucherStatus,
  overrides: Partial<Record<VoucherStatus, string>> = {},
): string {
  return overrides[status] ?? voucherStatusLabels[status]
}
