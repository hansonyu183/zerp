import { voucherEntityConfigs } from '../shared/config'
import { useVoucherEntityViewModel } from '../shared/vm'

export const useSaleOutboundViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['sale-outbound'])
