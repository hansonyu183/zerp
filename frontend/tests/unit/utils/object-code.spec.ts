import { describe, expect, it } from 'vitest'
import { generateObjectCode } from '@/utils/object-code'

describe('generateObjectCode', () => {
  it('为不同业务域生成可读且符合对象编码约束的唯一编码', () => {
    const now = new Date(2026, 6, 28, 9, 8, 7, 6)

    expect(
      generateObjectCode('bob', 'fund-account', now, 'a1b2c3d4'),
    ).toBe('BOB-FUND-ACCOUNT-20260728090807006-A1B2C3')
    expect(
      generateObjectCode('aux', 'product-category', now, 'f6e5d4c3'),
    ).toBe('AUX-PRODUCT-CATEGORY-20260728090807006-F6E5D4')
  })
})
