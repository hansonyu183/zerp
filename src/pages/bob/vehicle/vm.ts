import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const vehicleConfig = getBobEntityConfig('vehicle')
export const useVehicleViewModel = () => useBobEntityViewModel(vehicleConfig)
