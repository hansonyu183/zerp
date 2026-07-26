import { useBobEntityViewModel } from '../shared/vm'
import { vehicleConfig } from './config'

export { vehicleConfig } from './config'
export const useVehicleViewModel = () => useBobEntityViewModel(vehicleConfig)
