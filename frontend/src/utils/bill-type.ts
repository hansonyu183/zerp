const billTypeLabels = {
  BANK_ACCEPTANCE: '银行承兑',
  COMMERCIAL_ACCEPTANCE: '商业承兑',
  CHECK: '支票',
  OTHER: '其他',
} as const

export const billTypeOptions = Object.entries(billTypeLabels).map(
  ([value, title]) => ({ title, value }),
)

export function formatBillType(value: string): string {
  return billTypeLabels[value as keyof typeof billTypeLabels] ?? value
}
