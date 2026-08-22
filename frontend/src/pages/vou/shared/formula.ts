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
  const requestVersions = new Map<string, number>()

  function nextRequestVersion(lineKey: string): number {
    const version = (requestVersions.get(lineKey) ?? 0) + 1
    requestVersions.set(lineKey, version)
    return version
  }

  function currentRequestLine(
    index: number,
    lineKey: string,
    productKey: string,
    customerKey: string | null,
    requestVersion: number,
  ) {
    const current = form.value.productLines[index]
    const currentCustomer = form.value.customer
    const currentCustomerKey = currentCustomer
      ? `${currentCustomer.objectId}/${currentCustomer.versionId}`
      : ''
    if (
      !current?.product ||
      current.key !== lineKey ||
      `${current.product.objectId}/${current.product.versionId}` !==
        productKey ||
      (customerKey !== null && currentCustomerKey !== customerKey) ||
      requestVersions.get(lineKey) !== requestVersion
    ) {
      return null
    }
    return current
  }

  async function changeLineProduct(
    index: number,
    product: VoucherReference | null,
  ): Promise<void> {
    const line = form.value.productLines[index]
    if (!line) return
    nextRequestVersion(line.key)
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
    const requestVersion = nextRequestVersion(line.key)
    const lineKey = line.key
    const customer =
      product.behaviorProfile === 'CUSTOM_FINISHED' ? form.value.customer : null
    const customerKey =
      product.behaviorProfile === 'CUSTOM_FINISHED'
        ? customer
          ? `${customer.objectId}/${customer.versionId}`
          : ''
        : null
    const productKey = `${product.objectId}/${product.versionId}`
    if (product.behaviorProfile === 'PACKAGING') {
      line.formula = null
      line.formulaError = ''
      return
    }
    if (product.behaviorProfile === 'CUSTOM_FINISHED' && !form.value.customer) {
      line.formula = null
      line.formulaError = '请先选择客户。'
      return
    }
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
          product: { objectId: string }
        }
      >('vou/sale-order/formula-default', {
        ...(customer ? { customer: inputReference(customer) } : {}),
        product: { objectId: product.objectId },
      })
      const current = currentRequestLine(
        index,
        lineKey,
        productKey,
        customerKey,
        requestVersion,
      )
      if (!current) return
      const formula = formulaFromPayload(data.formula)
      if (formula) {
        formula.sourceType = data.sourceType
        formula.sourceDocumentId = data.sourceDocumentId
        formula.sourceDocumentNo = data.sourceDocumentNo
      }
      current.formula = formula
      current.formulaError =
        formula || product.behaviorProfile === 'RAW_MATERIAL'
          ? ''
          : '暂无历史配方，请手工维护。'
    } catch (error) {
      const current = currentRequestLine(
        index,
        lineKey,
        productKey,
        customerKey,
        requestVersion,
      )
      if (current) {
        current.formula = null
        current.formulaError = getErrorMessage(error)
      }
    } finally {
      const current = currentRequestLine(
        index,
        lineKey,
        productKey,
        customerKey,
        requestVersion,
      )
      if (current) current.formulaLoading = false
    }
  }

  async function refreshCustomFormulas(): Promise<void> {
    form.value.productLines = form.value.productLines.map((line) => ({
      ...line,
      settlementSurcharge: '',
      ...(line.product?.behaviorProfile === 'CUSTOM_FINISHED'
        ? { formula: null, formulaError: '' }
        : {}),
    }))
    await Promise.all(
      form.value.productLines.map((line, index) =>
        line.product?.behaviorProfile === 'CUSTOM_FINISHED'
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
