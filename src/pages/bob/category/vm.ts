import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const categoryConfig = getBobEntityConfig('category')
export const useCategoryViewModel = () => useBobEntityViewModel(categoryConfig)
