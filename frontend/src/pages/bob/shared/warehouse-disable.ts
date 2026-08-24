import { ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import type { BobListItem } from './types'

type WarehouseDisablePrecheck =
  components['schemas']['WarehouseDisablePrecheckResult']

export function useWarehouseDisable(
  entity: string,
  actionLoading: Ref<string | null>,
  errorMessage: Ref<string | null>,
  canDisable: (row: Readonly<BobListItem>) => boolean,
  changeEnabled: (row: BobListItem) => Promise<boolean>,
) {
  const warehouseDisableTarget = ref<BobListItem | null>(null)
  const warehouseDisablePrecheck = ref<WarehouseDisablePrecheck | null>(null)

  function closeWarehouseDisablePrecheck(): void {
    warehouseDisableTarget.value = null
    warehouseDisablePrecheck.value = null
  }

  async function requestChangeEnabled(row: BobListItem): Promise<void> {
    if (entity !== 'warehouse' || !row.enabled) {
      await changeEnabled(row)
      return
    }
    if (!canDisable(row) || actionLoading.value) return
    actionLoading.value = `disable-precheck:${row.objectId}`
    errorMessage.value = null
    try {
      const response = await apiClient.post<
        WarehouseDisablePrecheck,
        { objectId: string }
      >('bob/warehouse/disable-precheck', { objectId: row.objectId })
      warehouseDisableTarget.value = row
      warehouseDisablePrecheck.value = response.data
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
    } finally {
      actionLoading.value = null
    }
  }

  async function confirmWarehouseDisable(): Promise<boolean> {
    const target = warehouseDisableTarget.value
    const precheck = warehouseDisablePrecheck.value
    if (!target || !precheck) return false
    if (
      precheck.inventory.length > 0 ||
      precheck.inProgressDocuments.length > 0 ||
      precheck.executableSources.length > 0
    ) {
      return false
    }
    const completed = await changeEnabled(target)
    if (completed) closeWarehouseDisablePrecheck()
    return completed
  }

  return {
    warehouseDisableTarget,
    warehouseDisablePrecheck,
    requestChangeEnabled,
    confirmWarehouseDisable,
    closeWarehouseDisablePrecheck,
  }
}
