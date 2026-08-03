import { useBobEntityViewModel } from '../shared/vm'
import { otherPartyConfig } from './config'

export { otherPartyConfig } from './config'
export const useOtherPartyViewModel = () =>
  useBobEntityViewModel(otherPartyConfig)
