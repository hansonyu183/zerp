import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoucherDraftForm, VoucherReference } from '@/components/voucher'
import { useVoucherFormula } from '@/pages/vou/shared/formula'
import { emptyForm } from '@/pages/vou/shared/form'
import { voucherEntityConfigs } from '@/pages/vou/shared/config'

const mockedPost = vi.hoisted(() => vi.fn())

vi.mock('@/api/client', () => ({
  apiClient: { postContract: mockedPost },
}))

function reference(
  entity: string,
  suffix: string,
  behaviorProfile?: VoucherReference['behaviorProfile'],
): VoucherReference {
  return {
    objectId: `${suffix}-object`,
    approvalEntryId: `${suffix}-version`,
    entity,
    code: suffix.toUpperCase(),
    name: suffix,
    unit: 'kg',
    behaviorProfile,
  }
}

function formulaResponse(customer: string, quantity: string) {
  return {
    data: {
      sourceType: 'CUSTOMER_LATEST',
      sourceDocumentId: `${customer}-document`,
      sourceDocumentNo: `${customer}-number`,
      formula: {
        output: {
          enteredQuantity: '1.0',
          enteredUnit: { objectId: 'unit-kg', symbol: 'kg' },
          baseQuantity: '1.0',
        },
        components: [
          {
            material: reference('product', 'raw', 'RAW_MATERIAL'),
            quantity: {
              enteredQuantity: quantity,
              enteredUnit: { objectId: 'unit-kg', symbol: 'kg' },
              baseQuantity: quantity,
            },
          },
        ],
      },
    },
  }
}

describe('voucher formula requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('忽略客户切换前迟到的配方响应', async () => {
    const config = voucherEntityConfigs['sale-order']
    const form = ref<VoucherDraftForm>(emptyForm(config))
    form.value.customer = reference('customer', 'customer-a')
    form.value.productLines[0]!.product = reference(
      'product',
      'custom-product',
      'CUSTOM_FINISHED',
    )

    let resolveCustomerA!: (value: ReturnType<typeof formulaResponse>) => void
    let resolveCustomerB!: (value: ReturnType<typeof formulaResponse>) => void
    mockedPost
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCustomerA = resolve
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCustomerB = resolve
          }),
      )

    const formula = useVoucherFormula(config, form)
    const customerARequest = formula.resolveLineFormula(0)
    form.value.customer = reference('customer', 'customer-b')
    const customerBRequest = formula.resolveLineFormula(0)

    resolveCustomerB(formulaResponse('customer-b', '2.0'))
    await customerBRequest
    resolveCustomerA(formulaResponse('customer-a', '1.0'))
    await customerARequest

    expect(form.value.productLines[0]!.formula).toMatchObject({
      sourceDocumentId: 'customer-b-document',
      components: [{ quantity: { baseQuantity: '2.0' } }],
    })
    expect(form.value.productLines[0]!.formulaLoading).toBe(false)
  })
})
