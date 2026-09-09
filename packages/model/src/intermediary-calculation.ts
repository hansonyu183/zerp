import type {
  VouIntermediaryCalculationInput,
  VouIntermediaryReference,
} from './vou.ts'
type Calculation = VouIntermediaryCalculationInput
export function intermediaryCanonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(intermediaryCanonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${intermediaryCanonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function intermediaryUnits(value: string, scale = 2): bigint {
  if (!new RegExp(`^-?(?:0|[1-9]\\d*)(?:\\.\\d{1,${scale}})?$`).test(value))
    throw new Error('vou_intermediary_result_invalid')
  const [whole, fraction = ''] = value.replace('-', '').split('.')
  return (
    (BigInt(whole!) * 10n ** BigInt(scale) +
      BigInt(fraction.padEnd(scale, '0'))) *
    (value.startsWith('-') ? -1n : 1n)
  )
}
export function intermediaryDecimal(value: bigint, scale = 2): string {
  const absolute = value < 0n ? -value : value,
    factor = 10n ** BigInt(scale)
  return `${value < 0n ? '-' : ''}${absolute / factor}.${(absolute % factor).toString().padStart(scale, '0')}`
}

const canonical = intermediaryCanonical,
  units = intermediaryUnits,
  decimal = intermediaryDecimal
const components = [
  'baseCommission',
  'premiumCommission',
  'lowPriceCommission',
  'marketMaintenanceSubsidy',
  'marketDevelopmentSubsidy',
] as const
const reject = (): never => {
  throw new Error('vou_intermediary_result_invalid')
}
function resultTotal(
  source: Calculation['source'],
  result: Calculation['result'],
): string {
  const sources = new Map(
    source.lines.map((line) => [line.sourceSignoffLineId, line]),
  )
  const bills = new Map(source.bills.map((bill) => [bill.billLineId, bill]))
  if (
    sources.size !== source.lines.length ||
    bills.size !== source.bills.length ||
    result.lines.length !== source.lines.length
  )
    return reject()
  const seen = new Set<string>(),
    expected = new Map<
      string,
      {
        references: Set<string>
        amount: bigint
      }
    >()
  const allocated = new Map<string, string>(),
    groupCosts = new Map<string, bigint>()
  const add = (
    category: string,
    payee: VouIntermediaryReference,
    amount: bigint,
    customer?: VouIntermediaryReference,
  ) => {
    const key = `${category}:${payee.entity}:${payee.objectId}:${customer?.objectId ?? ''}`
    const previous = expected.get(key)
    const references = previous?.references ?? new Set<string>()
    references.add(canonical({ payee, customer: customer ?? null }))
    expected.set(key, {
      references,
      amount: (previous?.amount ?? 0n) + amount,
    })
  }
  for (const line of result.lines) {
    const sourceLine = sources.get(line.sourceSignoffLineId)
    if (!sourceLine || seen.has(line.sourceSignoffLineId)) return reject()
    seen.add(line.sourceSignoffLineId)
    if (
      units(line.standardPieceQuantity, 6) !==
      units(sourceLine.standardPieceQuantity, 6)
    )
      return reject()
    const values = components.map((field) => units(line[field])),
      cost = units(line.billCost),
      employee = units(line.employeeAmount),
      intermediary = units(line.intermediaryAmount)
    if (sourceLine.sourceKind === 'RETURN_ADJUSTMENT') {
      if (
        values.some((value) => value !== 0n) ||
        cost !== 0n ||
        line.billLineIds.length ||
        employee !== -units(sourceLine.adjustmentEmployeeAmount) ||
        intermediary !== -units(sourceLine.adjustmentIntermediaryAmount)
      )
        return reject()
    } else {
      if (
        [...values, cost, employee, intermediary].some((value) => value < 0n) ||
        values.reduce((sum, value) => sum + value, 0n) - cost !== employee
      )
        return reject()
      const group = `${sourceLine.customer.objectId}:${sourceLine.salesperson.entity}:${sourceLine.salesperson.objectId}`
      groupCosts.set(group, (groupCosts.get(group) ?? 0n) + cost)
      if (new Set(line.billLineIds).size !== line.billLineIds.length)
        return reject()
      for (const id of line.billLineIds) {
        const bill = bills.get(id)
        if (
          !bill ||
          bill.customer.objectId !== sourceLine.customer.objectId ||
          (allocated.has(id) && allocated.get(id) !== group)
        )
          return reject()
        allocated.set(id, group)
      }
    }
    if (
      sourceLine.salesAttributionType === 'INTERNAL_EMPLOYEE'
        ? sourceLine.salesperson.entity !== 'employee'
        : sourceLine.salesperson.entity !== 'sales-partner'
    )
      return reject()
    const category =
      sourceLine.salesAttributionType === 'INTERNAL_EMPLOYEE'
        ? 'COMMISSION'
        : sourceLine.salesAttributionType
    add(category, sourceLine.salesperson, employee)
    add(
      'INTERMEDIARY',
      sourceLine.salesperson,
      intermediary,
      sourceLine.customer,
    )
  }
  const billGroups = new Set(allocated.values())
  if (
    [...billGroups].some((group) => (groupCosts.get(group) ?? 0n) <= 0n) ||
    [...groupCosts].some(([group, cost]) => cost > 0n && !billGroups.has(group))
  )
    return reject()
  const summaries = new Set<string>()
  let total = 0n
  for (const summary of result.summaries) {
    const key = `${summary.category}:${summary.payee.entity}:${summary.payee.objectId}:${summary.customer?.objectId ?? ''}`,
      target = expected.get(key)
    if (
      !target ||
      summaries.has(key) ||
      !target.references.has(
        canonical({ payee: summary.payee, customer: summary.customer ?? null }),
      ) ||
      units(summary.amount) !== target.amount
    )
      return reject()
    summaries.add(key)
    total += target.amount
  }
  if (
    [...expected].some(
      ([key, value]) => value.amount !== 0n && !summaries.has(key),
    )
  )
    return reject()
  return decimal(total)
}

/** Shared result semantics; formulas remain exclusively in the persisted script. */
export function checkIntermediaryResult(
  source: Calculation['source'],
  value: unknown,
): { ok: true; amount: string } | { ok: false } {
  try {
    if (!value || typeof value !== 'object') return { ok: false }
    const result = value as Calculation['result']
    if (!Array.isArray(result.lines) || !Array.isArray(result.summaries))
      return { ok: false }
    return { ok: true, amount: resultTotal(source, result) }
  } catch {
    return { ok: false }
  }
}
