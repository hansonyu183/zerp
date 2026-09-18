export const incomeExpenseDirectionLabels = {
  INCOME: '收入',
  EXPENSE: '支出',
} as const
export const incomeExpenseDirectionOptions = Object.entries(
  incomeExpenseDirectionLabels,
).map(([value, caption]) => ({ value, caption }))
