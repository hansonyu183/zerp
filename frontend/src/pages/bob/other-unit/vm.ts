import { useBobEntityViewModel } from '../shared/vm'
import { otherUnitConfig } from './config'

export { otherUnitConfig } from './config'
export const useOtherUnitViewModel = () =>
  useBobEntityViewModel(otherUnitConfig)
