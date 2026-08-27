import { describe, expect, it } from 'vitest'
import {
  dclProductFormFields,
  dclProductInput,
  suggestBaseQuantity,
  validateDclProductConfiguration,
} from '@/pages/dcl/product/product-data'
import { dclProductConfig } from '@/pages/dcl/product/config'
import { dclProductSaveData } from '@/pages/dcl/product/data'

describe('DCL product target data model', () => {
  it('serializes unit references without client-authored snapshots', () => {
    expect(
      dclProductInput(
        {
          behaviorProfile: 'RAW_MATERIAL',
          unitConversions: [
            {
              unit: {
                objectId: 'UNIT-KG',
                approvalEntryId: 'VERSION-KG',
                code: 'KG',
                name: '千克',
                symbol: 'kg',
              },
              factor: '1',
            },
          ],
          formula: null,
        },
        'create',
      ),
    ).toEqual({
      name: '',
      productTypeId: null,
      defaultInputUnitId: null,
      pricingUnitId: null,
      unitConversions: [{ unit: { objectId: 'UNIT-KG' }, factor: '1' }],
      returnable: false,
      categoryId: null,
      specification: null,
      model: null,
      barcode: null,
      remark: null,
      defaultPackagingSpec: null,
      formula: null,
    })
  })

  it('keeps authoritative snapshots returned by the server', () => {
    const source = {
      unitConversions: [
        {
          unit: {
            objectId: 'UNIT-TON',
            approvalEntryId: 'VERSION-TON',
            code: 'TON',
            name: '吨',
            symbol: 't',
          },
          factor: '1000',
        },
      ],
      formula: null,
    }
    expect(dclProductFormFields(source).unitConversions).toEqual(
      source.unitConversions,
    )
  })

  it('suggests base quantity with decimal arithmetic', () => {
    expect(suggestBaseQuantity('1.25', '1000')).toBe('1250')
    expect(suggestBaseQuantity('0.333333', '3')).toBe('0.999999')
    expect(suggestBaseQuantity('', '3')).toBe('')
  })

  it('sends an untouched fixed formula in the complete DCL save snapshot', () => {
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
            approvalEntryId: 'MAT-V1',
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
    const form = {
      ...dclProductConfig.emptyForm(),
      name: '成品',
      formula,
    }

    expect(dclProductSaveData(form)).toHaveProperty(
      'formula.components.0.material.objectId',
      'MAT-1',
    )
  })

  it('checks completeness only at lifecycle boundaries', () => {
    expect(
      validateDclProductConfiguration({
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
      validateDclProductConfiguration({
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
