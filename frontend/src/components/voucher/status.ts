import type { VoucherStatus } from './types'

export const voucherStatusLabels: Readonly<Record<VoucherStatus, string>> = {
  DRAFT: '草稿',
  PENDING: '待审核',
  APPROVED: '已批准',
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
