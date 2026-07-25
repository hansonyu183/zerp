import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
export const useReceiptViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs.receipt)
