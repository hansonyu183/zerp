import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoucherReference } from '@/components/voucher'
import { emptyForm } from '@/pages/vou/shared/form'
import { buildVoucherDraftPayload } from '@/pages/vou/shared/payload'
import {
  emptyProductionLine,
  productionLineFromFormula,
  productionSuggestedQuantity,
  recalculateProductionLine,
  useVoucherProduction,
} from '@/pages/vou/shared/production'
import { validateVoucherDraft } from '@/pages/vou/shared/validation'
import { voucherEntityConfigs } from '@/pages/vou/shared/config'

const mockedPost = vi.hoisted(() => vi.fn())

vi.mock('@/api/client', () => ({
  apiClient: { post: mockedPost },
}))

const product: VoucherReference = {
  objectId: 'product-1',
  versionId: 'product-version-1',
  entity: 'product',
  code: 'FG-001',
  name: '标准成品',
  productKind: 'STANDARD_FINISHED',
}
const material: VoucherReference = {
  objectId: 'material-1',
  versionId: 'material-version-1',
  entity: 'product',
  code: 'RM-001',
  name: '原材料',
  productKind: 'RAW_MATERIAL',
}
const warehouse: VoucherReference = {
  objectId: 'warehouse-1',
  versionId: 'warehouse-version-1',
  entity: 'warehouse',
  code: 'WH-001',
  name: '生产仓',
}

describe('production voucher helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rounds suggested material quantity half up to six decimals', () => {
    expect(productionSuggestedQuantity('1', '3', '1', '0')).toBe('0.333333')
    expect(productionSuggestedQuantity('1', '6', '1', '0')).toBe('0.166667')
    expect(productionSuggestedQuantity('2', '1', '10', '5')).toBe('21')
  })

  it('keeps a manually adjusted quantity when loss rate changes', () => {
    const line = productionLineFromFormula(product, '', '10', {
      baseOutputQuantity: '2',
      components: [{ material, quantity: '3' }],
    })
    expect(line.materials[0]?.actualQuantity).toBe('15')
    line.materials[0]!.actualQuantity = '14'
    line.lossRate = '10'
    recalculateProductionLine(line)
    expect(line.materials[0]?.suggestedQuantity).toBe('16.5')
    expect(line.materials[0]?.actualQuantity).toBe('14')
  })

  it('builds a non-monetary self-production payload', () => {
    const config = voucherEntityConfigs['self-production']
    const form = emptyForm(config)
    form.materialWarehouse = warehouse
    form.finishedWarehouse = warehouse
    form.productionLines = [
      productionLineFromFormula(product, '', '10', {
        baseOutputQuantity: '2',
        components: [{ material, quantity: '3' }],
      }),
    ]

    expect(validateVoucherDraft(config, form)).toBeNull()
    expect(buildVoucherDraftPayload(config, form, false, new Set())).toEqual({
      businessDate: form.businessDate,
      materialWarehouse: {
        objectId: warehouse.objectId,
        versionId: warehouse.versionId,
      },
      finishedWarehouse: {
        objectId: warehouse.objectId,
        versionId: warehouse.versionId,
      },
      productionLines: [
        {
          product: {
            objectId: product.objectId,
            versionId: product.versionId,
          },
          outputQuantity: '10',
          lossRate: '0',
          materials: [
            {
              formulaLineNo: 1,
              actualMaterial: {
                objectId: material.objectId,
                versionId: material.versionId,
              },
              actualQuantity: '15',
            },
          ],
        },
      ],
    })
  })

  it('requires a reason for changed material quantity', () => {
    const config = voucherEntityConfigs['self-production']
    const form = emptyForm(config)
    form.materialWarehouse = warehouse
    form.finishedWarehouse = warehouse
    const line = productionLineFromFormula(product, '', '10', {
      baseOutputQuantity: '2',
      components: [{ material, quantity: '3' }],
    })
    line.materials[0]!.actualQuantity = '14'
    form.productionLines = [line]
    expect(validateVoucherDraft(config, form)).toContain('必须说明原因')
  })

  it('ignores a stale formula failure while the latest request is pending', async () => {
    const config = voucherEntityConfigs['self-production']
    const form = ref(emptyForm(config))
    form.value.productionLines = [emptyProductionLine()]
    const newerProduct: VoucherReference = {
      ...product,
      objectId: 'product-2',
      versionId: 'product-version-2',
      code: 'FG-002',
      name: '新成品',
    }
    let rejectOld!: (reason?: unknown) => void
    let resolveNew!: (value: unknown) => void
    mockedPost
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOld = reject
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNew = resolve
          }),
      )

    const production = useVoucherProduction(config, form)
    const oldRequest = production.changeProductionProduct(0, product)
    const newRequest = production.changeProductionProduct(0, newerProduct)

    rejectOld(new Error('stale request failed'))
    await oldRequest
    expect(form.value.productionLines[0]).toMatchObject({
      product: newerProduct,
      formulaError: '',
      formulaLoading: true,
    })

    resolveNew({
      data: {
        formula: {
          baseOutputQuantity: '1',
          components: [{ material, quantity: '2' }],
        },
      },
    })
    await newRequest
    expect(form.value.productionLines[0]).toMatchObject({
      product: newerProduct,
      formulaError: '',
      formulaLoading: false,
      materials: [{ formulaQuantity: '2' }],
    })
  })
})
