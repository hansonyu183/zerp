import { FieldContractError } from './contract.ts'

const decimalPattern = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/

interface DecimalParts {
  negative: boolean
  integer: string
  fraction: string
}

function parseDecimal(value: string): DecimalParts {
  const match = decimalPattern.exec(value)
  if (!match)
    throw new FieldContractError(`非法十进制字符串 ${JSON.stringify(value)}`)
  return {
    negative: match[1] === '-',
    integer: match[2]!,
    fraction: match[3] ?? '',
  }
}

function assertScale(scale: number): void {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > 18)
    throw new FieldContractError('decimal scale 必须是 0 到 18 的安全整数')
}

function scaledInteger(parts: DecimalParts, scale: number): bigint {
  const absolute = BigInt(
    `${parts.integer}${parts.fraction.padEnd(scale, '0')}`,
  )
  return parts.negative ? -absolute : absolute
}

export function formatDecimal(value: string, scale: number): string {
  assertScale(scale)
  const parts = parseDecimal(value)
  if (parts.fraction.length > scale)
    throw new FieldContractError(`decimal ${value} 超过声明精度 ${scale}`)
  const negative =
    parts.negative && scaledInteger(parts, scale) !== 0n ? '-' : ''
  if (scale === 0) return `${negative}${parts.integer}`
  return `${negative}${parts.integer}.${parts.fraction.padEnd(scale, '0')}`
}

export function compareDecimal(left: string, right: string): -1 | 0 | 1 {
  const leftParts = parseDecimal(left)
  const rightParts = parseDecimal(right)
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length)
  const leftInteger = scaledInteger(leftParts, scale)
  const rightInteger = scaledInteger(rightParts, scale)
  if (leftInteger < rightInteger) return -1
  if (leftInteger > rightInteger) return 1
  return 0
}
