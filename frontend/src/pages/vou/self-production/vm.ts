import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'

export const useSelfProductionViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['self-production'])
