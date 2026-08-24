import { ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import type { components } from '@/api/generated/schema'
import { getErrorMessage } from '@/api/types'
import { voucherStatusLabels } from '@/components/voucher/status'
import { voucherEntityConfigs } from '@/pages/vou/shared/config'
import type { BobListItem } from '../shared/types'

type WarehouseDisablePrecheck =
  components['schemas']['WarehouseDisablePrecheckResult']
type WarehouseDocumentConflict =
  components['schemas']['WarehouseDocumentConflict']

export function warehouseDocumentEntityLabel(
  entity: WarehouseDocumentConflict['entity'],
): string {
  return voucherEntityConfigs[entity].title
}

export function warehouseDocumentStatusLabel(
  status?: WarehouseDocumentConflict['status'],
): string {
  return status ? voucherStatusLabels[status] : '未知状态'
}

export function useWarehouseDisable(
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

  async function requestChangeEnabled(row: BobListItem): Promise<boolean> {
    if (!row.enabled) {
      return changeEnabled(row)
    }
    if (!canDisable(row) || actionLoading.value) return false
    actionLoading.value = `disable-precheck:${row.objectId}`
    errorMessage.value = null
    try {
      const response = await apiClient.post<
        WarehouseDisablePrecheck,
        { objectId: string }
      >('bob/warehouse/disable-precheck', { objectId: row.objectId })
      warehouseDisableTarget.value = row
      warehouseDisablePrecheck.value = response.data
      return false
    } catch (error) {
      errorMessage.value = getErrorMessage(error)
      return false
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
