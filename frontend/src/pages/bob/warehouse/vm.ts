import { useBobEntityViewModel } from '../shared/vm'
import { warehouseConfig } from './config'
import { useWarehouseDisable } from './disable'

export { warehouseConfig } from './config'

export function useWarehouseViewModel() {
  const model = useBobEntityViewModel(warehouseConfig)
  return {
    ...model,
    ...useWarehouseDisable(
      model.actionLoading,
      model.errorMessage,
      (row) => model.actionAvailability(row).disable,
      model.changeEnabled,
    ),
  }
}

export type WarehouseViewModel = ReturnType<typeof useWarehouseViewModel>
