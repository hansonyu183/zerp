import type { VoucherStatus } from './types'
import {
  approvalStatusOptions,
  approvalStatusPresentation,
} from '@/shared/approval'

export const voucherStatusLabels: Readonly<Record<VoucherStatus, string>> =
  Object.fromEntries(
    Object.entries(approvalStatusPresentation).map(([status, value]) => [
      status,
      value.label,
    ]),
  ) as Record<VoucherStatus, string>

export const voucherStatusOptions = approvalStatusOptions

export function formatVoucherStatus(status: VoucherStatus): string {
  return approvalStatusPresentation[status].label
}
