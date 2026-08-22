import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import type {
  VoucherDocumentView,
  VoucherDraftForm,
  VoucherEntity,
} from '@/components/voucher'

type ReturnEntity = Extract<VoucherEntity, 'sale-return' | 'purchase-return'>
type ReturnDraft = Pick<
  VoucherDraftForm,
  'returnKind' | 'warehouse' | 'salesChainLines'
>

export function createReturnSourceInitializer(options: {
  entity: VoucherEntity
  canCreate: () => boolean
  openCreate: () => void
  applyDraft: (draft: ReturnDraft) => void
  setLoading: (loading: boolean) => void
  setError: (message: string) => void
}): (sourceDocumentIds: readonly string[]) => Promise<void> {
  return async (sourceDocumentIds) => {
    if (
      (options.entity !== 'sale-return' &&
        options.entity !== 'purchase-return') ||
      sourceDocumentIds.length === 0 ||
      !options.canCreate()
    ) {
      return
    }
    options.openCreate()
    options.setLoading(true)
    try {
      options.applyDraft(
        await buildReturnDraftFromSources(options.entity, sourceDocumentIds),
      )
    } catch (error) {
      options.setError(getErrorMessage(error))
    } finally {
      options.setLoading(false)
    }
  }
}

export async function buildReturnDraftFromSources(
  entity: ReturnEntity,
  sourceDocumentIds: readonly string[],
): Promise<ReturnDraft> {
  const sources = await Promise.all(
    sourceDocumentIds.map(async (documentId) => {
      const response = await apiClient.post<
        VoucherDocumentView,
        { documentId: string }
      >(
        entity === 'sale-return'
          ? 'vou/sale-signoff/get'
          : 'vou/purchase-inbound/get',
        { documentId },
      )
      return response.data
    }),
  )

  return {
    returnKind: entity === 'sale-return' ? 'AFTER_SALE' : '',
    warehouse: sources[0]?.data.warehouse
      ? { ...sources[0].data.warehouse }
      : null,
    salesChainLines: sources.flatMap((source) =>
      (entity === 'sale-return'
        ? (source.data.signoffLines ?? [])
        : (source.data.productLines ?? [])
      )
        .filter(
          (line) =>
            Number(
              'signedBaseQuantity' in line
                ? (line.returnableBaseQuantity ?? line.signedBaseQuantity ?? '')
                : (line.returnableBaseQuantity ?? line.baseQuantity),
            ) > 0,
        )
        .map((line) => ({
          key: crypto.randomUUID(),
          sourceLineId: line.lineId,
          productCode: line.product.code,
          productName: line.product.name,
          enteredUnitSymbol: line.enteredUnit.symbol ?? '',
          availableBaseQuantity: String(
            line.returnableBaseQuantity ??
              ('signedBaseQuantity' in line
                ? line.signedBaseQuantity
                : line.baseQuantity) ??
              '',
          ),
          outboundBaseQuantity: '',
          baseQuantity: String(
            line.returnableBaseQuantity ??
              ('signedBaseQuantity' in line
                ? line.signedBaseQuantity
                : line.baseQuantity) ??
              '',
          ),
          signedBaseQuantity: '',
          rejectedBaseQuantity: '',
          lossBaseQuantity: '',
          remark: '',
        })),
    ),
  }
}
