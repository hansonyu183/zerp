import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'

export const usePurchaseInboundViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['purchase-inbound'])
