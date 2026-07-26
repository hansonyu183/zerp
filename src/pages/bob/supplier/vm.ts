import { useBobEntityViewModel } from '../shared/vm'
import { supplierConfig } from './config'

export { supplierConfig } from './config'
export const useSupplierViewModel = () => useBobEntityViewModel(supplierConfig)
