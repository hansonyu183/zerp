import { useBobEntityViewModel } from '../shared/vm'
import { productConfig } from './config'

export { productConfig } from './config'
export const useProductViewModel = () => useBobEntityViewModel(productConfig)
