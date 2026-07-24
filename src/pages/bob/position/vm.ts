import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const positionConfig = getBobEntityConfig('position')
export const usePositionViewModel = () => useBobEntityViewModel(positionConfig)
