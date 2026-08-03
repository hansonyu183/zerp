import { watch, type Ref } from 'vue'
import { apiClient } from '@/api/client'
import type {
  VoucherDraftForm,
  VoucherEntityConfig,
  VoucherReference,
} from '@/components/voucher'
import { inputReference } from './form'

export function useVoucherPricing(
  config: VoucherEntityConfig,
  form: Ref<VoucherDraftForm>,
  changeBaseProduct: (
    index: number,
    product: VoucherReference | null,
  ) => Promise<void>,
  editing: Ref<boolean>,
  workspaceLoading: Ref<boolean>,
  onError: (error: unknown) => void,
) {
  const applies =
    config.entity === 'sale-order' || config.entity === 'purchase-order'

  async function loadPriceReferences(): Promise<void> {
    if (!applies) return
    const products = form.value.productLines.flatMap((line) =>
      line.product ? [inputReference(line.product)!] : [],
    )
    if (!products.length || !form.value.businessDate || !form.value.currency)
      return
    if (config.entity === 'purchase-order' && !form.value.supplier) return
    const { data } = await apiClient.postContract(
      `vou/${config.entity}/price-reference`,
      {
        businessDate: form.value.businessDate,
        currency: form.value.currency.trim().toUpperCase(),
        ...(form.value.supplier
          ? { supplier: inputReference(form.value.supplier) }
          : {}),
        products,
      },
    )
    const byProduct = new Map(
      data.lines.map((line) => [line.productObjectId, line]),
    )
    form.value.productLines = form.value.productLines.map((line) => {
      if (!line.product) return line
      const reference = byProduct.get(line.product.objectId)
      if (!reference) return line
      return {
        ...line,
        ...(!line.priceDirty ? { unitPrice: reference.unitPrice } : {}),
        referenceUnitPrice: reference.unitPrice,
        referenceDocumentId: reference.sourceDocumentId,
        referenceDocumentNo: reference.sourceDocumentNo,
        referenceBusinessDate: reference.sourceBusinessDate,
      }
    })
  }

  async function refreshPriceReferences(): Promise<void> {
    try {
      await loadPriceReferences()
    } catch (error) {
      onError(error)
    }
  }

  async function changeLineProduct(
    index: number,
    product: VoucherReference | null,
  ): Promise<void> {
    try {
      const line = form.value.productLines[index]
      if (line) {
        form.value.productLines[index] = {
          ...line,
          unitPrice: product ? '0.00' : '',
          referenceUnitPrice: product ? '0.00' : undefined,
          referenceDocumentId: undefined,
          referenceDocumentNo: undefined,
          referenceBusinessDate: undefined,
          priceDirty: false,
        }
      }
      await changeBaseProduct(index, product)
      await loadPriceReferences()
    } catch (error) {
      onError(error)
    }
  }

  watch(
    () => [form.value.businessDate, form.value.currency],
    (value, previous) => {
      if (
        !editing.value ||
        workspaceLoading.value ||
        (value[0] === previous?.[0] && value[1] === previous?.[1])
      )
        return
      void refreshPriceReferences()
    },
  )

  return { changeLineProduct, refreshPriceReferences }
}
