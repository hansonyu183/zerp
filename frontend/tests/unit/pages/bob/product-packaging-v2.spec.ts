import { describe, expect, it } from 'vitest'
import { getBobEntityConfig } from '@/pages/bob/shared/config'

describe('product packaging contract', () => {
  it('产品提供类型、计价换算和包装物属性', () => {
    const config = getBobEntityConfig('product')
    const form = config.emptyForm()
    const fields = config.fields({
      mode: 'create',
      referenceOptions: {},
      referenceLoading: {},
      referenceErrors: {},
    })
    const productKind = fields.find((field) => field.key === 'productKind')
    const conversion = fields.find(
      (field) => field.key === 'pricingQuantityPerInventoryUnit',
    )
    const returnable = fields.find((field) => field.key === 'returnable')

    expect(form).toMatchObject({
      productKind: 'RAW_MATERIAL',
      pricingQuantityPerInventoryUnit: '1',
      returnable: false,
      packagingSpecs: [],
    })
    expect(config.detailKeys).toEqual(
      expect.arrayContaining([
        'productKind',
        'inventoryUnitId',
        'pricingUnitId',
        'pricingQuantityPerInventoryUnit',
        'returnable',
        'packagingSpecs',
      ]),
    )
    expect(productKind?.onChange?.('PACKAGING', form)).toEqual({
      formula: null,
      pricingUnitId: '',
      pricingQuantityPerInventoryUnit: '1',
    })
    expect(
      typeof conversion?.visible === 'function' &&
        conversion.visible({ ...form, productKind: 'RAW_MATERIAL' }),
    ).toBe(true)
    expect(
      typeof conversion?.visible === 'function' &&
        conversion.visible({ ...form, productKind: 'PACKAGING' }),
    ).toBe(false)
    expect(
      typeof returnable?.visible === 'function' &&
        returnable.visible({ ...form, productKind: 'PACKAGING' }),
    ).toBe(true)
  })
})
