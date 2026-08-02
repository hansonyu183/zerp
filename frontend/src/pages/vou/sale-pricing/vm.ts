import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
export const useSalePricingViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['sale-pricing'])
