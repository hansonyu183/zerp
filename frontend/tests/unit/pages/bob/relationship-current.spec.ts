import { describe, expect, it } from 'vitest'
import { otherUnitConfig } from '@/pages/bob/other-unit/config'
import { salesPartnerConfig } from '@/pages/bob/sales-partner/config'

describe('BOB relationship current pages', () => {
  it('registers other-unit as a read-only current page', () => {
    expect(otherUnitConfig.entity).toBe('other-unit')
    expect(
      otherUnitConfig
        .fields({
          mode: 'view',
          referenceOptions: {},
          referenceLoading: {},
          referenceErrors: {},
        })
        .every(
          (field) => field.type === 'readonly' || field.type === 'textarea',
        ),
    ).toBe(true)
  })

  it('registers sales-partner as a read-only current page', () => {
    expect(salesPartnerConfig.entity).toBe('sales-partner')
    expect(
      salesPartnerConfig
        .fields({
          mode: 'view',
          referenceOptions: {},
          referenceLoading: {},
          referenceErrors: {},
        })
        .some((field) => field.key === 'capabilities'),
    ).toBe(true)
  })
})
