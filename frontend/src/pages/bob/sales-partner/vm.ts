import { useBobEntityViewModel } from '../shared/vm'
import { salesPartnerConfig } from './config'
export { salesPartnerConfig } from './config'
export const useSalesPartnerViewModel = () =>
  useBobEntityViewModel(salesPartnerConfig)
