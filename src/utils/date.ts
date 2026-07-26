const mediumDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'medium',
})

export function localDate(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000
  return new Date(value.getTime() - offset).toISOString().slice(0, 10)
}

export function formatLocalDateTime(
  value?: string | null,
  emptyValue = '—',
): string {
  if (!value) return emptyValue
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN')
}

export function formatMediumDateTime(value: string): string {
  return mediumDateTimeFormatter.format(new Date(value))
}
