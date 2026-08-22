import { onScopeDispose, ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'

export interface ProductReference {
  objectId: string
  versionId: string
  entity?: string
  code: string
  name: string
  behaviorProfile?: string
  defaultInputUnitId?: string
  pricingUnitId?: string
  unitConversions?: Array<{
    unit: {
      objectId: string
      versionId?: string
      code?: string
      name?: string
      symbol?: string
    }
    factor: string
  }>
}

export function useProductReferenceSearch(
  behaviorProfile: 'RAW_MATERIAL' | 'PACKAGING',
  selectedReferences: () => readonly ProductReference[],
): {
  options: Ref<ProductReference[]>
  loading: Ref<boolean>
  errorMessage: Ref<string | null>
  search: (keyword: string) => Promise<void>
} {
  const options = ref<ProductReference[]>([])
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  let requestSequence = 0
  let disposed = false

  async function search(keyword: string): Promise<void> {
    const sequence = ++requestSequence
    loading.value = true
    errorMessage.value = null
    try {
      const { data } = await apiClient.post<ProductReference[], {
        entity: 'product'
        keyword?: string
        behaviorProfile: typeof behaviorProfile
      }>('bob/reference/query', {
        entity: 'product',
        behaviorProfile,
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
      })
      if (disposed || sequence !== requestSequence) return

      const selected = [...selectedReferences()]
      const fetched: ProductReference[] = (data ?? []).map((item) => ({
        ...item,
        entity: 'product',
        unitConversions: item.unitConversions ?? [],
      }))
      options.value = [
        ...selected,
        ...fetched.filter(
          (candidate) =>
            !selected.some((item) => item.objectId === candidate.objectId),
        ),
      ]
    } catch (error) {
      if (!disposed && sequence === requestSequence) {
        errorMessage.value = getErrorMessage(error)
      }
    } finally {
      if (!disposed && sequence === requestSequence) loading.value = false
    }
  }

  onScopeDispose(() => {
    disposed = true
    requestSequence += 1
  })

  return { options, loading, errorMessage, search }
}
