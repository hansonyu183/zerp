import type { SettlementMethodSnapshot } from './types'

function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  )
  return (
    date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
  ) ? date : null
}

function formatDate(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function shiftedMonth(
  date: Date,
  monthOffset: number,
): { year: number; month: number } {
  const anchor = new Date(date.getFullYear(), date.getMonth() + monthOffset, 1)
  return { year: anchor.getFullYear(), month: anchor.getMonth() }
}

export function calculateDueDate(
  businessDate: string,
  settlement: SettlementMethodSnapshot | undefined,
): string | null {
  const date = parseDate(businessDate)
  if (!date || !settlement) return null

  if (
    settlement.ruleType === 'DUE_DAYS' ||
    settlement.ruleType === 'RELATIVE_DAYS'
  ) {
    return formatDate(
      addDays(
        date,
        settlement.ruleType === 'DUE_DAYS'
          ? settlement.dueDays ?? 0
          : settlement.dayOffset,
      ),
    )
  }

  const cutoffMonth =
    settlement.ruleType === 'MONTH_END' &&
    date.getDate() > (settlement.cutoffDay ?? 31)
      ? 1
      : 0
  const target = shiftedMonth(
    date,
    settlement.monthOffset + cutoffMonth,
  )
  if (settlement.ruleType === 'MONTH_END') {
    return formatDate(
      addDays(new Date(target.year, target.month + 1, 0), settlement.dayOffset),
    )
  }

  const lastDay = new Date(target.year, target.month + 1, 0).getDate()
  const day = Math.min(Math.max(settlement.dayOfMonth ?? 1, 1), lastDay)
  return formatDate(
    addDays(new Date(target.year, target.month, day), settlement.dayOffset),
  )
}

export function resolveDueDate(
  dueDate: string | undefined,
  businessDate: string,
  settlement: SettlementMethodSnapshot | undefined,
): string | null {
  return dueDate || calculateDueDate(businessDate, settlement)
}
