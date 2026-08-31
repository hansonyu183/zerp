import { ref, type Ref } from 'vue'
import type { components } from '@/api/generated/schema'
import { ApiError } from '@/api/types'
import { approvalStatusPresentation } from '@/shared/approval'
import type { DclWarehouseListItem } from './types'

type WarehouseDisableBlockers =
  components['schemas']['DclWarehouseDisableBlockers']
type WarehouseDocumentConflict =
  components['schemas']['DclWarehouseDocumentConflict']

const warehouseDocumentEntityTitles: Record<
  WarehouseDocumentConflict['entity'],
  string
> = {
  'sale-pricing': '销售报价单',
  'sale-order': '销售订单',
  'sale-outbound': '销售出库单',
  'sale-delivery': '销售发货单',
  'sale-signoff': '销售签收单',
  'sale-return': '销售退货单',
  'purchase-order': '采购订单',
  'purchase-inbound': '采购入库单',
  'purchase-return': '采购退货单',
  'purchase-inquiry': '采购询价单',
  'order-production': '订单生产单',
  'self-production': '自制生产单',
  'inventory-count': '库存盘点单',
  'sales-receipt': '销售收款单',
  'purchase-refund': '采购退款单',
  'other-receipt': '其他收款单',
  'sales-refund': '销售退款单',
  'purchase-payment': '采购付款单',
  'other-payment': '其他付款单',
  'employee-loan': '员工借款单',
  'employee-repayment': '员工还款单',
  'employee-loan-writeoff': '员工借款核销单',
  'expense-reimbursement': '费用报销单',
  'expense-payment': '费用付款单',
  'other-income': '其他收入单',
  'asset-acquisition': '资产购置单',
  'asset-sale': '资产处置单',
  'asset-liquidation': '资产清算单',
  'bill-receipt': '收票单',
  'bill-payment': '付票单',
  'bill-issue': '开票单',
  'bill-discount': '票据贴现单',
  'bill-maturity': '票据到期单',
  'intermediary-calculation': '中间计算单',
  'service-contract': '服务合同',
  'service-acceptance': '服务验收单',
}

export function warehouseDocumentEntityLabel(
  entity: WarehouseDocumentConflict['entity'],
): string {
  return warehouseDocumentEntityTitles[entity]
}

export function warehouseDocumentStatusLabel(
  status?: WarehouseDocumentConflict['status'],
): string {
  return status ? approvalStatusPresentation[status].label : '未知状态'
}

export function warehouseDisableBlockersFromError(
  error: unknown,
): WarehouseDisableBlockers | null {
  if (
    !(error instanceof ApiError) ||
    error.kind !== 'business' ||
    error.errorKey !== 'warehouse_disable_blocked'
  )
    return null
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
  canDisable: (row: Readonly<DclWarehouseListItem>) => boolean,
  changeEnabled: (row: DclWarehouseListItem) => Promise<boolean>,
) {
  const warehouseDisableTarget = ref<DclWarehouseListItem | null>(null)
  const warehouseDisableBlockers = ref<WarehouseDisableBlockers | null>(null)

  function closeWarehouseDisableDialog(): void {
    warehouseDisableTarget.value = null
    warehouseDisableBlockers.value = null
  }

  async function requestChangeEnabled(
    row: DclWarehouseListItem,
  ): Promise<boolean> {
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
    const completed = await changeEnabled(target)
    if (completed) closeWarehouseDisableDialog()
    return completed
  }

  function handleWarehouseDisableApprovalError(
    row: Readonly<DclWarehouseListItem>,
    error: unknown,
  ): boolean {
    if (!row.openVersion || row.openVersion.enabled) return false
    const blockers = warehouseDisableBlockersFromError(error)
    if (!blockers) return false
    warehouseDisableTarget.value = row
    warehouseDisableBlockers.value = blockers
    return true
  }

  return {
    warehouseDisableTarget,
    warehouseDisableBlockers,
    requestChangeEnabled,
    confirmWarehouseDisable,
    handleWarehouseDisableApprovalError,
    closeWarehouseDisableDialog,
  }
}
