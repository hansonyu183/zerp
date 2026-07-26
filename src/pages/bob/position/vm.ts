import { useBobEntityViewModel } from '../shared/vm'
import { positionConfig } from './config'

export { positionConfig } from './config'
export const usePositionViewModel = () => useBobEntityViewModel(positionConfig)
