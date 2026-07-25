import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const customerConfig = getBobEntityConfig('customer')
export const useCustomerViewModel = () => useBobEntityViewModel(customerConfig)
