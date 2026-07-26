import { useBobEntityViewModel } from '../shared/vm'
import { serviceConfig } from './config'

export { serviceConfig } from './config'
export const useServiceViewModel = () => useBobEntityViewModel(serviceConfig)
