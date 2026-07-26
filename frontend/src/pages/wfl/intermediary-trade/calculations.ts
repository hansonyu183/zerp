import { parseFixed } from '@/components/voucher/decimal'
import type {
  IntermediaryContainerBalance,
  IntermediaryContainerType,
  IntermediarySignoffLineView,
} from './types'

export function calculateLoss(
  deliveredQuantity: string,
  signedQuantity: string,
  rejectedQuantity: string,
): string | null {
  const delivered = parseFixed(deliveredQuantity, 6, true)
  const signed = parseFixed(signedQuantity, 6, true)
  const rejected = parseFixed(rejectedQuantity, 6, true)
  if (
    delivered === null ||
    signed === null ||
    rejected === null ||
    signed + rejected > delivered
  ) return null
  return formatQuantity(delivered - signed - rejected)
}

export function calculateExpectedContainers(
  lines: readonly {
    quantity: string
    containerType: IntermediaryContainerType
    quantityPerContainer?: string
  }[],
): IntermediaryContainerBalance | null {
  const result: IntermediaryContainerBalance = { solvent: 0, resin: 0 }
  for (const line of lines) {
    if (line.containerType === 'NONE') continue
    const quantity = parseFixed(line.quantity, 6, true)
    const perContainer = parseFixed(line.quantityPerContainer ?? '', 6)
    if (quantity === null || perContainer === null) return null
    const count = Number((quantity + perContainer - 1n) / perContainer)
    if (!Number.isSafeInteger(count)) return null
    if (line.containerType === 'SOLVENT') result.solvent += count
    if (line.containerType === 'RESIN') result.resin += count
  }
  return result
}

export function calculateContainerBalanceAfter(
  current: IntermediaryContainerBalance,
  expected: IntermediaryContainerBalance,
  received: IntermediaryContainerBalance,
): IntermediaryContainerBalance {
  return {
    solvent: current.solvent + expected.solvent - received.solvent,
    resin: current.resin + expected.resin - received.resin,
  }
}

export function normalizeSignoffLines(
  lines: readonly (IntermediarySignoffLineView & {
    deliveredQuantity: string
  })[],
): Array<IntermediarySignoffLineView & { deliveredQuantity: string }> {
  return lines.map((line) => ({
    ...line,
    lossQuantity:
      calculateLoss(
        line.deliveredQuantity,
        line.signedQuantity,
        line.rejectedQuantity,
      ) ?? '',
  }))
}

function formatQuantity(micros: bigint): string {
  const whole = micros / 1_000_000n
  const fraction = (micros % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
