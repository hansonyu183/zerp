const DIGITS = /^\d+$/
const MAX_INT64 = 9_223_372_036_854_775_807n

export function parseFixed(
  value: string,
  scale: number,
  allowZero = false,
): bigint | null {
  const normalized = value.trim()
  if (!normalized || normalized.startsWith('-') || normalized.startsWith('+')) {
    return null
  }
  const parts = normalized.split('.')
  if (parts.length > 2 || !parts[0] || !DIGITS.test(parts[0])) return null
  const fraction = parts[1] ?? ''
  if (
    (parts.length === 2 && !fraction) ||
    fraction.length > scale ||
    (fraction && !DIGITS.test(fraction))
  ) {
    return null
  }
  const digits = `${parts[0]}${fraction.padEnd(scale, '0')}`
  const result = BigInt(digits)
  if (result >= MAX_INT64) return null
  return result > 0n || allowZero ? result : null
}

export function isQuantity(value: string, allowZero = false): boolean {
  return parseFixed(value, 6, allowZero) !== null
}

export function isMoney(value: string, allowZero = false): boolean {
  return parseFixed(value, 2, allowZero) !== null
}

export function formatMoneyCents(value: bigint): string {
  const whole = value / 100n
  const fraction = String(value % 100n).padStart(2, '0')
  return `${whole}.${fraction}`
}

export function calculateLineAmount(
  quantity: string,
  unitPrice: string,
): string | null {
  const quantityMicros = parseFixed(quantity, 6)
  const priceCents = parseFixed(unitPrice, 2, true)
  if (quantityMicros === null || priceCents === null) return null

  const product = quantityMicros * priceCents
  const divisor = 1_000_000n
  let cents = product / divisor
  if ((product % divisor) * 2n >= divisor) cents += 1n
  return cents >= 0n && cents <= MAX_INT64 ? formatMoneyCents(cents) : null
}

export function suggestedBaseQuantity(
  enteredQuantity: string,
  conversionFactor: string,
): string | null {
  const enteredMicros = parseFixed(enteredQuantity, 6)
  const factorMicros = parseFixed(conversionFactor, 6)
  if (enteredMicros === null || factorMicros === null) return null
  const product = enteredMicros * factorMicros
  let baseMicros = product / 1_000_000n
  if ((product % 1_000_000n) * 2n >= 1_000_000n) baseMicros += 1n
  if (baseMicros <= 0n || baseMicros >= MAX_INT64) return null
  return formatQuantityMicros(baseMicros)
}

export function calculateBaseQuantityLineAmount(
  baseQuantity: string,
  unitPrice: string,
  pricingUnitFactor: string,
): string | null {
  const quantityMicros = parseFixed(baseQuantity, 6)
  const conversionMicros = parseFixed(pricingUnitFactor, 6)
  const priceCents = parseFixed(unitPrice, 2, true)
  if (
    quantityMicros === null ||
    conversionMicros === null ||
    priceCents === null
  )
    return null
  const pricingQuantityMicros = (quantityMicros * 1_000_000n) / conversionMicros
  const product = pricingQuantityMicros * priceCents
  const divisor = 1_000_000n
  let cents = product / divisor
  if ((product % divisor) * 2n >= divisor) cents += 1n
  return cents >= 0n && cents <= MAX_INT64 ? formatMoneyCents(cents) : null
}

export function formatQuantityMicros(value: bigint): string {
  const whole = value / 1_000_000n
  const fraction = String(value % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : String(whole)
}

export function addMoney(left: string, right?: string): string | null {
  const leftCents = parseFixed(left, 2, true)
  const rightCents = parseFixed(right || '0', 2, true)
  if (leftCents === null || rightCents === null) return null
  const total = leftCents + rightCents
  return total <= MAX_INT64 ? formatMoneyCents(total) : null
}

export function sumMoney(values: readonly string[]): string | null {
  let total = 0n
  for (const value of values) {
    const cents = parseFixed(value, 2, true)
    if (cents === null) return null
    total += cents
    if (total > MAX_INT64) return null
  }
  return formatMoneyCents(total)
}
