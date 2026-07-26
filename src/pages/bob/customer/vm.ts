import { useBobEntityViewModel } from '../shared/vm'
import { customerConfig } from './config'

export { customerConfig } from './config'
export const useCustomerViewModel = () => useBobEntityViewModel(customerConfig)
