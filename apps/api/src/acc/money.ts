// Accounting amounts use eight decimal storage units; posted amounts round to cents.
export const moneyCent = 1_000_000n
export function roundMoneyUnits(numerator: bigint, denominator = 1n): bigint {
  const divisor = denominator * moneyCent
  return ((numerator * 2n + divisor) / (2n * divisor)) * moneyCent
}
