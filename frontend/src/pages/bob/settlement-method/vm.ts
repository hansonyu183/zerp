import { useBobEntityViewModel } from '../shared/vm'
import { settlementMethodConfig } from './config'

export { settlementMethodConfig } from './config'
export const useSettlementMethodViewModel = () =>
  useBobEntityViewModel(settlementMethodConfig)
