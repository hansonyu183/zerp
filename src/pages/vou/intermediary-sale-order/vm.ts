import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
export const useIntermediarySaleOrderViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['intermediary-sale-order'])
