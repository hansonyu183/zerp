import { describe, expect, it } from 'vitest'
import { comparableProductValue } from '@/pages/bob/shared/product-data'

describe('comparableProductValue', () => {
  it('treats product unit conversions as an order-independent numeric map', () => {
    const draft = [
      { unit: { objectId: 'unit-ton' }, factor: '1000.000000' },
      { unit: { objectId: 'unit-kg' }, factor: '1' },
    ]
    const persisted = [
      { unit: { objectId: 'unit-kg', name: '千克' }, factor: '1.000000' },
      { unit: { objectId: 'unit-ton', name: '吨' }, factor: '1000' },
    ]

    expect(comparableProductValue('unitConversions', persisted, true)).toEqual(
      comparableProductValue('unitConversions', draft, false),
    )
  })

  it('normalizes persisted product and formula quantities', () => {
    const formula = {
      output: {
        enteredQuantity: '1.0',
        enteredUnit: { objectId: 'unit-kg' },
        baseQuantity: '1.000000',
      },
      components: [
        {
          key: 'ignored',
          material: {
            objectId: 'material-1',
            versionId: 'version-1',
            code: 'P-1',
            name: '原料',
          },
          quantity: {
            enteredQuantity: '2.000000',
            enteredUnit: { objectId: 'unit-kg' },
            baseQuantity: '2.0',
          },
          resolutionStatus: 'CURRENT' as const,
          requiresConfirmation: false,
        },
      ],
    }

    expect(comparableProductValue('defaultPackagingSpec', '25.0', true)).toBe(
      '25',
    )
    expect(comparableProductValue('formula', formula, true)).toEqual(
      comparableProductValue(
        'formula',
        {
          ...formula,
          output: {
            ...formula.output,
            enteredQuantity: '1',
            baseQuantity: '1',
          },
          components: [
            {
              ...formula.components[0],
              quantity: {
                ...formula.components[0].quantity,
                enteredQuantity: '2',
                baseQuantity: '2',
              },
            },
          ],
        },
        false,
      ),
    )
  })
})
