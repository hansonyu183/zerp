import type { Ref } from 'vue'
import { apiClient } from '@/api/client'
import { getErrorMessage } from '@/api/types'
import {
  formulaFromPayload,
  type ProductFormulaDraft,
} from '@/components/formula'
import type {
  VoucherDraftForm,
  VoucherEntityConfig,
  VoucherReference,
} from '@/components/voucher'
import { inputReference } from './form'

export function useVoucherFormula(
  config: VoucherEntityConfig,
  form: Ref<VoucherDraftForm>,
) {
  async function changeLineProduct(
    index: number,
    product: VoucherReference | null,
  ): Promise<void> {
    const line = form.value.productLines[index]
    if (!line) return
    form.value.productLines[index] = {
      ...line,
      product,
      formula: null,
      formulaError: '',
      formulaLoading: false,
    }
    if (product) await resolveLineFormula(index)
  }

  async function resolveLineFormula(index: number): Promise<void> {
    if (config.entity !== 'sale-order') return
    const line = form.value.productLines[index]
    const product = line?.product
    if (!line || !product) return
    if (product.productKind === 'PACKAGING') {
      line.formula = null
      line.formulaError = ''
      return
    }
    if (product.productKind === 'CUSTOM_FINISHED' && !form.value.customer) {
      line.formula = null
      line.formulaError = '请先选择客户。'
      return
    }
    const productKey = `${product.objectId}/${product.versionId}`
    line.formulaLoading = true
    line.formulaError = ''
    try {
      const { data } = await apiClient.post<
        {
          sourceType: string
          sourceDocumentId?: string
          sourceDocumentNo?: string
          formula?: Parameters<typeof formulaFromPayload>[0]
        },
        {
          customer?: { objectId: string; versionId: string }
          product: { objectId: string; versionId: string }
        }
      >('vou/sale-order/formula-default', {
        ...(form.value.customer
          ? { customer: inputReference(form.value.customer) }
          : {}),
        product: inputReference(product)!,
      })
      const current = form.value.productLines[index]
      if (
        !current?.product ||
        `${current.product.objectId}/${current.product.versionId}` !==
          productKey
      )
        return
      const formula = formulaFromPayload(data.formula)
      if (formula) {
        formula.sourceType = data.sourceType
        formula.sourceDocumentId = data.sourceDocumentId
        formula.sourceDocumentNo = data.sourceDocumentNo
      }
      current.formula = formula
      current.formulaError =
        formula || product.productKind === 'RAW_MATERIAL'
          ? ''
          : '暂无历史配方，请手工维护。'
    } catch (error) {
      const current = form.value.productLines[index]
      if (current) {
        current.formula = null
        current.formulaError = getErrorMessage(error)
      }
    } finally {
      const current = form.value.productLines[index]
      if (current) current.formulaLoading = false
    }
  }

  async function refreshCustomFormulas(): Promise<void> {
    form.value.productLines = form.value.productLines.map((line) => ({
      ...line,
      settlementSurcharge: '',
      ...(line.product?.productKind === 'CUSTOM_FINISHED'
        ? { formula: null, formulaError: '' }
        : {}),
    }))
    await Promise.all(
      form.value.productLines.map((line, index) =>
        line.product?.productKind === 'CUSTOM_FINISHED'
          ? resolveLineFormula(index)
          : Promise.resolve(),
      ),
    )
  }

  function updateLineFormula(
    index: number,
    formula: ProductFormulaDraft,
  ): void {
    const line = form.value.productLines[index]
    if (!line) return
    line.formula = formula
    line.formulaError = ''
  }

  return {
    changeLineProduct,
    resolveLineFormula,
    refreshCustomFormulas,
    updateLineFormula,
  }
}
