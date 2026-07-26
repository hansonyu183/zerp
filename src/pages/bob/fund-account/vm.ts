import { useBobEntityViewModel } from '../shared/vm'
import { fundAccountConfig } from './config'

export { fundAccountConfig } from './config'
export const useFundAccountViewModel = () => useBobEntityViewModel(fundAccountConfig)
