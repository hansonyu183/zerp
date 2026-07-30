import { describe, expect, it } from 'vitest'
import { formatReferenceLabel } from '@/utils/reference-label'

describe('reference label utilities', () => {
  it('combines a reference code and name', () => {
    expect(
      formatReferenceLabel({ code: ' CUS-001 ', name: ' 示例客户 ' }),
    ).toBe('CUS-001 · 示例客户')
  })

  it('falls back to the available reference field', () => {
    expect(formatReferenceLabel({ code: 'CUS-001' })).toBe('CUS-001')
    expect(formatReferenceLabel({ name: '示例客户' })).toBe('示例客户')
    expect(formatReferenceLabel({})).toBe('')
  })
})
