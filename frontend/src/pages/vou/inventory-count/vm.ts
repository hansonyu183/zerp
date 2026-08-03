import { voucherEntityConfigs } from '../shared/config'
import { useVoucherEntityViewModel } from '../shared/vm'

export const useInventoryCountViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['inventory-count'])
