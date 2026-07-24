import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
export const usePurchaseOrderViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['purchase-order'])
