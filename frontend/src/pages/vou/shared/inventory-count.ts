import { computed, ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type {
  VoucherDraftForm,
  VoucherEntityConfig,
  VoucherReference,
} from '@/components/voucher'

interface InventoryCountBalancePage {
  items: Array<{
    product: VoucherReference
    quantity: string
  }>
  total: number
  page: number
  pageSize: number
}

export function useVoucherInventoryCount(
  config: VoucherEntityConfig,
  form: Ref<VoucherDraftForm>,
  can: (permission: string) => boolean,
  setError: (message: string | null) => void,
) {
  const loading = ref(false)
  const canLoad = computed(
    () =>
      config.entity === 'inventory-count' &&
      can('/vou/inventory-count/book-balance') &&
      Boolean(form.value.warehouse && form.value.businessDate),
  )

  async function loadBalance(): Promise<void> {
    if (!canLoad.value || !form.value.warehouse) return
    loading.value = true
    setError(null)
    try {
      const { data } = await apiClient.post<
        InventoryCountBalancePage,
        {
          page: number
          pageSize: number
          warehouseObjectId: string
          asOfDate: string
        }
      >('vou/inventory-count/book-balance', {
        page: 1,
        pageSize: 200,
        warehouseObjectId: form.value.warehouse.objectId,
        asOfDate: form.value.businessDate,
      })
      if (data.total > 200) {
        setError(
          `该仓库有 ${data.total} 个非零库存商品，超过单据 200 行上限，请拆分盘点。`,
        )
        return
      }
      const existing = new Map(
        form.value.inventoryCountLines
          .filter((line) => line.product)
          .map((line) => [line.product!.objectId, line]),
      )
      const loadedProductIds = new Set<string>()
      const loadedLines = (data.items ?? []).map((item) => {
        loadedProductIds.add(item.product.objectId)
        const current = existing.get(item.product.objectId)
        return current
          ? {
              ...current,
              product: item.product,
              bookBaseQuantity: item.quantity,
            }
          : {
              key: crypto.randomUUID(),
              product: item.product,
              enteredQuantity: '',
              enteredUnit:
                item.product.unitConversions?.find(
                  (conversion) =>
                    conversion.unit.objectId ===
                    item.product.defaultInputUnitId,
                )?.unit ?? null,
              baseQuantity: '',
              bookBaseQuantity: item.quantity,
              remark: '',
            }
      })
      const manuallyAddedLines = form.value.inventoryCountLines.filter(
        (line) => line.product && !loadedProductIds.has(line.product.objectId),
      )
      form.value.inventoryCountLines = [...loadedLines, ...manuallyAddedLines]
    } catch (error) {
      setError(getErrorMessage(error))
    } finally {
      loading.value = false
    }
  }

  return {
    inventoryBalanceLoading: loading,
    canLoadInventoryBalance: canLoad,
    loadInventoryCountBalance: loadBalance,
  }
}
