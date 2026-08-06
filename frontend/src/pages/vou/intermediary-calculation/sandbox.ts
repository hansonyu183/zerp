import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import type {
  IntermediaryCalculationResult,
  IntermediaryCalculationSource,
  IntermediaryReference,
  IntermediaryResultLine,
  IntermediarySummary,
} from '@/components/voucher'

const moneyPattern = /^(?:0|[1-9]\d{0,11})\.\d{2}$/u
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
  'rebateAmount',
]
const categories = new Set(['COMMISSION', 'INTERMEDIARY', 'REBATE'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isReference(value: unknown): value is IntermediaryReference {
  if (!isRecord(value)) return false
  return (
    typeof value.objectId === 'string' &&
    typeof value.versionId === 'string' &&
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
    typeof value.barrelQuantity === 'string' &&
    quantityPattern.test(value.barrelQuantity) &&
    resultMoneyFields.every(
      (field) =>
        typeof value[field] === 'string' &&
        moneyPattern.test(value[field] as string),
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
    moneyPattern.test(value.amount) &&
    Number(value.amount) > 0
  )
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
        sourceById.get(line.sourceSignoffLineId)?.barrelQuantity !==
        line.barrelQuantity,
    )
  ) {
    throw new Error('计算结果桶数必须与销售签收来源一致。')
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
