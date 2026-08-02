import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
export const usePurchaseInquiryViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['purchase-inquiry'])
