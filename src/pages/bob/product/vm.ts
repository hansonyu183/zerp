import { getBobEntityConfig } from '../shared/config'
import { useBobEntityViewModel } from '../shared/vm'

export const productConfig = getBobEntityConfig('product')
export const useProductViewModel = () => useBobEntityViewModel(productConfig)
