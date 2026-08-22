import { describe, expect, it } from 'vitest'
import {
  comparableProductValue,
  productFormFields,
  productPayload,
  suggestBaseQuantity,
  validateProductConfiguration,
} from '@/pages/bob/shared/product-data'
import { bobSaveData } from '@/pages/bob/shared/form-data'
import { getBobEntityConfig } from '@/pages/bob/shared/config'

describe('product target data model', () => {
  it('serializes unit references without client-authored snapshots', () => {
    expect(
      productPayload({
        behaviorProfile: 'RAW_MATERIAL',
        unitConversions: [
          {
            unit: {
              objectId: 'UNIT-KG',
              versionId: 'VERSION-KG',
              code: 'KG',
              name: '千克',
              symbol: 'kg',
            },
            factor: '1',
          },
        ],
        formula: null,
      }),
    ).toEqual({
      unitConversions: [{ unit: { objectId: 'UNIT-KG' }, factor: '1' }],
      formula: undefined,
    })
  })

  it('keeps authoritative snapshots returned by the server', () => {
    const source = {
      unitConversions: [
        {
          unit: {
            objectId: 'UNIT-TON',
            versionId: 'VERSION-TON',
            code: 'TON',
            name: '吨',
            symbol: 't',
          },
          factor: '1000',
        },
      ],
      formula: null,
    }
    expect(productFormFields(source).unitConversions).toEqual(
      source.unitConversions,
    )
    expect(
      comparableProductValue('unitConversions', source.unitConversions, true),
    ).toEqual([{ unit: { objectId: 'UNIT-TON' }, factor: '1000' }])
  })

  it('suggests base quantity with decimal arithmetic', () => {
    expect(suggestBaseQuantity('1.25', '1000')).toBe('1250')
    expect(suggestBaseQuantity('0.333333', '3')).toBe('0.999999')
    expect(suggestBaseQuantity('', '3')).toBe('')
  })

  it('omits an untouched formula so effective-version save can refresh its candidate', () => {
    const formula = {
      output: {
        enteredQuantity: '1',
        enteredUnit: { objectId: 'UNIT-KG' },
        baseQuantity: '1',
      },
      components: [
        {
          key: 'LINE-1',
          material: {
            objectId: 'MAT-1',
            versionId: 'MAT-V1',
            code: 'MAT-1',
            name: '原料',
          },
          quantity: {
            enteredQuantity: '1',
            enteredUnit: { objectId: 'UNIT-KG' },
            baseQuantity: '1',
          },
          resolutionStatus: 'CURRENT' as const,
          requiresConfirmation: false,
        },
      ],
    }
    const config = getBobEntityConfig('product')
    const form = { ...config.emptyForm(), name: '成品', formula }

    expect(bobSaveData(config, form)).not.toHaveProperty('formula')
    expect(bobSaveData(config, { ...form, formulaDirty: true })).toHaveProperty(
      'formula.components.0.material.objectId',
      'MAT-1',
    )
  })

  it('checks completeness only at lifecycle boundaries', () => {
    expect(
      validateProductConfiguration({
        productTypeId: '',
        behaviorProfile: '',
        unitConversions: [],
        defaultInputUnitId: '',
        pricingUnitId: '',
        defaultPackagingSpec: '',
        formula: null,
      }),
    ).toEqual([
      '请选择产品类型。',
      '请至少维护一项单位换算。',
      '请选择默认录入单位。',
      '请选择计价单位。',
    ])

    expect(
      validateProductConfiguration({
        productTypeId: 'TYPE-PACKAGING',
        behaviorProfile: 'PACKAGING',
        unitConversions: [{ unit: { objectId: 'UNIT-PIECE' }, factor: '1' }],
        defaultInputUnitId: 'UNIT-PIECE',
        pricingUnitId: 'UNIT-PIECE',
        defaultPackagingSpec: '1',
        formula: null,
      }),
    ).toContain('包装物不能设置默认包装规格。')
  })
})
