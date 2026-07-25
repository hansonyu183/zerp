import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
export const useOtherIncomeViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['other-income'])
