import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'

export const useOrderProductionViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['order-production'])
