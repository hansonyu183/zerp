import { useBobEntityViewModel } from '../shared/vm'
import { employeeConfig } from './config'

export { employeeConfig } from './config'

export const useEmployeeViewModel = () => useBobEntityViewModel(employeeConfig)
