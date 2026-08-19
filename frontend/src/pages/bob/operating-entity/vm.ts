import { useBobEntityViewModel } from '../shared/vm'
import { operatingEntityConfig } from './config'

export const useOperatingEntityViewModel = () =>
  useBobEntityViewModel(operatingEntityConfig)
