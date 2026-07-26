import { useBobEntityViewModel } from '../shared/vm'
import { categoryConfig } from './config'

export { categoryConfig } from './config'
export const useCategoryViewModel = () => useBobEntityViewModel(categoryConfig)
