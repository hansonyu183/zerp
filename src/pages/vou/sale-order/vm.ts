import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
export const useSaleOrderViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['sale-order'])
