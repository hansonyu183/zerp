import { describe, expect, it } from 'vitest'
import {
  calculateBaseQuantityLineAmount,
  suggestedBaseQuantity,
} from '@/components/voucher'

describe('VOU quantity snapshots', () => {
  it('uses the selected product conversion only to suggest an editable base quantity', () => {
    expect(suggestedBaseQuantity('2.5', '12')).toBe('30')
    expect(suggestedBaseQuantity('1', '0.333333')).toBe('0.333333')
  })

  it('prices from confirmed base quantity and the pricing-unit conversion', () => {
    expect(calculateBaseQuantityLineAmount('30', '4.00', '10')).toBe('12.00')
  })
})
