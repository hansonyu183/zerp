import { voucherEntityConfigs } from '../shared/config'
import { useVoucherEntityViewModel } from '../shared/vm'

export const useSaleSignoffViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['sale-signoff'])
