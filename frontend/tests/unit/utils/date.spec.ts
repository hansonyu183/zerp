import { describe, expect, it } from 'vitest'
import {
  formatLocalDateTime,
  formatMediumDateTime,
  localDate,
  shanghaiBusinessDate,
} from '@/utils/date'

describe('date utilities', () => {
  it('formats a local calendar date without UTC rollover', () => {
    expect(localDate(new Date(2025, 0, 2, 12))).toBe('2025-01-02')
  })

  it('formats the business date in Asia/Shanghai', () => {
    expect(shanghaiBusinessDate(new Date('2026-08-08T16:30:00Z'))).toBe(
      '2026-08-09',
    )
  })

  it('preserves empty and invalid display values', () => {
    expect(formatLocalDateTime(null)).toBe('—')
    expect(formatLocalDateTime('', '')).toBe('')
    expect(formatLocalDateTime('not-a-date')).toBe('not-a-date')
  })

  it('formats valid timestamps in both supported display styles', () => {
    const value = '2025-01-02T03:04:05Z'
    expect(formatLocalDateTime(value)).not.toBe(value)
    expect(formatMediumDateTime(value)).not.toBe(value)
  })
})
