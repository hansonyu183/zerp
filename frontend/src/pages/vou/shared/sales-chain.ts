import { ref, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage, type PageRequest, type PageResult } from '@/api/types'
import {
  parseFixed,
  type VoucherDocumentView,
  type VoucherDraftForm,
  type VoucherEntityConfig,
  type VoucherListItem,
} from '@/components/voucher'
import type { DraftPayload } from './form'

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
    if (!config.sourceEntity) return
    const sequence = ++sourceSequence
    sourceLoading.value = true
    sourceError.value = null
    try {
      const { data } = await apiClient.post<
        PageResult<VoucherListItem>,
        PageRequest
      >(`vou/${config.sourceEntity}/query`, {
        page: 1,
        pageSize: 50,
        filters: {
          status: ['FINALIZED'],
          ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        },
        sort: [{ field: 'updatedAt', order: 'desc' }],
      })
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
    form.value.sourceDocumentId = documentId ?? ''
    form.value.sourceDocumentNo =
      sourceOptions.value.find((item) => item.documentId === documentId)
        ?.documentNo ?? ''
    form.value.salesChainLines = []
    if (!documentId || !config.sourceEntity) return
    sourceLoading.value = true
    sourceError.value = null
    try {
      const { data } = await apiClient.post<
        VoucherDocumentView,
        { documentId: string }
      >(`vou/${config.sourceEntity}/get`, { documentId })
      form.value.currency = data.data.currency
      if (config.entity === 'sale-outbound') {
        form.value.salesChainLines = (data.data.productLines ?? [])
          .filter(
            (line) =>
              parseFixed(
                line.availableQuantity ?? line.orderedQuantity,
                6,
                true,
              ) !== 0n,
          )
          .map((line) => ({
            key: line.lineId,
            sourceLineId: line.lineId,
            productCode: line.product.code,
            productName: line.product.name,
            productUnit: line.product.unit ?? '',
            availableQuantity: line.availableQuantity ?? line.orderedQuantity,
            outboundQuantity: '',
            quantity: line.availableQuantity ?? line.orderedQuantity,
            signedQuantity: '',
            rejectedQuantity: '',
            lossQuantity: '',
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
            productUnit: line.product.unit ?? '',
            availableQuantity: '',
            outboundQuantity: line.quantity ?? line.orderedQuantity,
            quantity: '',
            signedQuantity: line.quantity ?? line.orderedQuantity,
            rejectedQuantity: '0',
            lossQuantity: '0',
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
  if (config.sourceEntity && !value.sourceDocumentId) return '请选择来源单据。'
  if (
    config.entity === 'sale-delivery' &&
    (!value.platform || !value.vehicle)
  ) {
    return '请选择物流平台和车辆。'
  }
  if (config.entity === 'sale-outbound') {
    if (value.salesChainLines.length < 1) return '请至少填写一行出库数量。'
    for (const line of value.salesChainLines) {
      const quantity = parseFixed(line.quantity, 6)
      const available = parseFixed(line.availableQuantity, 6, true)
      if (quantity === null || available === null || quantity > available) {
        return '出库数量必须大于零且不能超过可出库数量。'
      }
    }
  }
  if (config.entity === 'sale-signoff') {
    if (value.salesChainLines.length < 1) return '签收单必须包含全部配送明细。'
    for (const line of value.salesChainLines) {
      const outbound = parseFixed(line.outboundQuantity, 6)
      const signed = parseFixed(line.signedQuantity, 6, true)
      const rejected = parseFixed(line.rejectedQuantity, 6, true)
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
  if (config.sourceEntity) payload.sourceDocumentId = value.sourceDocumentId
  if (config.entity === 'sale-outbound') {
    payload.sourceLines = value.salesChainLines.map((line) => ({
      sourceLineId: line.sourceLineId,
      quantity: line.quantity.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
  if (config.entity === 'sale-signoff') {
    payload.signoffLines = value.salesChainLines.map((line) => ({
      sourceLineId: line.sourceLineId,
      signedQuantity: line.signedQuantity.trim(),
      rejectedQuantity: line.rejectedQuantity.trim(),
      ...(line.remark.trim() ? { remark: line.remark.trim() } : {}),
    }))
  }
}
