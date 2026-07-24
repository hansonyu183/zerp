import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const employeeConfig = getBobEntityConfig('employee')
export const useEmployeeViewModel = () => useBobEntityViewModel(employeeConfig)
