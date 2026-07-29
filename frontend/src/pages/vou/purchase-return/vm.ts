import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'

export const usePurchaseReturnViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['purchase-return'])
