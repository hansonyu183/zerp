import { describe, expect, it } from 'vitest'
import { passwordMeetsPolicy } from '@/utils/password-policy'

describe('passwordMeetsPolicy', () => {
  it.each([
    ['Aa1!bcdefghi', 12, true],
    ['Aa1!bcdefgh', 12, false],
    ['aa1!bcdefghi', 12, false],
    [`Aa1!${'x'.repeat(253)}`, 12, false],
  ])('校验密码策略边界 %#', (password, minimumLength, expected) => {
    expect(passwordMeetsPolicy(password, minimumLength)).toBe(expected)
  })
})
