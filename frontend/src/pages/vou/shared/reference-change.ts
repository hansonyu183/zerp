import type { Ref } from 'vue'
import type {
  VoucherDraftForm,
  VoucherEntityConfig,
} from '@/components/voucher'

const PERSONNEL_KEYS = new Set(['salesperson', 'purchaser'])

export function createVoucherReferenceChangeHandler(
  config: VoucherEntityConfig,
  form: Ref<VoucherDraftForm>,
  personnelDirty: Set<string>,
  refreshCustomFormulas: () => Promise<void>,
  refreshPriceReferences: () => Promise<void>,
) {
  return (key: keyof VoucherDraftForm): void => {
    if (PERSONNEL_KEYS.has(key)) personnelDirty.add(key)
    if (key === 'customer' && config.entity === 'sale-order') {
      void refreshCustomFormulas()
    }
    if (key === 'fundAccount') {
      form.value.currency = form.value.fundAccount?.currency ?? ''
    }
    if (key === 'platform') form.value.vehicle = null
    if (key === 'counterpartyType') form.value.counterparty = null
    if (key === 'supplier' && config.entity === 'purchase-order') {
      void refreshPriceReferences()
    }
  }
}
