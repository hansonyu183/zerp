import { useBobEntityViewModel } from '../shared/vm'
import { departmentConfig } from './config'

export { departmentConfig } from './config'
export const useDepartmentViewModel = () => useBobEntityViewModel(departmentConfig)
