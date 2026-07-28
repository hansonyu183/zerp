import { describe, expect, it } from 'vitest'
import {
  packagingSpecsFromPayload,
  packagingSpecsPayload,
} from '@/components/packaging'
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
      packagingSpecs: [],
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

  it('包装规格在编辑模型与请求负载之间只保留契约字段', () => {
    const draft = packagingSpecsFromPayload([
      {
        packagingProductObjectId: 'PACKAGING-OBJECT',
        packagingProductVersionId: 'PACKAGING-VERSION',
        packagingProductCode: 'PAIL-20L',
        packagingProductName: '20L 包装桶',
        contentQuantity: '20.0',
        isDefault: true,
      },
    ])

    expect(draft[0]?.packagingProduct).toMatchObject({
      objectId: 'PACKAGING-OBJECT',
      code: 'PAIL-20L',
      name: '20L 包装桶',
    })
    expect(packagingSpecsPayload(draft)).toEqual([
      {
        packagingProductObjectId: 'PACKAGING-OBJECT',
        packagingProductVersionId: 'PACKAGING-VERSION',
        contentQuantity: '20.0',
        isDefault: true,
      },
    ])
  })
})
