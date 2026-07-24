import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const settlementMethodConfig = getBobEntityConfig('settlement-method')
export const useSettlementMethodViewModel = () =>
  useBobEntityViewModel(settlementMethodConfig)
