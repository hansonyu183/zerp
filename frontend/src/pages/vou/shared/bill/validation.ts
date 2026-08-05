import type { BillVoucherForm } from './vm'
import { formatMoneyCents, parseFixed } from '@/components/voucher/decimal'

export interface BillVoucherSummary {
  primary: string
  change: string
  cashIn: string
  cashOut: string
  net: string
  valid: boolean
}

export function summarizeBillVoucher(
  form: BillVoucherForm,
): BillVoucherSummary {
  let primary = 0n
  let change = 0n
  let cashIn = 0n
  let cashOut = 0n
  let valid = true
  for (const line of form.billLines) {
    const cents = parseFixed(line.faceAmount, 2)
    if (cents === null) {
      valid = false
      continue
    }
    if (line.purpose === 'CHANGE') change += cents
    else primary += cents
  }
  for (const line of form.billCashLines) {
    const cents = parseFixed(line.amount, 2)
    if (cents === null) {
      valid = false
      continue
    }
    if (line.direction === 'IN') cashIn += cents
    else cashOut += cents
  }
  const net = primary + cashIn - change - cashOut
  return {
    primary: formatMoneyCents(primary),
    change: formatMoneyCents(change),
    cashIn: formatMoneyCents(cashIn),
    cashOut: formatMoneyCents(cashOut),
    net: formatMoneyCents(net),
    valid: valid && net > 0n,
  }
}

export function previewInterestAmount(
  faceAmount: string,
  annualRateBps: number,
  days: number,
): string | null {
  const cents = parseFixed(faceAmount, 2)
  if (
    cents === null ||
    !Number.isInteger(annualRateBps) ||
    annualRateBps < 0 ||
    !Number.isInteger(days) ||
    days < 0
  )
    return null
  const numerator = cents * BigInt(annualRateBps) * BigInt(days)
  return formatMoneyCents((numerator + 1_825_000n) / 3_650_000n)
}

export function validateBillVoucherForm(
  form: BillVoucherForm,
  maxBillLines = 20,
  maxCashLines = 20,
  mode: 'receipt' | 'payment' = 'receipt',
): string | null {
  if (mode === 'payment') {
    if (!form.supplier) return '请选择供应商。'
  } else if (!form.customer) return '请选择客户。'
  if (!form.handler) return '请选择经办人。'
  if (!form.businessDate) return '请选择业务日期。'
  if (!/^[A-Z]{3}$/.test(form.currency)) return '币种必须是三位大写字母。'
  if (
    !Number.isInteger(form.internalCostRateBps) ||
    form.internalCostRateBps < 0 ||
    form.internalCostRateBps > 100_000
  ) {
    return '内部年化成本率必须为 0-100000 bps。'
  }
  if (form.billLines.length < 1 || form.billLines.length > maxBillLines) {
    return `票据行数必须为 1-${maxBillLines} 行。`
  }
  if (form.billCashLines.length > maxCashLines) {
    return `现金行数不能超过 ${maxCashLines} 行。`
  }
  if (mode === 'payment' && form.billCashLines.length > 0)
    return '票据付出不支持现金行。'
  let primary = 0n
  let change = 0n
  const billIds = new Set<string>()
  const businessKeys = new Set<string>()
  for (const [index, line] of form.billLines.entries()) {
    if (mode === 'payment') {
      if (line.purpose !== 'PRIMARY' || !line.billId)
        return `第 ${index + 1} 行必须选择可用持有票据。`
      if (billIds.has(line.billId))
        return `第 ${index + 1} 行重复选择了同一张票据。`
      billIds.add(line.billId)
      continue
    }
    if (line.purpose === 'CHANGE') {
      if (!line.billId) return `第 ${index + 1} 行找零票据必须引用持有票据。`
      if (billIds.has(line.billId))
        return `第 ${index + 1} 行重复选择了同一张票据。`
      const cents = parseFixed(line.faceAmount, 2)
      if (cents === null) return `第 ${index + 1} 行找零票据金额无效。`
      billIds.add(line.billId)
      change += cents
      continue
    }
    if (!line.billNo.trim()) return `第 ${index + 1} 行请输入票据号码。`
    const cents = parseFixed(line.faceAmount, 2)
    if (cents === null) return `第 ${index + 1} 行请输入大于零的票面金额。`
    if (line.currency !== form.currency)
      return `第 ${index + 1} 行币种必须与单据一致。`
    if (!line.issueDate) return `第 ${index + 1} 行请选择出票日。`
    if (
      !line.maturityDate ||
      line.maturityDate < line.issueDate ||
      line.maturityDate < form.businessDate
    ) {
      return `第 ${index + 1} 行到期日不能早于出票日或业务日期。`
    }
    if (!line.drawer.trim() || !line.acceptor.trim() || !line.payee.trim()) {
      return `第 ${index + 1} 行请完整填写出票人、承兑人和收款人。`
    }
    if (
      !Number.isInteger(line.annualRateBps) ||
      line.annualRateBps < 0 ||
      line.annualRateBps > 100_000
    ) {
      return `第 ${index + 1} 行年利率必须为 0-100000 bps。`
    }
    const businessKey = `${line.billType}\u0000${line.billNo.trim()}\u0000${line.acceptor.trim()}\u0000${cents}\u0000${line.maturityDate}`
    if (businessKeys.has(businessKey))
      return `第 ${index + 1} 行与前面的票据重复。`
    businessKeys.add(businessKey)
    primary += cents
  }
  let cashIn = 0n
  let cashOut = 0n
  for (const [index, line] of form.billCashLines.entries()) {
    if (!line.fundAccount) return `第 ${index + 1} 行请选择资金账户。`
    const cents = parseFixed(line.amount, 2)
    if (cents === null) return `现金第 ${index + 1} 行请输入大于零的金额。`
    if (line.direction === 'IN') cashIn += cents
    else cashOut += cents
  }
  if (mode === 'receipt' && primary + cashIn - change - cashOut <= 0n)
    return '客户净结算额必须大于零。'
  return null
}
