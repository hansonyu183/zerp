import { useVoucherEntityViewModel } from '../shared/vm'
import { voucherEntityConfigs } from '../shared/config'
export const useExpenseReimbursementViewModel = () =>
  useVoucherEntityViewModel(voucherEntityConfigs['expense-reimbursement'])
