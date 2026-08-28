import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import type {
  IntermediaryCalculationResult,
  IntermediaryCalculationSource,
  IntermediaryReference,
  IntermediaryResultLine,
  IntermediarySummary,
} from '@/components/voucher'

const signedMoneyPattern = /^-?(?:0|[1-9]\d{0,11})\.\d{2}$/u
const quantityPattern = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/u
const resultMoneyFields: readonly (keyof IntermediaryResultLine)[] = [
  'baseCommission',
  'premiumCommission',
  'lowPriceCommission',
  'marketMaintenanceSubsidy',
  'marketDevelopmentSubsidy',
  'billCost',
  'employeeAmount',
  'intermediaryAmount',
]
const categories = new Set([
  'COMMISSION',
  'EXTERNAL_PART_TIME',
  'CHANNEL_PARTNER',
  'INTERMEDIARY',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isReference(value: unknown): value is IntermediaryReference {
  if (!isRecord(value)) return false
  return (
    typeof value.objectId === 'string' &&
    typeof value.approvalEntryId === 'string' &&
    typeof value.entity === 'string' &&
    typeof value.code === 'string' &&
    typeof value.name === 'string'
  )
}

function isResultLine(value: unknown): value is IntermediaryResultLine {
  if (!isRecord(value)) return false
  return (
    typeof value.sourceSignoffLineId === 'string' &&
    typeof value.premiumUnitPrice === 'string' &&
    signedMoneyPattern.test(value.premiumUnitPrice) &&
    typeof value.standardPieceQuantity === 'string' &&
    quantityPattern.test(value.standardPieceQuantity) &&
    Array.isArray(value.billLineIds) &&
    value.billLineIds.every((item) => typeof item === 'string') &&
    new Set(value.billLineIds).size === value.billLineIds.length &&
    resultMoneyFields.every(
      (field) =>
        typeof value[field] === 'string' &&
        signedMoneyPattern.test(value[field] as string),
    ) &&
    (value.note === undefined ||
      (typeof value.note === 'string' && Array.from(value.note).length <= 1000))
  )
}

function isSummary(value: unknown): value is IntermediarySummary {
  if (!isRecord(value)) return false
  return (
    isReference(value.payee) &&
    typeof value.category === 'string' &&
    categories.has(value.category) &&
    typeof value.amount === 'string' &&
    signedMoneyPattern.test(value.amount) &&
    Number(value.amount) !== 0
  )
}

function referenceEquals(
  left: IntermediaryReference,
  right: IntermediaryReference,
): boolean {
  return (
    left.objectId === right.objectId &&
    left.approvalEntryId === right.approvalEntryId &&
    left.entity === right.entity &&
    left.code === right.code &&
    left.name === right.name
  )
}

function moneyCents(value: string): number {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction] = unsigned.split('.')
  const cents = Number(whole) * 100 + Number(fraction)
  return negative ? -cents : cents
}

function quantityMicros(value: string): bigint | null {
  if (!quantityPattern.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
}

function summaryKey(
  category: IntermediarySummary['category'],
  payee: IntermediaryReference,
): string {
  return `${category}:${payee.entity}:${payee.objectId}`
}

export function validateIntermediaryResult(
  value: unknown,
  source: IntermediaryCalculationSource,
): IntermediaryCalculationResult {
  if (!isRecord(value) || !Array.isArray(value.lines)) {
    throw new Error('计算脚本必须返回 lines 和 summaries。')
  }
  if (!Array.isArray(value.summaries)) {
    throw new Error('计算脚本必须返回 summaries。')
  }
  if (!value.lines.every(isResultLine)) {
    throw new Error('计算脚本返回的明细字段或金额格式不正确。')
  }
  if (!value.summaries.every(isSummary)) {
    throw new Error('计算脚本返回的汇总对象、类别或金额格式不正确。')
  }
  const expectedIds = source.lines.map((line) => line.sourceSignoffLineId)
  const actualIds = value.lines.map((line) => line.sourceSignoffLineId)
  if (
    expectedIds.length !== actualIds.length ||
    new Set(actualIds).size !== actualIds.length ||
    expectedIds.some((id) => !actualIds.includes(id))
  ) {
    throw new Error('计算结果必须与销售签收明细一一对应。')
  }
  const sourceById = new Map(
    source.lines.map((line) => [line.sourceSignoffLineId, line]),
  )
  if (
    value.lines.some(
      (line) =>
        quantityMicros(
          sourceById.get(line.sourceSignoffLineId)?.standardPieceQuantity ?? '',
        ) !== quantityMicros(line.standardPieceQuantity),
    )
  ) {
    throw new Error('计算结果标准计件必须与销售签收来源一致。')
  }
  const sourceBills = new Map(
    source.bills.map((bill) => [bill.billLineId, bill]),
  )
  const allocatedBills = new Set<string>()
  const billCostGroups = new Set<string>()
  const billAllocationGroups = new Set<string>()
  for (const line of value.lines as IntermediaryResultLine[]) {
    const sourceLine = sourceById.get(line.sourceSignoffLineId)
    if (!sourceLine) continue
    const amounts = resultMoneyFields.map((field) => Number(line[field]))
    if (
      (sourceLine.sourceKind === 'SALE' &&
        amounts.some((amount) => amount < 0)) ||
      (sourceLine.sourceKind === 'RETURN_ADJUSTMENT' &&
        (amounts.slice(0, 6).some((amount) => amount !== 0) ||
          amounts.slice(6).some((amount) => amount > 0) ||
          line.billLineIds.length !== 0))
    ) {
      throw new Error('计算结果金额方向与来源类型不一致。')
    }
    if (
      sourceLine.sourceKind === 'RETURN_ADJUSTMENT' &&
      amounts
        .slice(6)
        .some(
          (amount, index) =>
            amount !==
            -Number(
              [
                sourceLine.adjustmentEmployeeAmount,
                sourceLine.adjustmentIntermediaryAmount,
              ][index],
            ),
        )
    ) {
      throw new Error('跨月退货冲回金额必须与来源金额一致。')
    }
    const billGroup = sourceLine.customer.objectId
    for (const billLineId of line.billLineIds) {
      const bill = sourceBills.get(billLineId)
      if (
        !bill ||
        allocatedBills.has(billLineId) ||
        sourceLine.sourceKind !== 'SALE' ||
        bill.customer.objectId !== sourceLine.customer.objectId
      ) {
        throw new Error('票据成本分配必须匹配客户和来源票据。')
      }
      allocatedBills.add(billLineId)
      billAllocationGroups.add(billGroup)
    }
    if (Number(line.billCost) > 0) billCostGroups.add(billGroup)
  }
  if ([...billCostGroups].some((group) => !billAllocationGroups.has(group))) {
    throw new Error('票据成本必须记录同一客户的来源票据。')
  }
  if ([...billAllocationGroups].some((group) => !billCostGroups.has(group))) {
    throw new Error('已分配来源票据时必须同时扣除正数票据成本。')
  }
  const expectedSummaries = new Map<
    string,
    { payee: IntermediaryReference; amountCents: number }
  >()
  const addExpectedSummary = (
    payee: IntermediaryReference | undefined,
    category: IntermediarySummary['category'],
    amount: string,
  ) => {
    const amountCents = moneyCents(amount)
    if (amountCents === 0) return
    if (!payee) {
      throw new Error('计算结果汇总必须与明细金额和收款方一致。')
    }
    const key = summaryKey(category, payee)
    const current = expectedSummaries.get(key)
    if (current && !referenceEquals(current.payee, payee)) {
      throw new Error('计算结果汇总必须与明细金额和收款方一致。')
    }
    expectedSummaries.set(key, {
      payee,
      amountCents: (current?.amountCents ?? 0) + amountCents,
    })
  }
  for (const line of value.lines as IntermediaryResultLine[]) {
    const sourceLine = sourceById.get(line.sourceSignoffLineId)
    if (!sourceLine) continue
    addExpectedSummary(
      sourceLine.salesperson,
      sourceLine.salesAttributionType === 'INTERNAL_EMPLOYEE'
        ? 'COMMISSION'
        : sourceLine.salesAttributionType,
      line.employeeAmount,
    )
    addExpectedSummary(
      sourceLine.intermediary,
      'INTERMEDIARY',
      line.intermediaryAmount,
    )
  }
  for (const [key, summary] of expectedSummaries) {
    if (summary.amountCents === 0) expectedSummaries.delete(key)
  }
  const actualSummaries = new Map<string, IntermediarySummary>()
  for (const summary of value.summaries as IntermediarySummary[]) {
    const key = summaryKey(summary.category, summary.payee)
    if (actualSummaries.has(key)) {
      throw new Error('计算结果汇总必须与明细金额和收款方一致。')
    }
    actualSummaries.set(key, summary)
  }
  if (
    actualSummaries.size !== expectedSummaries.size ||
    [...expectedSummaries].some(([key, expected]) => {
      const actual = actualSummaries.get(key)
      return (
        !actual ||
        !referenceEquals(actual.payee, expected.payee) ||
        moneyCents(actual.amount) !== expected.amountCents
      )
    })
  ) {
    throw new Error('计算结果汇总必须与明细金额和收款方一致。')
  }
  return {
    lines: value.lines as IntermediaryResultLine[],
    summaries: value.summaries as IntermediarySummary[],
  }
}

function sandboxMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return String(error)
}

export async function runIntermediaryScript(
  script: string,
  source: IntermediaryCalculationSource,
): Promise<IntermediaryCalculationResult> {
  const QuickJS = await getQuickJS()
  const serializedSource = JSON.stringify(source)
  const code = `${script}\n
if (typeof globalThis.calculate !== 'function') {
  throw new Error('脚本必须定义 globalThis.calculate(input)');
}
JSON.stringify(globalThis.calculate(JSON.parse(${JSON.stringify(serializedSource)})));`
  try {
    const serializedResult = QuickJS.evalCode(code, {
      memoryLimitBytes: 16 * 1024 * 1024,
      shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + 2_000),
    })
    if (typeof serializedResult !== 'string') {
      throw new Error('计算脚本必须返回可序列化的对象。')
    }
    return validateIntermediaryResult(JSON.parse(serializedResult), source)
  } catch (error) {
    throw new Error(`计算脚本执行失败：${sandboxMessage(error)}`, {
      cause: error,
    })
  }
}
