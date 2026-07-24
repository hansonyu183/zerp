import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const supplierConfig = getBobEntityConfig('supplier')
export const useSupplierViewModel = () => useBobEntityViewModel(supplierConfig)
