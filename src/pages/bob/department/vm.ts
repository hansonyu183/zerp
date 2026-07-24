import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const departmentConfig = getBobEntityConfig('department')
export const useDepartmentViewModel = () =>
  useBobEntityViewModel(departmentConfig)
