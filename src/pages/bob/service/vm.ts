import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const serviceConfig = getBobEntityConfig('service')
export const useServiceViewModel = () => useBobEntityViewModel(serviceConfig)
