import {
  intermediaryUnits,
  intermediaryDecimal,
} from './intermediary-calculation.ts'

export type OrderAmountBasis = Readonly<{
  baseQuantity: string
  unitPrice: string
  agreedAmount?: string
}>

/** Agreed amounts are final line amounts; the quote is audit information. */
export function orderLineAmountMinor(
  line: OrderAmountBasis,
  quantity = line.baseQuantity,
  rounding: 'TRUNCATE' | 'HALF_UP' = 'TRUNCATE',
): bigint {
  const actual = intermediaryUnits(quantity, 6)
  if (line.agreedAmount !== undefined) {
    const basis = intermediaryUnits(line.baseQuantity, 6)
    if (basis <= 0n) throw new Error('vou_payload_invalid')
    return (intermediaryUnits(line.agreedAmount) * actual) / basis
  }
  const numerator = intermediaryUnits(line.unitPrice) * actual
  return (numerator + (rounding === 'HALF_UP' ? 500_000n : 0n)) / 1_000_000n
}

export function orderQuote(value: string): string {
  const fixed = intermediaryDecimal(intermediaryUnits(value, 6), 6)
  const [whole, fraction] = fixed.split('.')
  return `${whole}.${fraction!.replace(/0+$/, '').padEnd(2, '0')}`
}
