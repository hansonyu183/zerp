import type { BillLineDraft } from './vm'

export function appendHeldBillLines(
  current: BillLineDraft[],
  held: BillLineDraft[],
  selectedBillIds: readonly string[],
  maxLines: number,
): BillLineDraft[] {
  const existing = new Set(
    current.flatMap((line) => (line.billId ? [line.billId] : [])),
  )
  const selected = new Set(selectedBillIds)
  const remaining = Math.max(0, maxLines - current.length)
  const additions = held
    .filter(
      (line) =>
        line.billId && selected.has(line.billId) && !existing.has(line.billId),
    )
    .slice(0, remaining)
    .map((line) => ({
      ...line,
      key: crypto.randomUUID(),
      positionType: 'ASSET' as const,
      direction: 'OUT' as const,
      purpose: 'CHANGE' as const,
    }))
  return additions.length ? [...current, ...additions] : current
}
