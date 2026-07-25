import { describe, expect, it } from 'vitest'
import { getBobEntityConfig } from '@/pages/bob/shared/config'

describe('product packaging contract', () => {
  it('产品始终提供 PR #11 包装字段与保存回读键', () => {
    const config = getBobEntityConfig('product')
    const form = config.emptyForm()
    const fields = config.fields({
      mode: 'create',
      referenceOptions: {},
      referenceLoading: {},
      referenceErrors: {},
    })
    const container = fields.find((field) => field.key === 'containerType')
    const quantity = fields.find((field) => field.key === 'quantityPerContainer')

    expect(form).toMatchObject({
      containerType: 'NONE',
      quantityPerContainer: '',
    })
    expect(config.detailKeys).toEqual(
      expect.arrayContaining(['containerType', 'quantityPerContainer']),
    )
    expect(config.persistedKeys).toEqual([
      'containerType',
      'quantityPerContainer',
    ])
    expect(
      container?.onChange?.('NONE', {
        ...form,
        quantityPerContainer: '180',
      }),
    ).toEqual({ quantityPerContainer: '' })
    expect(
      typeof quantity?.visible === 'function' &&
        quantity.visible({ ...form, containerType: 'SOLVENT' }),
    ).toBe(true)
    expect(
      typeof quantity?.visible === 'function' &&
        quantity.visible({ ...form, containerType: 'NONE' }),
    ).toBe(false)
  })
})
