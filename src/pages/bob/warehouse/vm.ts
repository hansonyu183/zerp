import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const warehouseConfig = getBobEntityConfig('warehouse')
export const useWarehouseViewModel = () => useBobEntityViewModel(warehouseConfig)
