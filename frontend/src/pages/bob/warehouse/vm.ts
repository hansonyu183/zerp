import { useBobEntityViewModel } from '../shared/vm'
import { warehouseConfig } from './config'

export { warehouseConfig } from './config'
export const useWarehouseViewModel = () => useBobEntityViewModel(warehouseConfig)
