import { ref, type Ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { ApiError } from '@/api/types'
import { voucherStatusLabels } from '@/components/voucher/status'
import { voucherEntityConfigs } from '@/pages/vou/shared/config'
import type { BobListItem } from '../shared/types'

type WarehouseDisableBlockers =
  components['schemas']['WarehouseDisableBlockers']
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

export function warehouseDisableBlockersFromError(
  error: unknown,
): WarehouseDisableBlockers | null {
  if (!(error instanceof ApiError) || error.kind !== 'business') return null
  const details = error.details
  if (
    typeof details !== 'object' ||
    details === null ||
    !('inventory' in details) ||
    !Array.isArray(details.inventory) ||
    !('documents' in details) ||
    !Array.isArray(details.documents) ||
    !('sources' in details) ||
    !Array.isArray(details.sources) ||
    !('references' in details) ||
    !Array.isArray(details.references)
  ) {
    return null
  }
  return details as WarehouseDisableBlockers
}

export function useWarehouseDisable(
  actionLoading: Ref<string | null>,
  errorMessage: Ref<string | null>,
  canDisable: (row: Readonly<BobListItem>) => boolean,
  changeEnabled: (
    row: BobListItem,
    handleError?: (error: unknown) => boolean,
  ) => Promise<boolean>,
) {
  const warehouseDisableTarget = ref<BobListItem | null>(null)
  const warehouseDisableBlockers = ref<WarehouseDisableBlockers | null>(null)

  function closeWarehouseDisableDialog(): void {
    warehouseDisableTarget.value = null
    warehouseDisableBlockers.value = null
  }

  async function requestChangeEnabled(row: BobListItem): Promise<boolean> {
    if (!row.enabled) {
      return changeEnabled(row)
    }
    if (!canDisable(row) || actionLoading.value) return false
    errorMessage.value = null
    warehouseDisableTarget.value = row
    warehouseDisableBlockers.value = null
    return false
  }

  async function confirmWarehouseDisable(): Promise<boolean> {
    const target = warehouseDisableTarget.value
    if (!target || warehouseDisableBlockers.value) return false
    const completed = await changeEnabled(target, (error) => {
      const blockers = warehouseDisableBlockersFromError(error)
      if (!blockers) return false
      warehouseDisableBlockers.value = blockers
      return true
    })
    if (completed) closeWarehouseDisableDialog()
    return completed
  }

  return {
    warehouseDisableTarget,
    warehouseDisableBlockers,
    requestChangeEnabled,
    confirmWarehouseDisable,
    closeWarehouseDisableDialog,
  }
}
