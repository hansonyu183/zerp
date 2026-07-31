import type {
  VoucherEntityConfig,
  VoucherLifecycleAction,
  VoucherListItem,
  VoucherStatus,
} from '@/components/voucher'

const lifecycleStatuses: Record<VoucherLifecycleAction, VoucherStatus> = {
  check: 'DRAFT',
  uncheck: 'CHECKED',
  approve: 'CHECKED',
  unapprove: 'APPROVED',
  finalize: 'APPROVED',
  unfinalize: 'FINALIZED',
}

export function canRunListLifecycleAction(
  config: VoucherEntityConfig,
  row: VoucherListItem,
  action: VoucherLifecycleAction,
  can: (permission: string) => boolean,
): boolean {
  return (
    row.status === lifecycleStatuses[action] &&
    (action !== 'finalize' || config.finalizationKind === 'direct') &&
    can(`/vou/${config.entity}/${action}`)
  )
}
