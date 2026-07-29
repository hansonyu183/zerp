import { voucherEntityConfigs } from '../shared/config'
import { useVoucherEntityViewModel } from '../shared/vm'

export const useSaleReturnViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['sale-return'])
