import { ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import {
  parseFixed,
  type VoucherDraftForm,
  type VoucherEntityConfig,
  type VoucherListItem,
} from '@/components/voucher'
import type { DraftPayload } from './form'
import { productionLineFromOrderLine } from './production'

export function useVoucherSalesChain(
  config: VoucherEntityConfig,
  form: Ref<VoucherDraftForm>,
) {
  const sourceOptions = ref<VoucherListItem[]>([])
  const sourceLoading = ref(false)
  const sourceError = ref<string | null>(null)
  let sourceSequence = 0

  function clearSourceDocuments(): void {
    sourceSequence += 1
    sourceOptions.value = []
    sourceError.value = null
  }

  async function searchSourceDocuments(keyword: string): Promise<void> {
    if (!config.parentEntity) return
    const sequence = ++sourceSequence
    sourceLoading.value = true
    sourceError.value = null
    try {
      const { data } = await apiClient.postContract(
        `vou/${config.parentEntity}/query`,
        {
          page: 1,
          pageSize: 50,
          filters: {
            status: ['APPROVED'],
            ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
          },
          sort: [{ field: 'updatedAt', order: 'desc' }],
        },
      )
      if (sequence === sourceSequence) sourceOptions.value = data.items ?? []
    } catch (error) {
      if (sequence === sourceSequence)
        sourceError.value = getErrorMessage(error)
    } finally {
      if (sequence === sourceSequence) sourceLoading.value = false
    }
  }

  async function selectSourceDocument(
    documentId: string | null,
  ): Promise<void> {
    form.value.parentDocumentId = documentId ?? ''
    form.value.parentDocumentNo =
      sourceOptions.value.find((item) => item.documentId === documentId)
        ?.documentNo ?? ''
    form.value.salesChainLines = []
    if (config.productionMode === 'order') form.value.productionLines = []
    if (!documentId || !config.parentEntity) return
    sourceLoading.value = true
    sourceError.value = null
    try {
      const { data } = await apiClient.postContract(`vou/${config.parentEntity}/get`, { documentId })
      form.value.currency = data.data.currency
      if (config.productionMode === 'order') {
        form.value.productionLines = (data.data.productLines ?? []).flatMap(
          (line) => {
            const productionLine = productionLineFromOrderLine(line)
            return productionLine ? [productionLine] : []
          },
        )
      }
      if (config.entity === 'sale-outbound') {
        form.value.salesChainLines = (data.data.productLines ?? [])
          .filter(
            (line) =>
              parseFixed(
                line.availableBaseQuantity ?? line.baseQuantity,
                6,
                true,
              ) !== 0n,
          )
          .map((line) => ({
            key: line.lineId,
            sourceLineId: line.lineId,
            productCode: line.product.code,
            productName: line.product.name,
            enteredUnitSymbol: line.enteredUnit.symbol ?? '',
            availableBaseQuantity:
              line.availableBaseQuantity ?? line.baseQuantity,
            outboundBaseQuantity: '',
            baseQuantity: line.availableBaseQuantity ?? line.baseQuantity,
            signedBaseQuantity: '',
            rejectedBaseQuantity: '',
            lossBaseQuantity: '',
            remark: '',
          }))
      }
      if (config.entity === 'sale-signoff') {
        form.value.salesChainLines = (data.data.productLines ?? []).map(
          (line) => ({
            key: line.lineId,
            sourceLineId: line.lineId,
            productCode: line.product.code,
            productName: line.product.name,
            enteredUnitSymbol: line.enteredUnit.symbol ?? '',
            availableBaseQuantity: '',
            outboundBaseQuantity: line.baseQuantity,
            baseQuantity: '',
            signedBaseQuantity: line.baseQuantity,
            rejectedBaseQuantity: '0',
            lossBaseQuantity: '0',
            remark: '',
          }),
        )
      }
    } catch (error) {
      sourceError.value = getErrorMessage(error)
    } finally {
      sourceLoading.value = false
    }
  }

  return {
    sourceOptions,
    sourceLoading,
    sourceError,
    clearSourceDocuments,
    searchSourceDocuments,
    selectSourceDocument,
  }
}

export function validateSalesChainDraft(
  config: VoucherEntityConfig,
  value: VoucherDraftForm,
): string | null {
  if (config.parentEntity && !value.parentDocumentId) return '请选择来源单据。'
  if (config.entity === 'sale-delivery' && !value.vehicle) {
    return '请选择配送车辆。'
  }
  if (
    config.entity === 'sale-delivery' &&
    value.vehicle?.carrierAffiliation?.type === 'EXTERNAL' &&
    (!value.carrier ||
      value.carrier.objectId !==
        value.vehicle.carrierAffiliation.serviceRelationshipObjectId)
  ) {
    return '请选择与配送车辆一致的外部承运方。'
  }
  if (config.entity === 'sale-outbound') {
    if (value.salesChainLines.length < 1) return '请至少填写一行出库数量。'
    for (const line of value.salesChainLines) {
      const quantity = parseFixed(line.baseQuantity, 6)
      const available = parseFixed(line.availableBaseQuantity, 6, true)
      if (quantity === null || available === null || quantity > available) {
        return '出库数量必须大于零且不能超过可出库数量。'
      }
    }
  }
  if (config.entity === 'sale-signoff') {
    if (value.salesChainLines.length < 1) return '签收单必须包含全部配送明细。'
    for (const line of value.salesChainLines) {
      const outbound = parseFixed(line.outboundBaseQuantity, 6)
      const signed = parseFixed(line.signedBaseQuantity, 6, true)
      const rejected = parseFixed(line.rejectedBaseQuantity, 6, true)
      if (
        outbound === null ||
        signed === null ||
        rejected === null ||
        signed + rejected > outbound
      ) {
        return '签收与拒收数量必须有效，且合计不能超过配送数量。'
      }
    }
  }
  return null
}

export function appendSalesChainPayload(
  config: VoucherEntityConfig,
  value: VoucherDraftForm,
  payload: DraftPayload,
): void {
  if (config.entity === 'sale-outbound') {
    payload.sourceLines = value.salesChainLines.map((line) => ({
      sourceLineId: line.sourceLineId,
      baseQuantity: line.baseQuantity.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  if (config.entity === 'sale-signoff') {
    payload.signoffLines = value.salesChainLines.map((line) => ({
      sourceLineId: line.sourceLineId,
      signedBaseQuantity: line.signedBaseQuantity.trim(),
      rejectedBaseQuantity: line.rejectedBaseQuantity.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
}
