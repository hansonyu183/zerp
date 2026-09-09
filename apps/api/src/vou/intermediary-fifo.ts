/** Monetary units are integer cents. Returns retire their own remaining debt only. */
export interface IntermediaryReceivable {
  id: string
  customerId: string
  date: string
  documentNo: string
  amount: bigint
}
export type IntermediaryCollectionEvent =
  | {
      kind: 'PAYMENT'
      customerId: string
      date: string
      amount: bigint
      id: string
    }
  | {
      kind: 'RETURN'
      customerId: string
      date: string
      amount: bigint
      sourceId: string
      id: string
    }

export function intermediaryCollectionDates(
  receivables: readonly IntermediaryReceivable[],
  events: readonly IntermediaryCollectionEvent[],
  opening: ReadonlyMap<string, bigint>,
): Map<string, string> {
  const dates = new Map<string, string>()
  const customers = new Set([
    ...receivables.map((row) => row.customerId),
    ...opening.keys(),
  ])
  for (const customerId of customers) {
    const invoices = receivables
      .filter((row) => row.customerId === customerId)
      .toSorted(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.documentNo.localeCompare(b.documentNo) ||
          a.id.localeCompare(b.id),
      )
      .map((row) => ({
        ...row,
        debt: row.amount,
        consumed: 0n,
        present: false,
      }))
    const byId = new Map(invoices.map((row) => [row.id, row]))
    let capacity = -(opening.get(customerId) ?? 0n)
    const timeline = [
      ...invoices.map((row) => ({
        kind: 'SALE' as const,
        date: row.date,
        id: row.id,
        row,
      })),
      ...events.filter((event) => event.customerId === customerId),
    ].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.kind === 'SALE' && b.kind === 'SALE'
          ? a.row.documentNo.localeCompare(b.row.documentNo) ||
            a.id.localeCompare(b.id)
          : a.kind === 'SALE'
            ? -1
            : b.kind === 'SALE'
              ? 1
              : a.id.localeCompare(b.id)),
    )
    const allocate = (date: string) => {
      for (const row of invoices) {
        if (!row.present) continue
        const remainder = row.debt - row.consumed
        if (remainder > 0n && capacity > 0n) {
          const allocated = capacity < remainder ? capacity : remainder
          row.consumed += allocated
          capacity -= allocated
        }
        if (row.consumed >= row.debt && !dates.has(row.id))
          dates.set(row.id, date)
      }
    }
    for (const event of timeline) {
      if (event.kind === 'SALE') event.row.present = true
      else if (event.kind === 'PAYMENT') capacity += event.amount
      else {
        const row = byId.get(event.sourceId)
        if (!row || event.amount < 0n || event.amount > row.debt)
          throw new Error('vou_intermediary_source_invalid')
        row.debt -= event.amount
        // Previously consumed capacity stays consumed even when debt drops below it.
      }
      allocate(event.date)
    }
  }
  return dates
}
