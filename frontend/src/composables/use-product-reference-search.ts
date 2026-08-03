import { onScopeDispose, ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageResult } from '@/api/types'

export interface ProductReference {
  objectId: string
  versionId: string
  entity?: string
  code: string
  name: string
  unit?: string
  productKind?: string
}

interface ProductListItem {
  objectId: string
  code: string
  currentVersion: {
    versionId: string
    summary: {
      name: string
      unit?: string
      productKind?: string
    }
  }
}

export function useProductReferenceSearch(
  productKind: 'RAW_MATERIAL' | 'PACKAGING',
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
      const { data } = await apiClient.post<
        PageResult<ProductListItem>,
        {
          page: number
          pageSize: number
          filters: Record<string, unknown>
          sort: Array<{ field: string; order: 'asc' | 'desc' }>
        }
      >('bob/product/query', {
        page: 1,
        pageSize: 100,
        filters: {
          productKind,
          status: ['EFFECTIVE'],
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        },
        sort: [{ field: 'name', order: 'asc' }],
      })
      if (disposed || sequence !== requestSequence) return

      const selected = [...selectedReferences()]
      const fetched: ProductReference[] = (data.items ?? []).map((item) => ({
        objectId: item.objectId,
        versionId: item.currentVersion.versionId,
        entity: 'product',
        code: item.code,
        name: item.currentVersion.summary.name,
        unit: item.currentVersion.summary.unit ?? '',
        productKind: item.currentVersion.summary.productKind,
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
