import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
export const usePaymentViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs.payment)
