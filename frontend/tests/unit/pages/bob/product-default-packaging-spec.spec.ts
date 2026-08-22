import { describe, expect, it } from 'vitest'
import { getBobEntityConfig } from '@/pages/bob/shared/config'

describe('product default packaging specification', () => {
  it('作为产品版本的单一正数维护', () => {
    const config = getBobEntityConfig('product')
    const form = config.emptyForm()
    const fields = config.fields({
      mode: 'create',
      referenceOptions: {},
      referenceLoading: {},
      referenceErrors: {},
    })
    const defaultPackagingSpec = fields.find(
      (field) => field.key === 'defaultPackagingSpec',
    )

    expect(form).toMatchObject({
      productTypeId: '',
      behaviorProfile: '',
      unitConversions: [],
      defaultPackagingSpec: '',
    })
    expect(config.detailKeys).toContain('defaultPackagingSpec')
    expect(
      typeof defaultPackagingSpec?.visible === 'function' &&
        defaultPackagingSpec.visible({
          ...form,
          behaviorProfile: 'RAW_MATERIAL',
        }),
    ).toBe(true)
    expect(
      typeof defaultPackagingSpec?.visible === 'function' &&
        defaultPackagingSpec.visible({
          ...form,
          behaviorProfile: 'PACKAGING',
        }),
    ).toBe(false)
    expect(defaultPackagingSpec?.rules?.[0]?.('0', form)).toBe(
      '默认包装规格必须为大于零且最多六位小数的数量。',
    )
    expect(defaultPackagingSpec?.rules?.[0]?.('0.000001', form)).toBe(true)
    expect(defaultPackagingSpec?.rules?.[0]?.('200', form)).toBe(true)
  })
})
