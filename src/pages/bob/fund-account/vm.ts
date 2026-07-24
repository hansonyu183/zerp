import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const fundAccountConfig = getBobEntityConfig('fund-account')
export const useFundAccountViewModel = () =>
  useBobEntityViewModel(fundAccountConfig)
